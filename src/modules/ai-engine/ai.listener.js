// src/modules/ai-engine/ai.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { processInput } from './ai.service.js';
import {
    isUserRegistered,
    isInOnboarding,
    startOnboarding,
    processOnboarding
} from '../onboarding/onboarding.service.js';
import { checkTransaksiLimit } from '../tier/tier.service.js';
import { isReportCommand, handleReportMenu } from '../report/report.listener.js';

logger.info("👂 AI Listener: Aktif dan menunggu sinyal dari WhatsApp...");

bus.on('whatsapp.message_received', async (payload) => {
    const { sender, senderAlt, text, source_type = 'teks', durasi_detik = 0 } = payload;
    const nomorWa = senderAlt || sender;

    logger.verbose(`📨 Pesan dari ${nomorWa}: "${text}"`);

    // ─────────────────────────────────────────
    // STEP 1: CEK REGISTRASI & ONBOARDING
    // ─────────────────────────────────────────
    const userProfile = await isUserRegistered(nomorWa);

    if (!userProfile) {
        if (await isInOnboarding(nomorWa)) {
            const { reply, done } = await processOnboarding(nomorWa, text);
            bus.emit('whatsapp.send_message', { to: sender, text: reply });
            if (done) logger.info(`✅ Onboarding selesai untuk ${nomorWa}`);
        } else {
            const welcomeMsg = await startOnboarding(nomorWa);
            bus.emit('whatsapp.send_message', { to: sender, text: welcomeMsg });
        }
        return;
    }

    if (!userProfile.onboarding_selesai) {
        if (await isInOnboarding(nomorWa)) {
            const { reply } = await processOnboarding(nomorWa, text);
            bus.emit('whatsapp.send_message', { to: sender, text: reply });
        } else {
            const welcomeMsg = await startOnboarding(nomorWa);
            bus.emit('whatsapp.send_message', { to: sender, text: welcomeMsg });
        }
        return;
    }

    // ─────────────────────────────────────────
    // STEP 2: CEK INTENT — LAPORAN?
    // ─────────────────────────────────────────
    const reportHandled = await handleReportMenu(nomorWa, sender, text, userProfile);
    if (reportHandled) return;

    const { isReport, periode } = isReportCommand(text);
    if (isReport) {
        bus.emit('report.requested', { sender, nomorWa, text, periode, userProfile });
        return;
    }

    // ─────────────────────────────────────────
    // STEP 3: CEK TOKEN
    // ─────────────────────────────────────────
    const accessCheck = await checkTransaksiLimit(nomorWa, source_type, durasi_detik);
    if (!accessCheck.allowed) {
        bus.emit('whatsapp.send_message', { to: sender, text: accessCheck.message });
        return;
    }

    // Warning token menipis — kirim tapi tetap lanjut proses
    if (accessCheck.warningToken) {
        bus.emit('whatsapp.send_message', { to: sender, text: accessCheck.warningToken });
    }

    // ─────────────────────────────────────────
    // STEP 4: PROSES AI
    // ─────────────────────────────────────────
    logger.verbose(`🤖 AI Engine: Memproses pesan dari ${nomorWa}...`);

    let aiResult;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            aiResult = await processInput(text, {
                kategori:   userProfile.kategori_bisnis || 'Umum',
                bahan_baku: userProfile.bahan_baku || []
            });
            break;
        } catch (error) {
            const is429 = error.status === 429 || error.message?.includes('429');
            if (is429 && attempt < 3) {
                const delay = attempt * 10000;
                logger.warn(`⏳ Rate limit Gemini. Retry ke-${attempt} dalam ${delay / 1000}s...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                logger.error("AI Engine Error:", error.message);
                bus.emit('whatsapp.send_message', {
                    to: sender,
                    text: "⚠️ Bot sedang sibuk, silakan kirim ulang pesan dalam beberapa detik."
                });
                return;
            }
        }
    }

    // AI tidak mengenali transaksi — token TIDAK dikurangi
    if (!aiResult || !aiResult.total) {
        logger.warn(`⚠️ AI tidak mengenali transaksi: "${text}"`);
        bus.emit('whatsapp.send_message', {
            to: sender,
            text:
                `🤔 Saya tidak dapat mengenali transaksi dari pesan tersebut.\n\n` +
                `Coba format seperti:\n` +
                `• _"jual ayam 5 ekor @50000"_\n` +
                `• _"beli tepung 2 kg @15000"_\n` +
                `• _"report hari ini, minggu ini, bulan ini"_\n` +
                `• _"pemasukan/pengeluaran untuk hari ini/minggu ini/bulan ini"_\n` +
                `• _[foto struk]_\n` +
                `• _[voice note]_`
        });
        return;
    }

    logger.info("✨ AI Berhasil Ekstraksi:", JSON.stringify(aiResult, null, 2));

    bus.emit('ai.processing_finished', {
        ...payload,
        ...aiResult,
        text,
        user_id:          userProfile.id,
        pengguna_id_alt:  nomorWa,
        remoteJidAlt:     senderAlt,
        source_type,
        kategori_bisnis:  userProfile.kategori_bisnis,
        plan:             accessCheck.plan,
        token_digunakan:  accessCheck.tokenDibutuhkan,
        token_sisa:       accessCheck.sisaToken,
    });
});