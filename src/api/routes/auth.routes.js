// src/api/routes/auth.routes.js
import bcrypt from 'bcrypt';
import { verifyToken, generateToken } from '../middleware/auth.middleware.js';
import { isUserRegistered, invalidateUserCache } from '../../modules/onboarding/onboarding.service.js';
import { db } from '../../config/db.js';

const SALT_ROUNDS = 10;

const PLAN_TOKEN_MAP = {
    trial:        15,
    starter:      300,
    business:     1000,
    professional: null, // unlimited
};

// ─── Helper: validasi & normalize nomor WA ───────────────────────────────────
function validateNomorWa(nomor_wa) {
    if (!nomor_wa) return { valid: true, formatted: null }; // opsional

    // Strip non-digit
    const digits = nomor_wa.replace(/\D/g, '');

    // Harus diawali 62 dan panjang 10-15 digit
    if (!digits.startsWith('62')) {
        return { valid: false, message: 'Nomor WA harus diawali 62 (format internasional Indonesia)' };
    }
    if (digits.length < 10 || digits.length > 15) {
        return { valid: false, message: 'Nomor WA tidak valid (terlalu pendek atau panjang)' };
    }

    return { valid: true, formatted: `${digits}@s.whatsapp.net` };
}

export async function authRoutes(fastify) {

    // ─── POST /api/auth/register ──────────────────────────────────────────────
    // Registrasi mandiri — satu endpoint untuk semua jalur pendaftaran
    fastify.post('/register', async (request, reply) => {
        // ── Required ─────────────────────────────────────────────────────────
        const {
            nomor_wa,
            nama_bisnis,
            kategori_bisnis,
            email,
            password,
            nama,
        } = request.body || {};

        if (!nomor_wa || !nama_bisnis || !kategori_bisnis || !email || !password || !nama) {
            return reply.code(400).send({
                success: false,
                message: 'nomor_wa, nama_bisnis, kategori_bisnis, email, password, dan nama wajib diisi',
            });
        }

        if (password.length < 6) {
            return reply.code(400).send({
                success: false,
                message: 'Password minimal 6 karakter',
            });
        }

        // ── Optional ─────────────────────────────────────────────────────────
        const {
            bahan_baku        = [],
            threshold_alert   = {},
            alamat            = null,
            plan              = 'trial',
            trial_ends_at     = null,
            token_balance     = null,
            token_total       = null,
            welcomed          = true,
            onboarding_selesai = true,
            is_comingsoon     = false,
            token_warning_sent = false,
        } = request.body || {};

        // Validasi plan
        const validPlans = ['trial', 'starter', 'business', 'professional'];
        if (!validPlans.includes(plan)) {
            return reply.code(400).send({
                success: false,
                message: `plan harus salah satu dari: ${validPlans.join(', ')}`,
            });
        }

        // Validasi & normalize nomor WA
        const waValidation = validateNomorWa(nomor_wa);
        if (!waValidation.valid) {
            return reply.code(400).send({ success: false, message: waValidation.message });
        }
        const nomorFormatted = waValidation.formatted;

        // Cek duplikat nomor WA
        const existingWa = await isUserRegistered(nomorFormatted);
        if (existingWa) {
            return reply.code(409).send({
                success: false,
                message: 'Nomor WA sudah terdaftar',
            });
        }

        // Cek duplikat email
        const { data: existingEmail } = await db
            .from('pengguna')
            .select('id')
            .eq('email', email)
            .single();

        if (existingEmail) {
            return reply.code(409).send({
                success: false,
                message: 'Email sudah terdaftar',
            });
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        // Token awal — pakai nilai dari body jika diisi, fallback ke plan default
        const tokenDefault = PLAN_TOKEN_MAP[plan] ?? 15;
        const finalTokenBalance = token_balance !== null ? token_balance : tokenDefault;
        const finalTokenTotal   = token_total   !== null ? token_total   : tokenDefault;

        // trial_ends_at — pakai dari body jika diisi, fallback +7 hari
        const finalTrialEnd = trial_ends_at
            ? new Date(trial_ends_at)
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        const insertData = {
            nomor_wa:           nomorFormatted,
            nama_bisnis,
            kategori_bisnis,
            email,
            password_hash,
            nama,
            bahan_baku:         Array.isArray(bahan_baku) ? bahan_baku : [],
            threshold_alert:    typeof threshold_alert === 'object' ? threshold_alert : {},
            alamat,
            plan,
            trial_ends_at:      finalTrialEnd.toISOString(),
            welcomed,
            onboarding_selesai,
            is_comingsoon,
            token_warning_sent,
            token_reset_at:     new Date().toISOString(),
            updated_at:         new Date().toISOString(),
        };

        // Professional = unlimited, tidak simpan balance
        if (plan !== 'professional') {
            insertData.token_balance = finalTokenBalance;
            insertData.token_total   = finalTokenTotal;
        }

        const { data: user, error } = await db
            .from('pengguna')
            .insert([insertData])
            .select('*')
            .single();

        if (error) {
            return reply.code(500).send({ success: false, message: error.message });
        }

        const token = generateToken({
            id:       user.id,
            email:    user.email,
            nomor_wa: user.nomor_wa,
            plan:     user.plan,
        });

        const { password_hash: _, ...safeUser } = user;

        return reply.code(201).send({
            success: true,
            message: 'Registrasi berhasil',
            token,
            user: safeUser,
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
            const waValidation = validateNomorWa(nomor_wa);
            if (!waValidation.valid) {
                return reply.code(400).send({ success: false, message: waValidation.message });
            }
            query = query.eq('nomor_wa', waValidation.formatted);
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
            user: {
                id:             user.id,
                nama:           user.nama,
                nama_bisnis:    user.nama_bisnis,
                email:          user.email,
                nomor_wa:       user.nomor_wa,
                kategori_bisnis: user.kategori_bisnis,
                alamat:         user.alamat,
                plan:           user.plan,
                token_balance:  user.plan === 'professional' ? null : (user.token_balance ?? 0),
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

        // Update by nomor_wa atau id (support user tanpa nomor_wa)
        const { id: userId, nomor_wa: userNomor } = request.user;
        let updateQ = db.from('pengguna').update({ email, password_hash, updated_at: new Date().toISOString() });
        if (userId) updateQ = updateQ.eq('id', userId);
        else if (userNomor) updateQ = updateQ.eq('nomor_wa', userNomor);
        const { error: updateErr } = await updateQ;
        if (updateErr) return reply.code(500).send({ success: false, message: updateErr.message });

        if (userNomor) await invalidateUserCache(userNomor);

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

        const userId = request.user?.id;
        if (!userId && !nomor_wa && !email) {
            return reply.code(400).send({ success: false, message: 'Tidak dapat mengidentifikasi akun' });
        }

        let query = db.from('pengguna').select('password_hash');
        if (userId) query = query.eq('id', userId);
        else if (nomor_wa) query = query.eq('nomor_wa', nomor_wa);
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
        if (userId) updateQuery = updateQuery.eq('id', userId);
        else if (nomor_wa) updateQuery = updateQuery.eq('nomor_wa', nomor_wa);
        else updateQuery = updateQuery.eq('email', email);

        const { error: updateErr2 } = await updateQuery;
        if (updateErr2) return reply.code(500).send({ success: false, message: updateErr2.message });

        return reply.send({ success: true, message: 'Password berhasil diubah' });
    });
}