// src/modules/tier/tier.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import { isUserRegistered } from '../onboarding/onboarding.service.js';

const PLAN_LIMITS = {
    trial: {
        label: 'Trial 14 Hari',
        maxTransaksiPerBulan: 30,
        fiturAnomali: false,
        fiturInsightMingguan: false,
    },
    basic: {
        label: 'Basic',
        maxTransaksiPerBulan: 300,
        fiturAnomali: true,
        fiturInsightMingguan: true,
    },
    pro: {
        label: 'Pro',
        maxTransaksiPerBulan: Infinity,
        fiturAnomali: true,
        fiturInsightMingguan: true,
    }
};

export async function checkAccess(nomorWa) {
    // ✅ Reuse cache dari isUserRegistered — tidak query ulang
    const user = await isUserRegistered(nomorWa);
    if (!user) return { allowed: false, plan: null, reason: 'not_registered' };

    const plan = user.plan || 'trial';
    const now = new Date();

    if (plan === 'trial') {
        const trialEnd = new Date(user.trial_ends_at);
        if (now > trialEnd) {
            return {
                allowed: false,
                plan: 'trial_expired',
                reason: 'trial_expired',
                message:
                    `⏰ *Trial Anda sudah berakhir.*\n\n` +
                    `Upgrade ke paket berbayar untuk terus menggunakan KasBot:\n` +
                    `💳 *Basic* — Rp 149.000/bulan\n\n` +
                    `Hubungi admin untuk aktivasi.`
            };
        }

        const sisaHari = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        return { allowed: true, plan: 'trial', sisaHari, limits: PLAN_LIMITS.trial };
    }

    return { allowed: true, plan, limits: PLAN_LIMITS[plan] || PLAN_LIMITS.basic };
}

export async function checkTransaksiLimit(nomorWa) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return access;

    const maxTrx = access.limits?.maxTransaksiPerBulan ?? 30;
    if (maxTrx === Infinity) return { allowed: true, ...access };

    // ✅ Hanya 1 query tambahan untuk hitung transaksi bulan ini
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: rows } = await db
        .from('transaksi')
        .select('id')
        .eq('pengguna_id_alt', nomorWa)
        .gte('created_at', startOfMonth.toISOString());

    const jumlah = rows?.length || 0;

    if (jumlah >= maxTrx) {
        return {
            allowed: false,
            plan: access.plan,
            reason: 'limit_reached',
            message:
                `🚫 *Batas transaksi bulan ini sudah tercapai* (${jumlah}/${maxTrx}).\n\n` +
                `Upgrade ke paket Pro untuk transaksi tak terbatas.\n` +
                `Hubungi admin untuk aktivasi.`
        };
    }

    return { allowed: true, ...access, jumlahTrxBulanIni: jumlah, maxTrx };
}

export async function checkFitur(nomorWa, fitur) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return false;
    return access.limits?.[fitur] ?? false;
}

export async function getPlanStatusMessage(nomorWa) {
    const access = await checkAccess(nomorWa);
    if (!access.allowed) return access.message;

    if (access.plan === 'trial') {
        return (
            `📊 *Status Akun Anda*\n\n` +
            `⏳ Plan: Trial (sisa ${access.sisaHari} hari)\n` +
            `📝 Maks transaksi: ${PLAN_LIMITS.trial.maxTransaksiPerBulan}/bulan\n` +
            `❌ Anomali detection: Tidak aktif\n\n` +
            `Upgrade ke Basic (Rp 149.000/bulan) untuk fitur lengkap.`
        );
    }

    return (
        `📊 *Status Akun Anda*\n\n` +
        `✅ Plan: ${PLAN_LIMITS[access.plan]?.label || access.plan}\n` +
        `📝 Transaksi: Tidak terbatas\n` +
        `✅ Anomali detection: Aktif\n` +
        `✅ Insight mingguan: Aktif`
    );
}