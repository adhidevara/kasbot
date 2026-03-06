// src/shared/queue.worker.js
import { Worker } from 'bullmq';
import { redisConnection, messageQueue, mediaQueue } from './queue.js';
import bus from './eventBus.js';
import logger from './logger.js';

// ─── Worker: Proses pesan teks ────────────────────────────────────────────────
export const messageWorker = new Worker('whatsapp-messages', async (job) => {
    const { type, payload } = job.data;
    logger.verbose(`⚙️ Queue processing job [${job.id}] type: ${type}`);

    switch (type) {
        case 'text':
            bus.emit('whatsapp.message_received', payload);
            break;
        default:
            logger.warn(`Queue: unknown job type "${type}"`);
    }
}, {
    connection: redisConnection,
    concurrency: 5,     // Proses 5 pesan bersamaan maksimal
});

// ─── Worker: Proses media (OCR & STT) ────────────────────────────────────────
export const mediaWorker = new Worker('whatsapp-media', async (job) => {
    const { type, payload } = job.data;
    logger.verbose(`⚙️ Queue processing media job [${job.id}] type: ${type}`);

    switch (type) {
        case 'image':
            bus.emit('whatsapp.image_received', payload);
            break;
        case 'audio':
            bus.emit('whatsapp.audio_received', payload);
            break;
        default:
            logger.warn(`Queue: unknown media type "${type}"`);
    }
}, {
    connection: redisConnection,
    concurrency: 3,     // OCR/STT lebih berat, batasi 3 bersamaan
});

// ─── Event handlers ───────────────────────────────────────────────────────────
messageWorker.on('completed', (job) => {
    logger.verbose(`✅ Job [${job.id}] selesai`);
});

messageWorker.on('failed', (job, err) => {
    logger.error(`Job [${job?.id}] gagal:`, err.message);
});

mediaWorker.on('failed', (job, err) => {
    logger.error(`Media job [${job?.id}] gagal:`, err.message);
});

logger.info('⚙️ Queue workers aktif');