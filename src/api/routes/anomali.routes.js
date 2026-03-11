// src/api/routes/anomali.routes.js
import { verifyToken } from '../middleware/auth.middleware.js';
import { getUserProfile } from '../../modules/onboarding/onboarding.service.js';
import { generateInsightMingguan, detectAnomali } from '../../modules/anomaly/anomaly.service.js';
import { checkFitur } from '../../modules/tier/tier.service.js';

function normalizeNomorWa(n) {
    if (!n || n.includes('@')) return n;
    return `${n}@s.whatsapp.net`;
}

export async function anomaliRoutes(fastify) {

    // GET /api/anomali/:nomorWa/insight — basic & pro only
    fastify.get('/:nomorWa/insight', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const boleh = await checkFitur(normalizeNomorWa(nomorWa), 'fiturAnomali');
        if (!boleh) {
            return reply.code(403).send({
                success: false,
                message: 'Fitur anomali & insight hanya tersedia untuk plan Starter, Business, dan Professional.',
            });
        }

        const { bulan } = request.query; // opsional: YYYY-MM, default bulan ini
        const insight = await generateInsightMingguan(user.id, user.kategori_bisnis, bulan || null);
        if (!insight) return reply.code(404).send({ success: false, message: 'Belum ada transaksi bulan ini' });
        return reply.send(insight);
    });

    // POST /api/anomali/:nomorWa/detect — cek satu nominal
    fastify.post('/:nomorWa/detect', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { nominal, tipe } = request.body || {};

        if (!nominal || !tipe) {
            return reply.code(400).send({ success: false, message: 'nominal dan tipe wajib diisi' });
        }
        if (!['pemasukan', 'pengeluaran'].includes(tipe)) {
            return reply.code(400).send({ success: false, message: 'tipe harus pemasukan atau pengeluaran' });
        }

        const boleh = await checkFitur(normalizeNomorWa(nomorWa), 'fiturAnomali');
        if (!boleh) {
            return reply.code(403).send({
                success: false,
                message: 'Fitur anomali hanya tersedia untuk plan Starter, Business, dan Professional.',
            });
        }

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const result = await detectAnomali(user.id, Number(nominal), tipe);
        return reply.send(result);
    });
}