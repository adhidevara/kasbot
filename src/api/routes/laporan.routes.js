// src/api/routes/laporan.routes.js
import { verifyToken } from '../middleware/auth.middleware.js';
import { getUserProfile } from '../../modules/onboarding/onboarding.service.js';
import { generateLaporan } from '../../modules/report/report.service.js';
import { checkFitur } from '../../modules/tier/tier.service.js';

export async function laporanRoutes(fastify) {

    // GET /api/laporan/:nomorWa/harian
    fastify.get('/:nomorWa/harian', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(nomorWa);
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const laporan = await generateLaporan(user.id, 'harian');
        return reply.send(laporan);
    });

    // GET /api/laporan/:nomorWa/mingguan
    fastify.get('/:nomorWa/mingguan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(nomorWa);
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const laporan = await generateLaporan(user.id, 'mingguan');
        return reply.send(laporan);
    });

    // GET /api/laporan/:nomorWa/bulanan — basic & pro only
    fastify.get('/:nomorWa/bulanan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(nomorWa);
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const boleh = await checkFitur(nomorWa, 'fiturInsightMingguan');
        if (!boleh) {
            return reply.code(403).send({
                success: false,
                message: 'Laporan bulanan hanya tersedia untuk plan Basic dan Pro.',
            });
        }

        const laporan = await generateLaporan(user.id, 'bulanan');
        return reply.send(laporan);
    });
}
