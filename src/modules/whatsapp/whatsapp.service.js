// src/modules/whatsapp/whatsapp.service.js
import logger from '../../shared/logger.js';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import bus from '../../shared/eventBus.js';
import pino from 'pino';
import { messageQueue, mediaQueue } from '../../shared/queue.js';

let sockInstance = null;

bus.on('whatsapp.send_message', async ({ to, text }) => {
    if (!sockInstance) {
        logger.error("Gagal kirim: socket belum siap.");
        return;
    }
    try {
        logger.info(`📤 Mengirim balasan ke ${to}...`);
        await sockInstance.sendMessage(to, { text });
    } catch (err) {
        logger.error("Gagal mengirim pesan WhatsApp:", err.message);
    }
});

export async function startWA() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["Windows", "Chrome", "122.0.0.0"],
            printQRInTerminal: false,
            getMessage: async (key) => { return { conversation: 'getting messages' } },
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
        });

        sockInstance = sock;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                logger.info('--- SCAN QR SEKARANG ---');
                qrcode.generate(qr, { small: true });
            }
            if (connection === 'close') {
                sockInstance = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                logger.warn(`Terputus: ${statusCode}. Reconnect: ${shouldReconnect}`);
                if (shouldReconnect) setTimeout(() => startWA(), 5000);
            } else if (connection === 'open') {
                logger.info('✅ KASBOT TERHUBUNG KE WHATSAPP');
            }
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];

            if (!msg.message || msg.message.protocolMessage) return;
            if (msg.key.fromMe) return;

            logger.verbose('📩 Event masuk: ' + JSON.stringify(msg.key));

            const sender = msg.key.remoteJid;
            const senderAlt = msg.key.remoteJidAlt || null;

            if (sender.endsWith('@newsletter')) return;
            if (sender.endsWith('@g.us')) return;

            const type = Object.keys(msg.message)[0];
            logger.verbose(`📋 Tipe pesan: ${type}`);

            // ─── TIPE 1: Teks ─────────────────────────────
            if (type === 'conversation' || type === 'extendedTextMessage') {
                const text = msg.message.conversation
                    || msg.message.extendedTextMessage?.text
                    || '';
                if (!text) return;

                logger.verbose(`🔍 Teks: [${sender}] -> ${text}`);

                // ✅ Masukkan ke queue, bukan langsung proses
                await messageQueue.add('text-message', {
                    type: 'text',
                    payload: { sender, senderAlt, text, source_type: 'teks' }
                });
                return;
            }

            // ─── TIPE 2: Gambar ───────────────────────────
            if (type === 'imageMessage') {
                const caption = msg.message.imageMessage?.caption || '';
                logger.verbose(`🖼️ Gambar dari [${sender}]`);

                bus.emit('whatsapp.send_message', {
                    to: sender,
                    text: '🔍 Sedang membaca struk Anda...'
                });

                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    });

                    // ✅ Masukkan ke media queue
                    await mediaQueue.add('image-message', {
                        type: 'image',
                        payload: { sender, senderAlt, imageBuffer: buffer, caption, source_type: 'foto' }
                    });
                } catch (err) {
                    logger.error('Gagal download gambar:', err.message);
                    bus.emit('whatsapp.send_message', {
                        to: sender,
                        text: '❌ Gagal membaca gambar. Coba kirim ulang foto struk Anda.'
                    });
                }
                return;
            }

            // ─── TIPE 3: Voice Note ───────────────────────
            if (type === 'audioMessage') {
                const isPtt = msg.message.audioMessage?.ptt;
                if (!isPtt) return;

                logger.verbose(`🎙️ Voice note dari [${sender}]`);

                bus.emit('whatsapp.send_message', {
                    to: sender,
                    text: '🎙️ Sedang mendengarkan voice note Anda...'
                });

                try {
                    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    });

                    // ✅ Masukkan ke media queue
                    await mediaQueue.add('audio-message', {
                        type: 'audio',
                        payload: { sender, senderAlt, audioBuffer: buffer, source_type: 'suara' }
                    });
                } catch (err) {
                    logger.error('Gagal download audio:', err.message);
                    bus.emit('whatsapp.send_message', {
                        to: sender,
                        text: '❌ Gagal memproses voice note. Coba kirim ulang.'
                    });
                }
                return;
            }

            logger.verbose(`⚠️ Tipe pesan tidak didukung: ${type}`);
        });

    } catch (err) {
        logger.error('Error di startWA:', err);
    }
}