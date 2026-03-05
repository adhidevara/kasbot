// src/modules/media/media.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { extractTextFromImage } from './ocr.service.js';
import { transcribeAudio } from './stt.service.js';

logger.info("👂 Media Listener: Aktif (OCR + STT)...");

// ─────────────────────────────────────────────
// HANDLER: Gambar → OCR → route ke AI
// ─────────────────────────────────────────────
bus.on('whatsapp.image_received', async ({ sender, senderAlt, imageBuffer, caption, source_type }) => {
    logger.verbose(`🖼️ Media Listener: Memproses gambar dari ${sender}...`);

    try {
        const ocrText = await extractTextFromImage(imageBuffer);

        // Gabungkan teks OCR + caption jika ada
        const fullText = caption
            ? `${ocrText}\n\nCatatan dari pengirim: ${caption}`
            : ocrText;

        logger.verbose(`✅ OCR selesai, forward ke AI...`);

        // Route ke AI pipeline yang sama seperti pesan teks
        bus.emit('whatsapp.message_received', {
            sender,
            senderAlt,
            text: fullText,
            source_type: 'foto'
        });

    } catch (err) {
        logger.error('❌ OCR Error:', err.message);

        const pesanError = err.message.includes('Tidak ada teks')
            ? '❌ Tidak ada teks yang terbaca pada foto. Pastikan foto struk cukup terang dan tidak buram.'
            : '❌ Gagal membaca struk. Coba foto ulang dengan pencahayaan yang lebih baik.';

        bus.emit('whatsapp.send_message', { to: sender, text: pesanError });
    }
});

// ─────────────────────────────────────────────
// HANDLER: Audio → STT → route ke AI
// ─────────────────────────────────────────────
bus.on('whatsapp.audio_received', async ({ sender, senderAlt, audioBuffer, source_type }) => {
    logger.verbose(`🎙️ Media Listener: Memproses voice note dari ${sender}...`);

    try {
        const transcript = await transcribeAudio(audioBuffer);

        logger.verbose(`✅ STT selesai: "${transcript}", forward ke AI...`);

        // Konfirmasi transkripsi ke user sebelum proses
        bus.emit('whatsapp.send_message', {
            to: sender,
            text: `🎙️ *Saya mendengar:*\n_"${transcript}"_\n\nSedang memproses...`
        });

        // Route ke AI pipeline yang sama
        bus.emit('whatsapp.message_received', {
            sender,
            senderAlt,
            text: transcript,
            source_type: 'suara'
        });

    } catch (err) {
        logger.error('❌ STT Error:', err.message);

        const pesanError = err.message.includes('Tidak ada suara')
            ? '❌ Voice note tidak terdengar. Coba rekam ulang dengan lebih jelas.'
            : '❌ Gagal memproses voice note. Coba kirim ulang.';

        bus.emit('whatsapp.send_message', { to: sender, text: pesanError });
    }
});