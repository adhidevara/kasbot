// src/shared/redis.js
import { createClient } from 'redis';
import logger from './logger.js';

// Railway menyediakan REDIS_URL, fallback ke host/port manual
const client = createClient(
    process.env.REDIS_URL
        ? { url: process.env.REDIS_URL }
        : {
            socket: {
                host: process.env.REDIS_HOST || '127.0.0.1',
                port: parseInt(process.env.REDIS_PORT) || 6379,
            },
            password: process.env.REDIS_PASSWORD || undefined,
        }
);

client.on('error', (err) => logger.error('Redis client error:', err.message));
client.on('connect', () => logger.info('🔴 Redis cache terhubung'));

await client.connect();

// ─── Helper: get/set/del dengan JSON auto-parse ───────────────────────────────
export async function cacheGet(key) {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
}

export async function cacheSet(key, value, ttlSeconds) {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

export async function cacheDel(key) {
    await client.del(key);
}

export default client;