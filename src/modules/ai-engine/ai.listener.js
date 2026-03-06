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

logger.info("👂 AI Listener: Aktif dan menunggu sinyal dari WhatsApp...");

bus.on('whatsapp.message_received', async (payload) => {
    const { sender, senderAlt, text } = payload;
    const nomorWa = senderAlt || sender; // Gunakan nomor WA asli jika tersedia

    logger.verbose(`📨 Pesan dari ${nomorWa}: "${text}"`);

    // ─────────────────────────────────────────
    // STEP 1: CEK REGISTRASI & ONBOARDING
    // ─────────────────────────────────────────
    const userProfile = await isUserRegistered(nomorWa);

    // User belum terdaftar sama sekali
    if (!userProfile) {
        if (isInOnboarding(nomorWa)) {
            // Lanjutkan proses onboarding
            const { reply, done } = await processOnboarding(nomorWa, text);
            bus.emit('whatsapp.send_message', { to: sender, text: reply });
            if (done) logger.info(`✅ Onboarding selesai untuk ${nomorWa}`);
        } else {
            // Mulai onboarding baru
            const welcomeMsg = startOnboarding(nomorWa);
            bus.emit('whatsapp.send_message', { to: sender, text: welcomeMsg });
        }
        return;
    }

    // User terdaftar tapi onboarding belum selesai
    if (!userProfile.onboarding_selesai) {
        if (isInOnboarding(nomorWa)) {
            const { reply } = await processOnboarding(nomorWa, text);
            bus.emit('whatsapp.send_message', { to: sender, text: reply });
        } else {
            const welcomeMsg = startOnboarding(nomorWa);
            bus.emit('whatsapp.send_message', { to: sender, text: welcomeMsg });
        }
        return;
    }

    // ─────────────────────────────────────────
    // STEP 2: CEK TIER / BATAS TRANSAKSI
    // ─────────────────────────────────────────
    const accessCheck = await checkTransaksiLimit(nomorWa);
    if (!accessCheck.allowed) {
        bus.emit('whatsapp.send_message', { to: sender, text: accessCheck.message });
        return;
    }

    // Info sisa hari trial (sekali setiap hari, opsional)
    if (accessCheck.plan === 'trial' && accessCheck.sisaHari <= 3) {
        bus.emit('whatsapp.send_message', {
            to: sender,
            text: `⏰ *Reminder:* Trial Anda tersisa *${accessCheck.sisaHari} hari*. Segera upgrade agar data tidak terhenti.`
        });
    }

    // ─────────────────────────────────────────
    // STEP 3: PROSES AI
    // ─────────────────────────────────────────
    logger.verbose(`🤖 AI Engine: Memproses pesan dari ${nomorWa}...`);

    let aiResult;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            aiResult = await processInput(text, {
                kategori: userProfile.kategori_bisnis || 'Umum',
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
                logger.error("❌ AI Engine Error:", error.message);
                bus.emit('whatsapp.send_message', {
                    to: sender,
                    text: "⚠️ Bot sedang sibuk, silakan kirim ulang pesan dalam beberapa detik."
                });
                return;
            }
        }
    }

    if (!aiResult || aiResult.length === 0) {
        logger.warn(`⚠️ AI tidak menemukan data transaksi: "${text}"`);
        return;
    }

    logger.info(`✨ AI Berhasil Ekstraksi ${aiResult.length} transaksi:`, JSON.stringify(aiResult, null, 2));

    for (const transaksi of aiResult) {
        bus.emit('ai.processing_finished', {
            ...payload,
            ...transaksi,
            text,
            user_id: userProfile.id,
            pengguna_id_alt: nomorWa,
            remoteJidAlt: senderAlt,
            source_type: 'whatsapp',
            kategori_bisnis: userProfile.kategori_bisnis,
            plan: accessCheck.plan
        });
    }
});