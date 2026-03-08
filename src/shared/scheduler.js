// src/shared/scheduler.js
import logger from './logger.js';
import { supabase } from '../config/supabase.js';
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

    const { data: users, error } = await supabase
        .from('pengguna')
        .select('id, nomor_wa, kategori_bisnis, plan')
        .in('plan', ['basic', 'pro'])
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

// ─── Jalankan scheduler setiap menit, cek apakah waktunya ────────────────────
let sudahKirimMingguIni = false;

export function startScheduler() {
    logger.info('📅 Scheduler aktif (cek setiap menit)');

    setInterval(async () => {
        if (isWaktuInsight()) {
            if (!sudahKirimMingguIni) {
                sudahKirimMingguIni = true;
                await kirimInsightMingguan();
            }
        } else {
            // Reset flag di luar jam kirim
            sudahKirimMingguIni = false;
        }
    }, 60 * 1000); // cek setiap 1 menit
}