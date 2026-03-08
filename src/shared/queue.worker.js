// src/shared/queue.worker.js
import { Worker } from 'bullmq';
import { redisConnection } from './queue.js';
import bus from './eventBus.js';
import logger from './logger.js';

// ─── Worker: Proses pesan teks ────────────────────────────────────────────────
export const messageWorker = new Worker('whatsapp-messages', async (job) => {
    const { type, payload } = job.data;
    logger.verbose(`⚙️ Queue processing job [${job.id}] type: ${type}`);

    if (type === 'text') {
        bus.emit('whatsapp.message_received', payload);
    } else {
        logger.warn(`Queue: unknown job type "${type}"`);
    }
}, {
    connection: redisConnection,
    concurrency: 5,
});

messageWorker.on('completed', (job) => {
    logger.verbose(`✅ Job [${job.id}] selesai`);
});

messageWorker.on('failed', (job, err) => {
    logger.error(`Job [${job?.id}] gagal:`, err.message);
});

logger.info('⚙️ Queue worker aktif');