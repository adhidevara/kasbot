// server.js
import logger from './src/shared/logger.js';
import 'dotenv/config';
import Fastify from 'fastify';
import { startWA } from './src/modules/whatsapp/whatsapp.service.js';

import './src/modules/ai-engine/ai.listener.js';
import './src/modules/finance/finance.listener.js';
import './src/modules/cfo-virtual/cfo.listener.js';
import './src/modules/media/media.listener.js';
import './src/shared/errorHandler.js';
import './src/shared/queue.worker.js'; // ✅ Queue workers

const fastify = Fastify({ logger: false, disableRequestLogging: true });

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        logger.info('🚀 Server Aktif di http://localhost:3000');
        logger.info('--- Mencoba Koneksi WhatsApp ---');
        await startWA();
    } catch (err) {
        logger.error('Gagal Start:', err);
        process.exit(1);
    }
};

start();

// The Flow is:
// 1. User kirim pesan teks, gambar, atau voice note ke WhatsApp KasBot
// 2. WhatsApp Service menerima pesan dan emit event sesuai tipe media:
//   - 'whatsapp.message_received' untuk teks
//   - 'whatsapp.image_received' untuk gambar
//   - 'whatsapp.audio_received' untuk voice note
// 3. Media Listener menangani event gambar/audio, memproses OCR/STT, lalu emit 'whatsapp.message_received' dengan teks hasil ekstraksi
// 4. AI Listener menangani 'whatsapp.message_received', memproses dengan AI, lalu emit 'whatsapp.send_message' untuk balasan
// 5. WhatsApp Service menangani 'whatsapp.send_message' dan mengirim balasan ke user di WhatsApp
//    Dengan arsitektur event-driven ini, kita bisa dengan mudah menambahkan tipe media baru (misal video) atau integrasi AI baru tanpa merubah flow utama. Cukup buat listener baru untuk tipe media tersebut dan emit event yang sama ke AI Listener.
//    Catatan: Pastikan untuk menambahkan error handling yang baik di setiap listener agar tidak crash saat ada masalah dengan media atau API eksternal. Juga, log setiap langkah penting untuk memudahkan debugging dan monitoring.
//    Contoh: jika OCR gagal, kita bisa kirim pesan ke user untuk mencoba foto ulang dengan pencahayaan yang lebih baik, daripada hanya diam atau crash. Dengan begitu, pengalaman pengguna tetap terjaga meskipun ada kendala teknis.
//    Selain itu, kita bisa menambahkan fitur konfirmasi sebelum memproses AI, misalnya untuk voice note, kita bisa kirim pesan "Saya mendengar: [transkrip]. Apakah benar? Sedang memproses..." agar user tahu bahwa voice note mereka sudah diterima dan sedang diproses. Ini meningkatkan transparansi dan kepercayaan pengguna terhadap bot kita.