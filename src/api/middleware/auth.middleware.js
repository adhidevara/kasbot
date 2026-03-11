// src/api/middleware/auth.middleware.js
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'kala-studio-secret-ganti-di-production';
const ADMIN_WA = process.env.ADMIN_WA;

export function verifyToken(request, reply, done) {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ success: false, message: 'Token tidak ditemukan' });
    }
    const token = authHeader.slice(7);
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        request.user = decoded;
        done();
    } catch {
        reply.code(401).send({ success: false, message: 'Token tidak valid atau sudah expired' });
    }
}

export function verifyAdmin(request, reply, done) {
    // Normalize keduanya sebelum compare (support dengan/tanpa @s.whatsapp.net)
    const normalize = (n) => n?.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    const userWa  = normalize(request.user?.nomor_wa);
    const adminWa = normalize(ADMIN_WA);

    const isAdminEmail = process.env.ADMIN_EMAIL && request.user?.email === process.env.ADMIN_EMAIL;

    if (!isAdminEmail && userWa !== adminWa) {
        return reply.code(403).send({ success: false, message: 'Akses ditolak. Admin only.' });
    }
    done();
}

export function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET);
}