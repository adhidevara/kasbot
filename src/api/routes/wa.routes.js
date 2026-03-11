// src/api/routes/wa.routes.js
import { verifyToken, verifyAdmin } from '../middleware/auth.middleware.js';
import { getWAStatus, getCurrentQR, disconnectWA, reconnectWA, sendWAMessage } from '../../modules/whatsapp/whatsapp.service.js';
import QRCode from 'qrcode';

function validateNomorWa(nomor) {
    const digits = nomor.replace(/\D/g, '');
    if (!digits.startsWith('62')) return { valid: false, message: 'Nomor WA harus diawali 62' };
    if (digits.length < 10 || digits.length > 15) return { valid: false, message: 'Nomor WA tidak valid' };
    return { valid: true, formatted: `${digits}@s.whatsapp.net` };
}

export async function waRoutes(fastify) {

    // GET /api/wa/status
    fastify.get('/status', { preHandler: [verifyToken] }, async (request, reply) => {
        return reply.send({ status: getWAStatus() });
    });

    // GET /api/wa/qr
    fastify.get('/qr', { preHandler: [verifyToken] }, async (request, reply) => {
        const status = getWAStatus();
        if (status !== 'waiting_qr') {
            return reply.code(400).send({
                success: false,
                message: `QR tidak tersedia. Status: ${status}`,
            });
        }
        const qrRaw = getCurrentQR();
        if (!qrRaw) {
            return reply.code(400).send({ success: false, message: 'QR belum tersedia' });
        }
        const qrBase64 = await QRCode.toDataURL(qrRaw);
        return reply.send({ qr: qrBase64 });
    });

    // POST /api/wa/reconnect
    fastify.post('/reconnect', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        reconnectWA(); // fire and forget — tidak await supaya response cepat
        return reply.send({ success: true, message: 'Reconnect dipicu. Cek status dalam beberapa detik.' });
    });

    // POST /api/wa/logout
    fastify.post('/logout', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        await disconnectWA();
        return reply.send({ success: true, message: 'WhatsApp berhasil disconnect' });
    });

    // POST /api/wa/send
    fastify.post('/send', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const { to, text } = request.body || {};
        if (!to || !text) {
            return reply.code(400).send({ success: false, message: 'to dan text wajib diisi' });
        }
        const waVal = validateNomorWa(to);
        if (!waVal.valid) return reply.code(400).send({ success: false, message: waVal.message });
        const toFormatted = waVal.formatted;
        if (getWAStatus() !== 'connected') {
            return reply.code(503).send({ success: false, message: 'WhatsApp belum terkoneksi' });
        }
        await sendWAMessage(toFormatted, text);
        return reply.send({ success: true, message: 'Pesan terkirim' });
    });
}