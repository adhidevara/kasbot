// src/modules/media/ocr.service.js
import logger from '../../shared/logger.js';
import fetch from 'node-fetch';

const VISION_API_URL = `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`;

/**
 * Ekstrak teks dari buffer gambar menggunakan Google Vision API
 * @param {Buffer} imageBuffer - Buffer gambar dari WhatsApp
 * @returns {string} - Teks hasil OCR
 */
export async function extractTextFromImage(imageBuffer) {
    // ✅ Deserialisasi Buffer dari BullMQ (sama seperti audio)
    const buf = Buffer.isBuffer(imageBuffer)
        ? imageBuffer
        : Buffer.from(imageBuffer.data);

    // ✅ Konversi Buffer ke Base64 untuk dikirim ke Vision API
    const base64Image = buf.toString('base64');

    // ✅ Siapkan request body untuk Vision API
    const requestBody = {
        requests: [{
            image: { content: base64Image },
            features: [
                { type: 'TEXT_DETECTION', maxResults: 1 },
                { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 } // Lebih akurat untuk struk
            ]
        }]
    };

    // ✅ Panggil Google Vision API
    const response = await fetch(VISION_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    // ✅ Tangani error dari API
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Vision API Error: ${response.status} - ${err}`);
    }

    // ✅ Ekstrak teks dari response API
    const data = await response.json();
    const annotation = data.responses?.[0];

    if (annotation?.error) {
        throw new Error(`Vision API: ${annotation.error.message}`);
    }

    // DOCUMENT_TEXT_DETECTION lebih akurat untuk struk
    const fullText = annotation?.fullTextAnnotation?.text
        || annotation?.textAnnotations?.[0]?.description
        || '';

    if (!fullText) {
        throw new Error('Tidak ada teks terdeteksi pada gambar.');
    }

    logger.verbose(`📄 OCR Result (${fullText.length} chars): ${fullText.substring(0, 100)}...`);
    return fullText.trim();
}