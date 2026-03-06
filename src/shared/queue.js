// src/shared/queue.js
import { Queue, Worker } from 'bullmq';
import logger from './logger.js';

const redisConnection = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
};

// ─── Queue: Antrian pesan masuk dari WhatsApp ─────────────────────────────────
export const messageQueue = new Queue('whatsapp-messages', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,                    // Retry 3x jika gagal
        backoff: {
            type: 'exponential',
            delay: 5000                 // 5s, 10s, 20s
        },
        removeOnComplete: 100,          // Simpan 100 job terakhir yang sukses
        removeOnFail: 200               // Simpan 200 job terakhir yang gagal
    }
});

// ─── Queue: Antrian media (OCR & STT) ────────────────────────────────────────
export const mediaQueue = new Queue('whatsapp-media', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 3000 },
        removeOnComplete: 50,
        removeOnFail: 100
    }
});

logger.info('📬 Queue system aktif (BullMQ + Redis)');

export { redisConnection };