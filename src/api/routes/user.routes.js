// src/api/routes/user.routes.js
import { verifyToken, verifyAdmin } from '../middleware/auth.middleware.js';
import { db } from '../../config/db.js';
import {
    isUserRegistered,
    getUserProfile,
    invalidateUserCache,
} from '../../modules/onboarding/onboarding.service.js';
import { checkAccess, getPlanStatusMessage } from '../../modules/tier/tier.service.js';

export async function userRoutes(fastify) {

    // GET /api/users — list semua pengguna (admin)
    fastify.get('/', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const { plan, limit = 20, page = 1 } = request.query;
        const offset = (page - 1) * limit;

        let query = db.from('pengguna').select('id, nomor_wa, nama_bisnis, kategori_bisnis, plan, trial_ends_at, onboarding_selesai, created_at');
        if (plan) query = query.eq('plan', plan);

        const { data, error } = await query.order('created_at', { ascending: false }).limit(Number(limit));
        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({
            data,
            pagination: { page: Number(page), limit: Number(limit), total: data.length },
        });
    });

    // POST /api/users/register — daftarkan pengguna baru (admin)
    fastify.post('/register', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const { nomor_wa, nama_bisnis, kategori_bisnis, bahan_baku = [], plan = 'trial', trial_ends_at } = request.body || {};

        if (!nomor_wa || !nama_bisnis || !kategori_bisnis) {
            return reply.code(400).send({ success: false, message: 'nomor_wa, nama_bisnis, dan kategori_bisnis wajib diisi' });
        }

        // Cek sudah terdaftar
        const existing = await isUserRegistered(nomor_wa);
        if (existing) {
            return reply.code(409).send({ success: false, message: 'Nomor WA sudah terdaftar' });
        }

        const trialEnd = trial_ends_at
            ? new Date(trial_ends_at)
            : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        const PLAN_TOKEN_MAP = { trial: 50, starter: 300, business: 1000 };
        const tokenAwal = PLAN_TOKEN_MAP[plan] ?? 50;

        const { data, error } = await db.from('pengguna').insert([{
            nomor_wa,
            nama_bisnis,
            kategori_bisnis,
            bahan_baku,
            onboarding_selesai: true,
            plan,
            trial_ends_at:  trialEnd.toISOString(),
            token_balance:  tokenAwal,
            token_total:    tokenAwal,
            token_reset_at: new Date().toISOString(),
            updated_at:     new Date().toISOString(),
        }])
        .select('*')
        .single();

        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.code(201).send({
            success: true,
            message: 'Pengguna berhasil didaftarkan',
            user: {
                nomor_wa,
                nama_bisnis,
                plan,
                trial_ends_at: trialEnd.toISOString(),
            },
        });
    });

    // GET /api/users/:nomorWa — profil pengguna
    fastify.get('/:nomorWa', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const user = await getUserProfile(nomorWa);
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });
        return reply.send(user);
    });

    // PATCH /api/users/:nomorWa — update profil
    fastify.patch('/:nomorWa', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const allowedFields = ['nama_bisnis', 'kategori_bisnis', 'bahan_baku', 'threshold_alert'];
        const updateData = {};
        for (const field of allowedFields) {
            if (request.body?.[field] !== undefined) updateData[field] = request.body[field];
        }

        if (!Object.keys(updateData).length) {
            return reply.code(400).send({ success: false, message: 'Tidak ada field yang diupdate' });
        }

        const { error } = await db.from('pengguna').update(updateData).eq('nomor_wa', nomorWa);
        if (error) return reply.code(500).send({ success: false, message: error.message });

        await invalidateUserCache(nomorWa);
        return reply.send({ success: true, message: 'Profil berhasil diupdate' });
    });

    // GET /api/users/:nomorWa/plan — status plan & kuota
    fastify.get('/:nomorWa/plan', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const access = await checkAccess(nomorWa);
        if (!access.allowed && access.reason !== 'trial_expired') {
            return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });
        }

        if (access.reason === 'trial_expired') {
            return reply.code(403).send({
                success: false,
                plan: 'trial_expired',
                message: 'Trial Anda sudah berakhir.',
            });
        }

        return reply.send({
            plan:          access.plan,
            label:         access.config?.label,
            trial_ends_at: access.plan === 'trial' ? access.user?.trial_ends_at : null,
            token: {
                balance: access.tokenBalance,
                total:   access.user?.token_total ?? 0,
                reset_at: access.user?.token_reset_at ?? null,
            },
            fitur: {
                anomali:          access.config?.fiturAnomali ?? false,
                insight_mingguan: access.config?.fiturInsightMingguan ?? false,
            },
        });
    });

    // PATCH /api/users/:nomorWa/plan — upgrade/downgrade plan (admin)
    fastify.patch('/:nomorWa/plan', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { plan, trial_ends_at } = request.body || {};

        const validPlans = ['trial', 'starter', 'business', 'professional'];
        if (!plan || !validPlans.includes(plan)) {
            return reply.code(400).send({ success: false, message: `plan harus salah satu dari: ${validPlans.join(', ')}` });
        }

        // Import setPlan dari tier.service untuk reset token sekaligus
        const { setPlan } = await import('../../modules/tier/tier.service.js');
        const result = await setPlan(nomorWa, plan);
        if (!result.success) {
            return reply.code(400).send({ success: false, message: result.message });
        }

        // Update trial_ends_at kalau ada
        if (trial_ends_at) {
            await db.from('pengguna').update({ trial_ends_at }).eq('nomor_wa', nomorWa);
            await invalidateUserCache(nomorWa);
        }

        return reply.send({
            success:       true,
            message:       `Plan diupdate ke ${plan}`,
            token_balance: result.tokenBalance,
        });
    });

    // DELETE /api/users/:nomorWa — hapus pengguna (admin)
    fastify.delete('/:nomorWa', { preHandler: [verifyToken, verifyAdmin] }, async (request, reply) => {
        const { nomorWa } = request.params;

        // Cek ada
        const user = await getUserProfile(nomorWa);
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        // Hapus cascade via FK — cukup hapus pengguna
        const { error } = await db.from('pengguna').delete().eq('nomor_wa', nomorWa);
        if (error) return reply.code(500).send({ success: false, message: error.message });

        await invalidateUserCache(nomorWa);
        return reply.send({ success: true, message: 'Pengguna dan seluruh data berhasil dihapus' });
    });

    // POST /api/users/:nomorWa/cache/invalidate
    fastify.post('/:nomorWa/cache/invalidate', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        await invalidateUserCache(nomorWa);
        return reply.send({ success: true, message: 'Cache berhasil dihapus' });
    });
}