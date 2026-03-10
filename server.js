// server.js
import 'dotenv/config';
import logger from './src/shared/logger.js';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import './src/shared/redis.js';
import { startWA } from './src/modules/whatsapp/whatsapp.service.js';
import { startScheduler } from './src/shared/scheduler.js';

import './src/modules/ai-engine/ai.listener.js';
import './src/modules/finance/finance.listener.js';
import './src/modules/cfo-virtual/cfo.listener.js';
import './src/modules/media/media.listener.js';
import './src/modules/report/report.listener.js';
import './src/shared/errorHandler.js';
import './src/shared/queue.worker.js';

// API Routes
import { authRoutes }      from './src/api/routes/auth.routes.js';
import { waRoutes }        from './src/api/routes/wa.routes.js';
import { userRoutes }      from './src/api/routes/user.routes.js';
import { transaksiRoutes } from './src/api/routes/transaksi.routes.js';
import { laporanRoutes }   from './src/api/routes/laporan.routes.js';
import { anomaliRoutes }   from './src/api/routes/anomali.routes.js';
import { statsRoutes }     from './src/api/routes/stats.routes.js';
import { adminRoutes }     from './src/api/routes/admin.routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({ logger: false, disableRequestLogging: true });

// Static files
await fastify.register(fastifyStatic, {
    root: join(__dirname, 'public'),
    prefix: '/',
});

// Redirect root → docs
fastify.get('/', (req, reply) => reply.redirect('/api-doc.html'));

// Register API routes
await fastify.register(authRoutes,      { prefix: '/api/auth' });
await fastify.register(waRoutes,        { prefix: '/api/wa' });
await fastify.register(userRoutes,      { prefix: '/api/users' });
await fastify.register(transaksiRoutes, { prefix: '/api/transaksi' });
await fastify.register(laporanRoutes,   { prefix: '/api/laporan' });
await fastify.register(anomaliRoutes,   { prefix: '/api/anomali' });
await fastify.register(statsRoutes,     { prefix: '/api/stats' });
await fastify.register(adminRoutes,     { prefix: '/api/admin' });

// Global 404
fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ success: false, message: `Route ${request.method} ${request.url} tidak ditemukan` });
});

// Global error handler
fastify.setErrorHandler((error, request, reply) => {
    logger.error('API Error:', error.message);
    reply.code(error.statusCode || 500).send({ success: false, message: error.message });
});

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
        logger.info(`🚀 Server Aktif di http://localhost:${process.env.PORT || 3000}`);
        logger.info(`📄 API Docs: http://localhost:${process.env.PORT || 3000}/api-doc.html`);
        logger.info(`🗄️  Database: ${(process.env.DB_DRIVER || 'supabase').toUpperCase()}`);

        startScheduler();
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