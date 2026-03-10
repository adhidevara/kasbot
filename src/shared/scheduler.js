// src/shared/scheduler.js
import logger from './logger.js';
import { db } from '../config/db.js';
import { generateInsightMingguan } from '../modules/anomaly/anomaly.service.js';
import { checkFitur } from '../modules/tier/tier.service.js';
import bus from './eventBus.js';

// ─── Cek apakah sekarang waktunya kirim (Senin, 07:00 WIB) ───────────────────
function isWaktuInsight() {
    const now = new Date();
    // WIB = UTC+7
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return wib.getUTCDay() === 1 && wib.getUTCHours() === 7;
}

// ─── Kirim insight ke semua user basic/pro ────────────────────────────────────
async function kirimInsightMingguan() {
    logger.info('📅 Scheduler: Mengirim insight mingguan...');

    const { data: users, error } = await db
        .from('pengguna')
        .select('id, nomor_wa, kategori_bisnis, plan')
        .in('plan', ['starter', 'business', 'professional'])
        .eq('onboarding_selesai', true);

    if (error || !users?.length) {
        logger.warn('Scheduler: Tidak ada user basic/pro ditemukan.');
        return;
    }

    logger.info(`📅 Scheduler: Mengirim ke ${users.length} user...`);

    for (const user of users) {
        try {
            const boleh = await checkFitur(user.nomor_wa, 'fiturInsightMingguan');
            if (!boleh) continue;

            const insight = await generateInsightMingguan(user.id, user.kategori_bisnis);
            if (!insight) continue;

            bus.emit('whatsapp.send_message', {
                to: user.nomor_wa,
                text: insight
            });

            logger.verbose(`✅ Insight terkirim ke ${user.nomor_wa}`);

            // Delay 1 detik antar user — hindari spam WA
            await new Promise(res => setTimeout(res, 1000));

        } catch (err) {
            logger.error(`Gagal kirim insight ke ${user.nomor_wa}:`, err.message);
        }
    }

    logger.info('📅 Scheduler: Insight mingguan selesai dikirim.');
}

// ─── Cek apakah sekarang 09:00 WIB ──────────────────────────────────────────
function isWaktuHarian() {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return wib.getUTCHours() === 9 && wib.getUTCMinutes() === 0;
}

// ─── Notifikasi H-1 trial habis ───────────────────────────────────────────────
async function kirimNotifTrialHabis() {
    logger.info('📅 Scheduler: Cek notif trial H-1...');

    const besok = new Date();
    besok.setDate(besok.getDate() + 1);
    const besokStart = new Date(besok.toISOString().split('T')[0] + 'T00:00:00.000Z');
    const besokEnd   = new Date(besok.toISOString().split('T')[0] + 'T23:59:59.999Z');

    const { data: users, error } = await db
        .from('pengguna')
        .select('id, nomor_wa, nama_bisnis, trial_ends_at')
        .eq('plan', 'trial')
        .eq('onboarding_selesai', true)
        .gte('trial_ends_at', besokStart.toISOString())
        .lte('trial_ends_at', besokEnd.toISOString());

    if (error || !users?.length) {
        logger.verbose('Scheduler: Tidak ada trial yang habis besok.');
        return;
    }

    logger.info(`📅 Scheduler: Kirim notif trial H-1 ke ${users.length} user...`);

    for (const user of users) {
        try {
            // Hitung jumlah transaksi user
            const { count } = await db
                .from('transaksi')
                .select('*', { count: 'exact', head: true })
                .eq('pengguna_id', user.id);

            const jumlahTrx = count ?? 0;

            const pesan =
                `Wah, nggak berasa ya sudah seminggu kita bareng! ` +
                `Kamu sudah mencatat *${jumlahTrx} transaksi* dengan rapi di Nata. 🎉\n\n` +
                `Masa trial kamu akan berakhir *besok* dan *${jumlahTrx} data* kamu akan terkunci. ` +
                `Jangan sampai catatan keuanganmu terputus!\n\n` +
                `Yuk, lanjut ke *Paket Starter* (cuma Rp 99rb/bulan) biar aku bisa terus bantuin kamu setiap hari.\n\n` +
                `Klik link ini buat upgrade ya: https://www.kalastudioai.com/harga`;

            bus.emit('whatsapp.send_message', {
                to: user.nomor_wa,
                text: pesan
            });

            logger.verbose(`✅ Notif trial H-1 terkirim ke ${user.nomor_wa}`);
            await new Promise(res => setTimeout(res, 1000));

        } catch (err) {
            logger.error(`Gagal kirim notif trial ke ${user.nomor_wa}:`, err.message);
        }
    }
}

// ─── Jalankan scheduler setiap menit, cek apakah waktunya ────────────────────
let sudahKirimMingguIni = false;
let sudahKirimHariIni   = false;

export function startScheduler() {
    logger.info('📅 Scheduler aktif (cek setiap menit)');

    setInterval(async () => {
        // ── Insight mingguan (Senin 07:00 WIB) ──
        if (isWaktuInsight()) {
            if (!sudahKirimMingguIni) {
                sudahKirimMingguIni = true;
                await kirimInsightMingguan();
            }
        } else {
            sudahKirimMingguIni = false;
        }

        // ── Notif trial H-1 (setiap hari 09:00 WIB) ──
        if (isWaktuHarian()) {
            if (!sudahKirimHariIni) {
                sudahKirimHariIni = true;
                await kirimNotifTrialHabis();
            }
        } else {
            sudahKirimHariIni = false;
        }
    }, 60 * 1000); // cek setiap 1 menit
}