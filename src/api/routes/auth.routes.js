// src/api/routes/auth.routes.js
import bcrypt from 'bcrypt';
import { verifyToken, generateToken } from '../middleware/auth.middleware.js';
import { isUserRegistered, invalidateUserCache } from '../../modules/onboarding/onboarding.service.js';
import { db } from '../../config/db.js';

const SALT_ROUNDS = 10;

const PLAN_TOKEN_MAP = {
    trial:    50,
    starter:  300,
    business: 1000,
};

export async function authRoutes(fastify) {

    // ─── POST /api/auth/register ──────────────────────────────────────────────
    // Bypass onboarding — daftar langsung via API
    fastify.post('/register', async (request, reply) => {
        const {
            nama,
            nama_bisnis,
            email,
            password,
            nomor_wa,
            kategori_bisnis,
            bahan_baku,
            plan = 'trial',
        } = request.body || {};

        // Validasi wajib
        if (!nama || !nama_bisnis || !email || !password || !kategori_bisnis) {
            return reply.code(400).send({
                success: false,
                message: 'nama, nama_bisnis, email, password, dan kategori_bisnis wajib diisi',
            });
        }

        if (password.length < 6) {
            return reply.code(400).send({
                success: false,
                message: 'Password minimal 6 karakter',
            });
        }

        // Cek email sudah terdaftar
        const { data: existing } = await db
            .from('pengguna')
            .select('id')
            .eq('email', email)
            .single();

        if (existing) {
            return reply.code(409).send({
                success: false,
                message: 'Email sudah terdaftar',
            });
        }

        // Cek nomor WA kalau diisi
        if (nomor_wa) {
            const nomorFormatted = nomor_wa.includes('@') ? nomor_wa : `${nomor_wa}@s.whatsapp.net`;
            const existingWa = await isUserRegistered(nomorFormatted);
            if (existingWa) {
                return reply.code(409).send({
                    success: false,
                    message: 'Nomor WA sudah terdaftar',
                });
            }
        }

        // 2. SANITASI BAHAN BAKU
        // Pastikan bahan_baku selalu berupa Array sebelum masuk ke DB (mencegah error JSONB/Array di Postgres)
        const finalBahanBaku = Array.isArray(bahan_baku) ? bahan_baku : [];

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
        const nomorFormatted = nomor_wa
            ? (nomor_wa.includes('@') ? nomor_wa : `${nomor_wa}@s.whatsapp.net`)
            : null;

        const tokenAwal = PLAN_TOKEN_MAP[plan] ?? 50;
        const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

        const { data: user, error } = await db
            .from('pengguna')
            .insert([{
                nama,
                nama_bisnis,
                email,
                password_hash,
                nomor_wa:           nomorFormatted,
                kategori_bisnis,
                bahan_baku:         finalBahanBaku,
                onboarding_selesai: true,
                plan,
                trial_ends_at:      trialEnd.toISOString(),
                token_balance:      tokenAwal,
                token_total:        tokenAwal,
                token_reset_at:     new Date().toISOString(),
                updated_at:         new Date().toISOString(),
            }])
            .select('id, nama, nama_bisnis, email, nomor_wa, kategori_bisnis, plan, token_balance, trial_ends_at')
            .single();

        if (error) {
            return reply.code(500).send({ success: false, message: error.message });
        }

        const token = generateToken({
            id:        user.id,
            email:     user.email,
            nomor_wa:  user.nomor_wa,
            plan:      user.plan,
        });

        return reply.code(201).send({
            success: true,
            message: 'Registrasi berhasil',
            token,
            expires_in: 604800,
            user: {
                id:            user.id,
                nama:          user.nama,
                nama_bisnis:   user.nama_bisnis,
                email:         user.email,
                nomor_wa:      user.nomor_wa,
                kategori_bisnis: user.kategori_bisnis,
                plan:          user.plan,
                token_balance: user.token_balance,
                trial_ends_at: user.trial_ends_at,
            },
        });
    });

    // ─── POST /api/auth/login ─────────────────────────────────────────────────
    // Login via email + password atau nomor_wa + password
    fastify.post('/login', async (request, reply) => {
        const { email, nomor_wa, password } = request.body || {};

        if (!password || (!email && !nomor_wa)) {
            return reply.code(400).send({
                success: false,
                message: 'Email (atau nomor_wa) dan password wajib diisi',
            });
        }

        // Cari user by email atau nomor_wa
        let query = db.from('pengguna').select('*');
        if (email) {
            query = query.eq('email', email);
        } else {
            const nomorFormatted = nomor_wa.includes('@') ? nomor_wa : `${nomor_wa}@s.whatsapp.net`;
            query = query.eq('nomor_wa', nomorFormatted);
        }

        const { data: user } = await query.single();

        if (!user) {
            return reply.code(404).send({
                success: false,
                message: 'Email atau nomor WA tidak terdaftar',
            });
        }

        // User tanpa password (registrasi via WA onboarding) — tidak bisa login
        if (!user.password_hash) {
            return reply.code(400).send({
                success: false,
                message: 'Akun ini belum memiliki password. Gunakan login via WhatsApp.',
            });
        }

        // Verifikasi password
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return reply.code(401).send({
                success: false,
                message: 'Password salah',
            });
        }

        const token = generateToken({
            id:       user.id,
            email:    user.email,
            nomor_wa: user.nomor_wa,
            plan:     user.plan,
        });

        return reply.send({
            success: true,
            token,
            expires_in: 604800,
            user: {
                id:             user.id,
                nama:           user.nama,
                nama_bisnis:    user.nama_bisnis,
                email:          user.email,
                nomor_wa:       user.nomor_wa,
                kategori_bisnis: user.kategori_bisnis,
                plan:           user.plan,
                token_balance:  user.token_balance ?? 0,
                trial_ends_at:  user.trial_ends_at,
            },
        });
    });

    // ─── POST /api/auth/set-password ─────────────────────────────────────────
    // User WA onboarding yang ingin tambah email + password
    fastify.post('/set-password', { preHandler: [verifyToken] }, async (request, reply) => {
        const { email, password } = request.body || {};
        const { nomor_wa } = request.user;

        if (!email || !password) {
            return reply.code(400).send({ success: false, message: 'email dan password wajib diisi' });
        }

        if (password.length < 6) {
            return reply.code(400).send({ success: false, message: 'Password minimal 6 karakter' });
        }

        // Cek email belum dipakai user lain
        const { data: existing } = await db
            .from('pengguna')
            .select('id')
            .eq('email', email)
            .single();

        if (existing) {
            return reply.code(409).send({ success: false, message: 'Email sudah digunakan' });
        }

        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        await db.from('pengguna')
            .update({ email, password_hash, updated_at: new Date().toISOString() })
            .eq('nomor_wa', nomor_wa);

        await invalidateUserCache(nomor_wa);

        return reply.send({ success: true, message: 'Email dan password berhasil diset' });
    });

    // ─── POST /api/auth/change-password ──────────────────────────────────────
    fastify.post('/change-password', { preHandler: [verifyToken] }, async (request, reply) => {
        const { password_lama, password_baru } = request.body || {};
        const { nomor_wa, email } = request.user;

        if (!password_lama || !password_baru) {
            return reply.code(400).send({ success: false, message: 'password_lama dan password_baru wajib diisi' });
        }

        if (password_baru.length < 6) {
            return reply.code(400).send({ success: false, message: 'Password baru minimal 6 karakter' });
        }

        let query = db.from('pengguna').select('password_hash');
        if (nomor_wa) query = query.eq('nomor_wa', nomor_wa);
        else query = query.eq('email', email);

        const { data: user } = await query.single();

        if (!user?.password_hash) {
            return reply.code(400).send({ success: false, message: 'Akun belum memiliki password' });
        }

        const valid = await bcrypt.compare(password_lama, user.password_hash);
        if (!valid) {
            return reply.code(401).send({ success: false, message: 'Password lama salah' });
        }

        const password_hash = await bcrypt.hash(password_baru, SALT_ROUNDS);

        let updateQuery = db.from('pengguna').update({ password_hash, updated_at: new Date().toISOString() });
        if (nomor_wa) updateQuery = updateQuery.eq('nomor_wa', nomor_wa);
        else updateQuery = updateQuery.eq('email', email);

        await updateQuery;

        return reply.send({ success: true, message: 'Password berhasil diubah' });
    });
}