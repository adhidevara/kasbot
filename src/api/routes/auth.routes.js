// src/api/routes/auth.routes.js
import { verifyToken, generateToken } from '../middleware/auth.middleware.js';
import { isUserRegistered } from '../../modules/onboarding/onboarding.service.js';

export async function authRoutes(fastify) {

    // POST /api/auth/login
    fastify.post('/login', async (request, reply) => {
        const { nomor_wa } = request.body || {};
        if (!nomor_wa) {
            return reply.code(400).send({ success: false, message: 'nomor_wa wajib diisi' });
        }

        const user = await isUserRegistered(nomor_wa);
        if (!user) {
            return reply.code(404).send({ success: false, message: 'Nomor WA tidak terdaftar' });
        }

        const token = generateToken({ nomor_wa: user.nomor_wa, plan: user.plan });
        return reply.send({
            token,
            expires_in: 604800,
            user: {
                nomor_wa: user.nomor_wa,
                nama_bisnis: user.nama_bisnis,
                plan: user.plan,
            },
        });
    });
}