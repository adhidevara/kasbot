// src/modules/ai-engine/ai.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { processInput, generateComingSoonMessage } from './ai.service.js';
import {
    isUserRegistered,
    isInOnboarding,
    startOnboarding,
    processOnboarding,
    invalidateUserCache
} from '../onboarding/onboarding.service.js';
import { checkTransaksiLimit, deductToken } from '../tier/tier.service.js';
import { isReportCommand, handleReportMenu, isChatQuery } from '../report/report.listener.js';
import { db } from '../../config/db.js';

logger.info("👂 AI Listener: Aktif dan menunggu sinyal dari WhatsApp...");

bus.on('whatsapp.message_received', async (payload) => {
    const { sender, senderAlt, text, source_type = 'teks', durasi_detik = 0 } = payload;
    const nomorWa = senderAlt || sender;

    logger.verbose(`📨 Pesan dari ${nomorWa}: "${text}"`);

    // ─── STEP 1: CEK REGISTRASI & ONBOARDING ───
    const userProfile = await isUserRegistered(nomorWa);

    if (!userProfile) {
        logger.verbose(`🚫 Nomor tidak terdaftar, diabaikan: ${nomorWa}`);
        // if (await isInOnboarding(nomorWa)) {
        //     const { reply, done } = await processOnboarding(nomorWa, text);
        //     bus.emit('whatsapp.send_message', { to: sender, text: reply });
        //     if (done) logger.info(`✅ Onboarding selesai untuk ${nomorWa}`);
        // } else {
        //     const welcomeMsg = await startOnboarding(nomorWa);
        //     bus.emit('whatsapp.send_message', { to: sender, text: welcomeMsg });
        // }
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

    // ─── STEP 1b: COMING SOON — user terflagging, sistem belum aktif ───
    if (userProfile.is_comingsoon) {
        const comingSoonText = await generateComingSoonMessage({
            nama:           userProfile.nama,
            namaBisnis:     userProfile.nama_bisnis,
            kategoriBisnis: userProfile.kategori_bisnis,
            pesan:          text,
        });
        bus.emit('whatsapp.send_message', { to: sender, text: comingSoonText });
        return;
    }

    // ─── STEP 1c: SAPAAN PERTAMA untuk user VIP (register via API) ───
    if (!userProfile.welcomed) {
        const nama = userProfile.nama || userProfile.nama_bisnis || 'Kak';
        const namaBisnis = userProfile.nama_bisnis ? ` untuk *${userProfile.nama_bisnis}*` : '';
        const sisaToken = userProfile.token_balance ?? 15;

        bus.emit('whatsapp.send_message', {
            to: sender,
            text:
                `Halo *${nama}*! Salam kenal, aku *Nata* dari *KalaStudioAI* 👋\n\n` +
                `Aku sudah siap jadi asisten keuangan pribadi kamu${namaBisnis}.\n\n` +
                `Kamu punya *${sisaToken} Token* buat mencatat transaksi pakai *Teks*, *Voice Note*, atau *Foto Nota* — aku yang catat otomatis.\n\n` +
                `Yuk, coba kirim transaksi pertama kamu sekarang!\n` +
                `_Contoh: "jual ayam 10 ekor @50000" atau "beli pakan 50 kg @15000"_`
        });

        await db.from('pengguna')
            .update({ welcomed: true, updated_at: new Date().toISOString() })
            .eq('nomor_wa', nomorWa);
        await invalidateUserCache(nomorWa);
        return;
    }

    // ─── STEP 2: CEK LIMIT TOKEN (Global Check) ───
    const accessCheck = await checkTransaksiLimit(nomorWa, source_type, durasi_detik);
    if (!accessCheck.allowed) {
        bus.emit('whatsapp.send_message', { to: sender, text: accessCheck.message });
        return;
    }

    // ─── STEP 3: CEK INTENT (Laporan & Query) ───
    // Untuk pesan teks, cek apakah user sedang memilih menu laporan atau menanyakan saldo, atau langsung minta laporan
    if (source_type === 'teks' || source_type === 'suara') {
        // A. Handle Menu Laporan (Pilihan angka 1-3)
        const reportHandled = await handleReportMenu(nomorWa, sender, text, userProfile, accessCheck);
        if (reportHandled) {
            return;
        }

        // B. Tanya Pendapatan/Pengeluaran (Chat Query)
        const { isQuery, tipe: queryTipe, periode: queryPeriode } = isChatQuery(text);
        if (isQuery) {
            await deductToken(userProfile.id, nomorWa, accessCheck.tokenDibutuhkan);
            bus.emit('chat.query', { sender, nomorWa, tipe: queryTipe, periode: queryPeriode, userProfile, sisaToken: accessCheck.sisaToken });
            return;
        }

        // C. Perintah Laporan Langsung
        const { isReport, periode } = isReportCommand(text);
        if (isReport) {
            if (periode) {
                await deductToken(userProfile.id, nomorWa, accessCheck.tokenDibutuhkan);
            }
            bus.emit('report.requested', { sender, nomorWa, text, periode, userProfile, sisaToken: accessCheck.sisaToken });
            return;
        }
    }

    // ─── STEP 4: PROSES AI (Transaksi Baru) ───
    logger.verbose(`🤖 AI Engine: Memproses pesan dari ${nomorWa}...`);

    let aiResult;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            aiResult = await processInput(text, {
                kategori:      userProfile.kategori_bisnis || 'Umum',
                bahan_baku:    userProfile.bahan_baku || [],
                nama_pengguna: userProfile.nama || userProfile.nama_bisnis || null,
            });
            break;
        } catch (error) {
            const is429 = error.status === 429 || error.message?.includes('429');
            if (is429 && attempt < 3) {
                const delay = attempt * 10000;
                logger.warn(`⏳ Rate limit Gemini. Retry ke-${attempt}...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                logger.error("AI Engine Error:", error.message);
                bus.emit('whatsapp.send_message', { to: sender, text: "⚠️ Bot sedang sibuk, silakan coba lagi." });
                return;
            }
        }
    }

    if (!aiResult || !aiResult.total) {
        logger.warn(`⚠️ AI tidak mengenali transaksi: "${text}"`);
        bus.emit('whatsapp.send_message', {
            to: sender,
            text: `🤔 Saya tidak dapat mengenali transaksi tersebut. Coba format: "Jual ayam 2 @50rb"`
        });
        return;
    }

    // ─── STEP 5: DEDUCT TOKEN (Berhasil Ekstraksi) ───
    await deductToken(userProfile.id, nomorWa, accessCheck.tokenDibutuhkan);

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