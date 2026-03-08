// src/shared/queue.js
import { Queue } from 'bullmq';
import logger from './logger.js';

// ─── Parse REDIS_URL jika tersedia (Railway) ──────────────────────────────────
function getRedisConnection() {
    if (process.env.REDIS_URL) {
        const url = new URL(process.env.REDIS_URL);
        return {
            host: url.hostname,
            port: parseInt(url.port) || 6379,
            password: url.password || undefined,
            username: url.username || undefined,
        };
    }
    return {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
    };
}

export const redisConnection = getRedisConnection();

// ─── Queue: Antrian pesan teks dari WhatsApp ──────────────────────────────────
// ⚠️ Media (gambar/audio) TIDAK diqueue — buffer biner tidak bisa disimpan Redis
export const messageQueue = new Queue('whatsapp-messages', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s
        removeOnComplete: 100,
        removeOnFail: 200
    }
});

logger.info('📬 Queue system aktif (BullMQ + Redis)');