// src/api/routes/stats.routes.js
import { verifyToken, verifyAdmin } from '../middleware/auth.middleware.js';
import { db } from '../../config/db.js';
import { getWAStatus } from '../../modules/whatsapp/whatsapp.service.js';

export async function statsRoutes(fastify) {

    // GET /api/stats — statistik sistem (admin)
    fastify.get('/', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

        // Query paralel
        const [
            { data: allUsers },
            { data: trxHariIni },
            { data: activeToday },
        ] = await Promise.all([
            db.from('pengguna').select('plan'),
            db.from('transaksi').select('id').gte('transaksi_at', startOfDay),
            db.from('transaksi').select('pengguna_id').gte('transaksi_at', startOfDay),
        ]);

        const byPlan = { trial: 0, starter: 0, business: 0, professional: 0 };
        for (const u of (allUsers || [])) {
            if (byPlan[u.plan] !== undefined) byPlan[u.plan]++;
        }

        const uniqueActiveUsers = new Set((activeToday || []).map(t => t.pengguna_id)).size;

        return reply.send({
            users: {
                total: allUsers?.length ?? 0,
                aktif_hari_ini: uniqueActiveUsers,
                by_plan: byPlan,
            },
            transaksi_hari_ini: trxHariIni?.length ?? 0,
            wa_status: getWAStatus(),
            db_driver: process.env.DB_DRIVER || 'supabase',
            uptime_detik: Math.floor(process.uptime()),
            timestamp: now.toISOString(),
        });
    });
}