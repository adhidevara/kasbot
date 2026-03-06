// src/modules/media/stt.service.js
import logger from '../../shared/logger.js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Readable } from 'stream';

/**
 * Transkripsi audio voice note WhatsApp menggunakan OpenAI Whisper
 * @param {Buffer} audioBuffer - Buffer audio dari WhatsApp (.ogg/opus)
 * @returns {string} - Teks hasil transkripsi
 */
export async function transcribeAudio(audioBuffer) {
    // Siapkan form data untuk request ke Whisper API
    const formData = new FormData();

    // Deserialisasi Buffer yang di-serialize oleh BullMQ
    const buf = Buffer.isBuffer(audioBuffer)
        ? audioBuffer
        : Buffer.from(audioBuffer.data);  // audioBuffer.data adalah array of bytes

    // Debug: Pastikan buf sudah benar
    const stream = Readable.from([buf]);

    // WhatsApp kirim audio sebagai .ogg — Whisper support langsung
    formData.append('file', stream, {
        filename: 'audio.ogg',
        contentType: 'audio/ogg',
        knownLength: buf.length
    });
    formData.append('model', 'whisper-1');
    formData.append('language', 'id'); // Bahasa Indonesia
    formData.append('response_format', 'text');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            ...formData.getHeaders()
        },
        body: formData
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Whisper API Error: ${response.status} - ${err}`);
    }

    const transcript = await response.text();

    if (!transcript || transcript.trim() === '') {
        throw new Error('Tidak ada suara terdeteksi pada voice note.');
    }

    logger.verbose(`🎙️ Whisper Transcript: "${transcript.trim()}"`);
    return transcript.trim();
}