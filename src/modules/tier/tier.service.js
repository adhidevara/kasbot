// src/modules/tier/tier.service.js
// Plans: trial | starter | business | professional
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import { isUserRegistered, invalidateUserCache } from '../onboarding/onboarding.service.js';
import bus from '../../shared/eventBus.js';

// ─── Plan config ──────────────────────────────────────────────────────────────
const PLAN_CONFIG = {
    trial: {
        label:                'Trial',
        tokenAwal:            15,
        warningThreshold:     5,   // warning saat sisa ≤5 token
        fiturAnomali:         false,
        fiturInsightMingguan: false,
    },
    starter: {
        label:                'Starter',
        tokenAwal:            300,
        warningThreshold:     30,  // warning saat sisa ≤30 token (10%)
        fiturAnomali:         true,
        fiturInsightMingguan: false,
    },
    business: {
        label:                'Business',
        tokenAwal:            1000,
        warningThreshold:     100, // warning saat sisa ≤100 token (10%)
        fiturAnomali:         true,
        fiturInsightMingguan: true,
    },
    professional: {
        label:                'Professional',
        tokenAwal:            null, // unlimited — tidak pakai token
        warningThreshold:     0,   // unlimited, tidak ada warning
        fiturAnomali:         true,
        fiturInsightMingguan: true,
        unlimited:            true,
    },
};

// ─── Token cost per aktivitas ─────────────────────────────────────────────────
export const TOKEN_COST = {
    teks:  1,
    foto:  1,
    suara: 1, // base — dikalikan kelipatan 15 detik
};

/**
 * Hitung token untuk voice note berdasarkan durasi
 * 1-15 detik = 1 token, 16-30 detik = 2 token, dst
 */
export function hitungTokenAudio(durasiDetik = 0) {
    return Math.ceil(Math.max(durasiDetik, 1) / 15);
}

// ─── Check akses user ─────────────────────────────────────────────────────────
export async function checkAccess(nomorWa) {
    const user = await isUserRegistered(nomorWa);
    if (!user) return { allowed: false, plan: null, reason: 'not_registered' };

    const plan = user.plan || 'trial';
    const config = PLAN_CONFIG[plan] || PLAN_CONFIG.trial;

    // Trial expired + token habis → tidak boleh akses
    if (plan === 'trial' && user.trial_ends_at) {
        const trialEnd = new Date(user.trial_ends_at);
        if (new Date() > trialEnd && (user.token_balance ?? 0) <= 0) {
            return {
                allowed: false,
                plan: 'trial_expired',
                reason: 'trial_expired',
                message:
                    `⏰ *Trial Anda sudah berakhir.*\n\n` +
                    `Upgrade ke paket berbayar untuk terus menggunakan KasBot:\n` +
                    `💳 *Starter* — Rp 99.000/bulan (300 token)\n` +
                    `💳 *Business* — Rp 249.000/bulan (1.000 token)\n` +
                    `💳 *Professional* — Token unlimited\n\n` +
                    `Atau kunjungi: https://www.kalastudioai.com/harga\n` +
                    `Hubungi admin untuk aktivasi.`
            };
        }
    }

    return {
        allowed:      true,
        plan,
        config,
        user,
        tokenBalance: config.unlimited ? Infinity : (user.token_balance ?? 0),
    };
}

// ─── Cek token sebelum transaksi ──────────────────────────────────────────────
export async function checkTransaksiLimit(nomorWa, sourceType = 'teks', durasiDetik = 0) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return access;

    // Professional: unlimited token — selalu allowed
    if (access.config?.unlimited) {
        return {
            allowed:          true,
            plan:             access.plan,
            config:           access.config,
            tokenBalance:     Infinity,
            tokenDibutuhkan:  0,
            sisaToken:        Infinity,
        };
    }

    const tokenDibutuhkan = sourceType === 'suara'
        ? hitungTokenAudio(durasiDetik)
        : (TOKEN_COST[sourceType] ?? 1);

    const balance = access.tokenBalance;

    if (balance <= 0) {
        return {
            allowed: false,
            plan:    access.plan,
            reason:  'token_habis',
            message:
                `🚫 *Token Anda habis.*\n\n` +
                `Hubungi admin untuk top-up atau upgrade paket:\n` +
                `💳 *Starter* — Rp 99.000/bulan (300 token)\n` +
                `💳 *Business* — Rp 249.000/bulan (1.000 token)\n` +
                `💳 *Professional* — Token unlimited\n\n` +
                `Kunjungi: https://www.kalastudioai.com/harga`
        };
    }

    if (balance < tokenDibutuhkan) {
        const keteranganSumber = sourceType === 'suara'
            ? ` (voice note ${durasiDetik} detik)`
            : '';
        return {
            allowed: false,
            plan:    access.plan,
            reason:  'token_kurang',
            message:
                `🚫 *Token tidak cukup.*\n\n` +
                `Sisa token: *${balance}*\n` +
                `Dibutuhkan: *${tokenDibutuhkan} token*${keteranganSumber}\n\n` +
                `Hubungi admin untuk top-up.`
        };
    }

    const sisaSetelah = balance - tokenDibutuhkan;

    return {
        allowed:          true,
        plan:             access.plan,
        config:           access.config,
        user:             access.user,
        tokenBalance:     balance,
        tokenDibutuhkan,
        sisaToken:        sisaSetelah,
    };
}

