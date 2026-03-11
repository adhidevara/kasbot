// src/api/routes/laporan.routes.js
import { verifyToken } from '../middleware/auth.middleware.js';
import { getUserProfile } from '../../modules/onboarding/onboarding.service.js';
import { generateLaporan } from '../../modules/report/report.service.js';
import { checkFitur } from '../../modules/tier/tier.service.js';
import { db } from '../../config/db.js';

function normalizeNomorWa(n) {
    if (!n || n.includes('@')) return n;
    return `${n}@s.whatsapp.net`;
}

export async function laporanRoutes(fastify) {

    // GET /api/laporan/:nomorWa/harian
    fastify.get('/:nomorWa/harian', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const laporan = await generateLaporan(user.id, 'harian');
        return reply.send(laporan);
    });

    // GET /api/laporan/:nomorWa/mingguan
    fastify.get('/:nomorWa/mingguan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const laporan = await generateLaporan(user.id, 'mingguan');
        return reply.send(laporan);
    });

    // GET /api/laporan/:nomorWa/bulanan — basic & pro only
    fastify.get('/:nomorWa/bulanan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const boleh = await checkFitur(normalizeNomorWa(nomorWa), 'fiturInsightMingguan');
        if (!boleh) {
            return reply.code(403).send({
                success: false,
                message: 'Laporan bulanan hanya tersedia untuk plan Starter, Business, dan Professional.',
            });
        }

        const laporan = await generateLaporan(user.id, 'bulanan');
        return reply.send(laporan);
    });

    // GET /api/laporan/:nomorWa/chart/mingguan — tren per hari dalam 7 hari terakhir
    fastify.get('/:nomorWa/chart/mingguan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

        // 1 query untuk 7 hari sekaligus
        const dari7 = new Date();
        dari7.setDate(dari7.getDate() - 6);
        const dariStr = dari7.toISOString().split('T')[0] + ' 00:00:00';

        const { data: trxAll } = await db.from('transaksi')
            .select('tipe, total, transaksi_at')
            .eq('pengguna_id', user.id)
            .gte('transaksi_at', dariStr);

        // Inisialisasi map 7 hari
        const map = {};
        for (let i = 6; i >= 0; i--) {
            const tgl = new Date();
            tgl.setDate(tgl.getDate() - i);
            const key = tgl.toISOString().split('T')[0];
            map[key] = { name: HARI[tgl.getDay()], pemasukan: 0, pengeluaran: 0 };
        }

        for (const t of (trxAll || [])) {
            const key = new Date(t.transaksi_at).toISOString().split('T')[0];
            if (map[key]) {
                if (t.tipe === 'pemasukan') map[key].pemasukan += Number(t.total);
                else map[key].pengeluaran += Number(t.total);
            }
        }

        return reply.send({ data: Object.values(map) });
    });

    // GET /api/laporan/:nomorWa/chart/bulanan — tren per hari dalam bulan ini
    fastify.get('/:nomorWa/chart/bulanan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { bulan } = request.query; // format: YYYY-MM, default bulan ini

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const target = bulan ? new Date(bulan + '-01') : new Date();
        const year   = target.getFullYear();
        const month  = target.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const dari   = new Date(year, month, 1).toISOString().split('T')[0] + ' 00:00:00';
        const sampai = new Date(year, month, daysInMonth).toISOString().split('T')[0] + ' 23:59:59';

        const { data: trx } = await db.from('transaksi')
            .select('tipe, total, transaksi_at')
            .eq('pengguna_id', user.id)
            .gte('transaksi_at', dari)
            .lte('transaksi_at', sampai);

        // Group by tanggal
        const map = {};
        for (let d = 1; d <= daysInMonth; d++) {
            map[d] = { name: String(d), pemasukan: 0, pengeluaran: 0 };
        }

        for (const t of (trx || [])) {
            const tgl = new Date(t.transaksi_at).getDate();
            if (map[tgl]) {
                if (t.tipe === 'pemasukan') map[tgl].pemasukan += Number(t.total);
                else map[tgl].pengeluaran += Number(t.total);
            }
        }

        return reply.send({ data: Object.values(map) });
    });

}