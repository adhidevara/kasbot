// src/api/routes/admin.routes.js
// Endpoint admin untuk manajemen token & plan
// Protected by JWT middleware

import { topUpToken, setPlan } from '../../modules/tier/tier.service.js';
import { isUserRegistered } from '../../modules/onboarding/onboarding.service.js';

export async function adminRoutes(fastify) {

    // ─── GET /admin/user/:nomorWa ─────────────────────────────────────────────
    // Lihat info user + token
    fastify.get('/user/:nomorWa', async (req, reply) => {
        const { nomorWa } = req.params;
        const nomorFormatted = nomorWa.includes('@') ? nomorWa : `${nomorWa}@s.whatsapp.net`;

        const user = await isUserRegistered(nomorFormatted);
        if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

        return reply.send({
            id:            user.id,
            nomor_wa:      user.nomor_wa,
            nama_bisnis:   user.nama_bisnis,
            plan:          user.plan,
            token_balance: user.token_balance ?? 0,
            token_total:   user.token_total   ?? 0,
            token_reset_at: user.token_reset_at,
            trial_ends_at: user.trial_ends_at,
        });
    });

    // ─── POST /admin/token/topup ──────────────────────────────────────────────
    // Body: { nomor_wa: "6282...", jumlah: 100 }
    fastify.post('/token/topup', async (req, reply) => {
        const { nomor_wa, jumlah } = req.body || {};

        if (!nomor_wa || !jumlah || jumlah <= 0) {
            return reply.code(400).send({ error: 'nomor_wa dan jumlah (> 0) wajib diisi' });
        }

        const nomorFormatted = nomor_wa.includes('@') ? nomor_wa : `${nomor_wa}@s.whatsapp.net`;
        const result = await topUpToken(nomorFormatted, Number(jumlah));

        if (!result.success) {
            return reply.code(404).send({ error: result.message });
        }

        return reply.send({
            success:     true,
            nomor_wa:    nomorFormatted,
            added:       result.added,
            new_balance: result.newBalance,
        });
    });

    // ─── POST /admin/plan/set ─────────────────────────────────────────────────
    // Body: { nomor_wa: "6282...", plan: "starter" | "business" | "trial" }
    fastify.post('/plan/set', async (req, reply) => {
        const { nomor_wa, plan } = req.body || {};

        if (!nomor_wa || !plan) {
            return reply.code(400).send({ error: 'nomor_wa dan plan wajib diisi' });
        }

        const nomorFormatted = nomor_wa.includes('@') ? nomor_wa : `${nomor_wa}@s.whatsapp.net`;
        const result = await setPlan(nomorFormatted, plan);

        if (!result.success) {
            return reply.code(400).send({ error: result.message });
        }

        return reply.send({
            success:       true,
            nomor_wa:      nomorFormatted,
            plan:          result.plan,
            token_balance: result.tokenBalance,
        });
    });
}