// src/modules/media/media.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { extractTextFromImage } from './ocr.service.js';
import { transcribeAudio } from './stt.service.js';

logger.info("👂 Media Listener: Aktif (OCR + STT)...");

// ─── Helper: hitung durasi audio dari buffer (format OGG/WebP Baileys) ────────
function getDurasiDetik(audioBuffer) {
    try {
        // OGG Opus header — durasi ada di granule position
        // Cara sederhana: estimasi dari ukuran file
        // Voice note WA biasanya ~12-16 KB/detik untuk Opus 16kbps
        const KB = audioBuffer.length / 1024;
        const estimasi = Math.ceil(KB / 2); // konservatif: 2 KB/detik
        return Math.max(1, estimasi);
    } catch {
        return 15; // fallback: anggap 15 detik = 1 token
    }
}

// ─────────────────────────────────────────
// HANDLER: Gambar → OCR → route ke AI
// ─────────────────────────────────────────
bus.on('whatsapp.image_received', async ({ sender, senderAlt, imageBuffer, caption, source_type }) => {
    logger.verbose(`🖼️ Media Listener: Memproses gambar dari ${sender}...`);

    try {
        const ocrText = await extractTextFromImage(imageBuffer);

        const fullText = caption
            ? `${ocrText}\n\nCatatan dari pengirim: ${caption}`
            : ocrText;

        logger.verbose(`✅ OCR selesai, forward ke AI...`);

        bus.emit('whatsapp.message_received', {
            sender,
            senderAlt,
            text:        fullText,
            source_type: 'foto',
            // foto = 1 token flat, tidak perlu durasi
        });

    } catch (err) {
        logger.error('❌ OCR Error:', err.message);

        const pesanError = err.message.includes('Tidak ada teks')
            ? '❌ Tidak ada teks yang terbaca pada foto. Pastikan foto struk cukup terang dan tidak buram.'
            : '❌ Gagal membaca struk. Coba foto ulang dengan pencahayaan yang lebih baik.';

        bus.emit('whatsapp.send_message', { to: sender, text: pesanError });
    }
});

// ─────────────────────────────────────────
// HANDLER: Audio → STT → route ke AI
// ─────────────────────────────────────────
bus.on('whatsapp.audio_received', async ({ sender, senderAlt, audioBuffer, source_type }) => {
    logger.verbose(`🎙️ Media Listener: Memproses voice note dari ${sender}...`);

    try {
        // Estimasi durasi sebelum transcribe — untuk cek token di ai.listener
        const durasiDetik = getDurasiDetik(audioBuffer);
        logger.verbose(`⏱️ Estimasi durasi voice note: ${durasiDetik} detik`);

        const transcript = await transcribeAudio(audioBuffer);

        logger.verbose(`✅ STT selesai: "${transcript}", forward ke AI...`);

        bus.emit('whatsapp.send_message', {
            to:   sender,
            text: `🎙️ *Saya mendengar:*\n_"${transcript}"_\n\nSedang memproses...`
        });

        bus.emit('whatsapp.message_received', {
            sender,
            senderAlt,
            text:         transcript,
            source_type:  'suara',
            durasi_detik: durasiDetik, // ← dikirim ke ai.listener untuk hitung token
        });

    } catch (err) {
        logger.error('❌ STT Error:', err.message);

        const pesanError = err.message.includes('Tidak ada suara')
            ? '❌ Voice note tidak terdengar. Coba rekam ulang dengan lebih jelas.'
            : '❌ Gagal memproses voice note. Coba kirim ulang.';

        bus.emit('whatsapp.send_message', { to: sender, text: pesanError });
    }
});