// ─── Deduct token setelah transaksi berhasil ──────────────────────────────────
export async function deductToken(userId, nomorWa, jumlah = 1) {
    try {
        const access = await checkAccess(nomorWa);

        // Professional: unlimited — skip deduction
        if (access.config?.unlimited) {
            logger.verbose(`♾️ Professional plan — skip deduct token | ${nomorWa}`);
            return { newBalance: Infinity, deducted: 0 };
        }

        if (!access.user) {
            logger.error('deductToken: user tidak ditemukan', userId);
            return false;
        }

        const newBalance = Math.max(0, (access.user.token_balance ?? 0) - jumlah);

        await db.from('pengguna')
            .update({
                token_balance: newBalance,
                updated_at:    new Date().toISOString(),
            })
            .eq('id', userId);

        await invalidateUserCache(nomorWa);

        logger.verbose(`🪙 Deduct ${jumlah} token | sisa: ${newBalance} | ${nomorWa}`);

        // ─── Cek threshold warning setelah deduction ──────────────────────────
        const threshold          = access.config?.warningThreshold ?? 5;
        const sudahDiperingatkan = access.user?.token_warning_sent === true;

        if (!sudahDiperingatkan && threshold > 0 && newBalance <= threshold) {
            bus.emit('whatsapp.send_message', {
                to:   nomorWa,
                text: `⚠️ *Sisa token kamu tinggal ${newBalance}!* Segera hubungi admin untuk top-up agar aktivitas pencatatan tidak terganggu.`,
            });
            await db.from('pengguna')
                .update({ token_warning_sent: true, updated_at: new Date().toISOString() })
                .eq('id', userId);
            await invalidateUserCache(nomorWa);
            logger.verbose(`⚠️ Token warning terkirim ke ${nomorWa} | sisa: ${newBalance}`);
        }

        return { newBalance, deducted: jumlah };

    } catch (err) {
        logger.error('deductToken error:', err.message);
        return false;
    }
}

// ─── Admin: top-up token ──────────────────────────────────────────────────────
export async function topUpToken(nomorWa, jumlah) {
    const user = await isUserRegistered(nomorWa);
    if (!user) return { success: false, message: 'User tidak ditemukan' };

    const newBalance = (user.token_balance ?? 0) + jumlah;
    const newTotal   = (user.token_total   ?? 0) + jumlah;

    await db.from('pengguna')
        .update({
            token_balance:      newBalance,
            token_total:        newTotal,
            token_warning_sent: false, // reset warning — user sudah top-up
            token_reset_at:     new Date().toISOString(),
            updated_at:         new Date().toISOString(),
        })
        .eq('nomor_wa', nomorWa);

    await invalidateUserCache(nomorWa);

    logger.info(`💰 Top-up ${jumlah} token untuk ${nomorWa} | balance: ${newBalance}`);
    return { success: true, newBalance, added: jumlah };
}

// ─── Admin: set plan + reset token ───────────────────────────────────────────
export async function setPlan(nomorWa, plan) {
    const config = PLAN_CONFIG[plan];
    if (!config) return { success: false, message: `Plan tidak valid: ${plan}` };

    const updateData = {
        plan,
        token_reset_at: new Date().toISOString(),
        updated_at:     new Date().toISOString(),
    };

    // Professional: set null (unlimited), plan lain set token awal
    if (config.tokenAwal !== null) {
        updateData.token_balance = config.tokenAwal;
        updateData.token_total   = config.tokenAwal;
    }

    await db.from('pengguna')
        .update(updateData)
        .eq('nomor_wa', nomorWa);

    await invalidateUserCache(nomorWa);

    logger.info(`📋 Set plan ${plan} (${config.tokenAwal !== null ? `${config.tokenAwal} token` : 'unlimited'}) untuk ${nomorWa}`);
    return { success: true, plan, tokenBalance: config.tokenAwal };
}

// ─── Cek fitur ────────────────────────────────────────────────────────────────
export async function checkFitur(nomorWa, fitur) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return false;
    return access.config?.[fitur] ?? false;
}

// ─── Status plan untuk user ───────────────────────────────────────────────────
export async function getPlanStatusMessage(nomorWa) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return access.message;

    const { plan, config, tokenBalance } = access;

    return (
        `📊 *Status Akun Anda*\n\n` +
        `✅ Plan: *${config?.label || plan}*\n` +
        `🪙 Token tersisa: *${tokenBalance === Infinity ? 'Unlimited ♾️' : tokenBalance}*\n\n` +
        `_1 teks / 1 foto = 1 token_\n` +
        `_1 voice note = 1 token per 15 detik_\n\n` +
        (plan === 'trial'
            ? `Upgrade ke Starter (Rp 99rb/bln), Business (Rp 249rb/bln), atau Professional (unlimited).`
            : plan === 'professional'
            ? `Kamu sudah di tier tertinggi. Token unlimited!`
            : `Hubungi admin untuk top-up token atau upgrade ke Professional.`)
    );
}