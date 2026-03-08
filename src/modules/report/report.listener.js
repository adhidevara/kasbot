// src/modules/report/report.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { generateLaporan } from './report.service.js';
import { supabase } from '../../config/supabase.js';

// ─── Keyword detector ─────────────────────────────────────────────────────────
const KEYWORDS_SPESIFIK = [
    { kata: ['hari ini', 'harian'],      periode: 'harian'   },
    { kata: ['minggu ini', 'mingguan'],  periode: 'mingguan' },
    { kata: ['bulan ini', 'bulanan'],    periode: 'bulanan'  },
];

const KEYWORDS_UMUM = [
    'laporan', 'report', 'rekap', 'rekapitulasi',
    'pemasukan saya', 'pengeluaran saya', 'transaksi saya',
    'keuangan saya', 'summary', 'rangkuman'
];

export function isReportCommand(text) {
    const lower = text.toLowerCase().trim();

    for (const { kata, periode } of KEYWORDS_SPESIFIK) {
        for (const kw of kata) {
            if (lower.includes(kw)) {
                const adaKataLaporan = KEYWORDS_UMUM.some(k => lower.includes(k));
                const adaKataTipe = ['pemasukan', 'pengeluaran', 'transaksi', 'keuangan'].some(k => lower.includes(k));
                if (adaKataLaporan || adaKataTipe) {
                    return { isReport: true, periode };
                }
            }
        }
    }

    for (const kw of KEYWORDS_UMUM) {
        if (lower.includes(kw)) {
            return { isReport: true, periode: null };
        }
    }

    return { isReport: false, periode: null };
}

// ─── Supabase-backed awaitingPeriode ─────────────────────────────────────────

async function setAwaiting(nomorWa) {
    await supabase.from('report_state').upsert({
        nomor_wa: nomorWa,
        updated_at: new Date().toISOString()
    }, { onConflict: 'nomor_wa' });
}

async function getAwaiting(nomorWa) {
    const { data } = await supabase
        .from('report_state')
        .select('nomor_wa')
        .eq('nomor_wa', nomorWa)
        .single();
    return !!data;
}

async function deleteAwaiting(nomorWa) {
    await supabase.from('report_state').delete().eq('nomor_wa', nomorWa);
}

// ─── Menu pilihan periode ─────────────────────────────────────────────────────
const MENU_LAPORAN =
    `📊 *LAPORAN KASBOT*\n\n` +
    `Pilih periode laporan:\n\n` +
    `1️⃣ *Hari ini*\n` +
    `2️⃣ *Minggu ini*\n` +
    `3️⃣ *Bulan ini*\n\n` +
    `_Ketik angka pilihannya_`;

// ─── Handler menu (dipanggil dari ai.listener) ────────────────────────────────
export async function handleReportMenu(nomorWa, sender, text, userProfile) {
    const isAwaiting = await getAwaiting(nomorWa);
    if (!isAwaiting) return false;

    const map = { '1': 'harian', '2': 'mingguan', '3': 'bulanan' };
    const periode = map[text.trim()];

    if (!periode) {
        await deleteAwaiting(nomorWa);
        return false;
    }

    await deleteAwaiting(nomorWa);
    logger.info(`📊 Laporan ${periode} untuk ${nomorWa}`);

    const laporan = await generateLaporan(userProfile.id, periode);
    bus.emit('whatsapp.send_message', { to: sender, text: laporan });
    return true;
}

// ─── Listener event report.requested ─────────────────────────────────────────
bus.on('report.requested', async ({ sender, nomorWa, periode, userProfile }) => {
    if (periode) {
        logger.info(`📊 Laporan ${periode} untuk ${nomorWa}`);
        const laporan = await generateLaporan(userProfile.id, periode);
        bus.emit('whatsapp.send_message', { to: sender, text: laporan });
        return;
    }

    await setAwaiting(nomorWa);
    bus.emit('whatsapp.send_message', { to: sender, text: MENU_LAPORAN });
});