// src/modules/whatsapp/whatsapp.service.js
import 'dotenv/config';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { messageQueue } from '../../shared/queue.js';

let sockInstance = null;
let waStatus = 'disconnected';
let currentQR = null;

// ─── Helper: ambil nomor WA asli dari msg.key ─────────────────────────────────
// Priority: senderPn (v6 @lid) → remoteJidAlt → remoteJid
function resolveNomorWa(msgKey) {
    return msgKey.senderPn || msgKey.remoteJidAlt || msgKey.remoteJid;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function getWAStatus() { return waStatus; }
export function getCurrentQR() { return currentQR; }

// Untuk API internal (misal dari route /api/wa/send), nomor bisa dalam format "81234567890" atau "6281234567890" atau "
export async function sendWAMessage(to, text) {
    if (!sockInstance) throw new Error('WhatsApp belum terkoneksi');
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await sockInstance.sendMessage(jid, { text });
}

export async function disconnectWA() {
    if (sockInstance) {
        await sockInstance.logout();
        sockInstance = null;
        waStatus = 'disconnected';
        currentQR = null;
        logger.info('WhatsApp disconnected via API');
    }
}

export async function reconnectWA() {
    if (sockInstance) {
        try { await sockInstance.end(); } catch (_) {}
        sockInstance = null;
    }
    waStatus = 'disconnected';
    currentQR = null;
    await startWA();
}

// ─── Event Bus: kirim pesan keluar ────────────────────────────────────────────

bus.on('whatsapp.send_message', async ({ to, text }) => {
    try {
        await sendWAMessage(to, text);
    } catch (err) {
        logger.error('Gagal mengirim pesan WhatsApp:', err.message);
    }
});

// ─── Core ──────────────────────────────────────────────────────────────────────

export async function startWA() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Windows', 'Chrome', '122.0.0.0'],
            printQRInTerminal: false,
            getMessage: async () => ({ conversation: 'getting messages' }),
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 0,
        });

        sockInstance = sock;

        sock.ev.on('creds.update', saveCreds);

        // ─── Koneksi ───────────────────────────────────────────────────────────
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                waStatus = 'waiting_qr';
                currentQR = qr;
                logger.info('--- SCAN QR SEKARANG ---');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                sockInstance = null;
                waStatus = 'disconnected';
                currentQR = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                logger.warn(`Terputus: ${statusCode}. Reconnect: ${shouldReconnect}`);
                if (shouldReconnect) setTimeout(() => startWA(), 5_000);
            } else if (connection === 'open') {
                waStatus = 'connected';
                currentQR = null;
                logger.info('✅ KASBOT TERHUBUNG KE WHATSAPP');
            }
        });

        // ─── Pesan Masuk ───────────────────────────────────────────────────────
        // Untuk efisiensi, hanya proses pesan baru (upsertType='notify') yang belum diproses oleh Baileys
        sock.ev.on('messages.upsert', async ({ messages, type: upsertType }) => {
            if (upsertType !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message || msg.message.protocolMessage) continue;
                if (msg.key.fromMe) continue;

                const sender = msg.key.remoteJid;
                if (!sender) continue;
                if (sender.endsWith('@newsletter')) continue;
                if (sender.endsWith('@g.us')) continue;

                // ─── Resolve @lid → nomor WA asli ─────────────────────────────
                const nomorWa = resolveNomorWa(msg.key);
                logger.verbose(`📋 [DEBUG msg.key] ${JSON.stringify(msg.key)}`);
                logger.verbose(`📋 sender=${sender} | nomorWa=${nomorWa}`);

                // Tolak @lid tanpa resolusi nomor asli — tidak bisa di-lookup di DB
                if (nomorWa.endsWith('@lid')) {
                    logger.warn(`⚠️ Pesan dari @lid tanpa remoteJidAlt, skip: ${nomorWa}`);
                    continue;
                }

                const msgTime = (msg.messageTimestamp || 0) * 1000;
                if (Date.now() - msgTime > 30_000) {
                    logger.verbose(`⏭️ Skip pesan lama: ${new Date(msgTime).toISOString()}`);
                    continue;
                }

                const type = Object.keys(msg.message)[0];
                logger.verbose(`📋 [${nomorWa}] tipe: ${type}`);

                // ─── TIPE 1: Teks ──────────────────────────────────────────────
                if (type === 'conversation' || type === 'extendedTextMessage') {
                    const text = msg.message.conversation
                        || msg.message.extendedTextMessage?.text
                        || '';
                    if (!text) continue;

                    logger.verbose(`🔍 Teks: [${nomorWa}] -> ${text}`);

                    await messageQueue.add('text-message', {
                        type: 'text',
                        payload: {
                            sender,
                            senderAlt: nomorWa,
                            text,
                            source_type: 'teks'
                        }
                    });
                    continue;
                }

                // ─── TIPE 2: Gambar ────────────────────────────────────────────
                if (type === 'imageMessage') {
                    const caption = msg.message.imageMessage?.caption || '';
                    logger.verbose(`🖼️ Gambar dari [${nomorWa}]`);

                    bus.emit('whatsapp.send_message', { to: sender, text: '🔍 Sedang membaca struk Anda...' });

                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        });
                        bus.emit('whatsapp.image_received', {
                            sender, senderAlt: nomorWa, imageBuffer: buffer, caption, source_type: 'foto'
                        });
                    } catch (err) {
                        logger.error('Gagal download gambar:', err.message);
                        bus.emit('whatsapp.send_message', {
                            to: sender,
                            text: '❌ Gagal membaca gambar. Coba kirim ulang foto struk Anda.'
                        });
                    }
                    continue;
                }

                // ─── TIPE 3: Voice Note ────────────────────────────────────────
                if (type === 'audioMessage') {
                    const isPtt = msg.message.audioMessage?.ptt;
                    if (!isPtt) continue;

                    logger.verbose(`🎙️ Voice note dari [${nomorWa}]`);

                    //bus.emit('whatsapp.send_message', { to: sender, text: '🎙️ Sedang mendengarkan voice note Anda...' });

                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                            logger: pino({ level: 'silent' }),
                            reuploadRequest: sock.updateMediaMessage
                        });
                        bus.emit('whatsapp.audio_received', {
                            sender, senderAlt: nomorWa, audioBuffer: buffer, source_type: 'suara'
                        });
                    } catch (err) {
                        logger.error('Gagal download audio:', err.message);
                        bus.emit('whatsapp.send_message', {
                            to: sender,
                            text: '❌ Gagal memproses voice note. Coba kirim ulang.'
                        });
                    }
                    continue;
                }

                logger.verbose(`⚠️ Tipe pesan tidak didukung: ${type}`);
            }
        });

    } catch (err) {
        logger.error('Error di startWA:', err);
    }
}
