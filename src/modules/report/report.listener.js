// src/modules/report/report.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { generateLaporan, generateChatResponse } from './report.service.js';
import { supabase } from '../../config/supabase.js';
import { deductToken } from '../tier/tier.service.js';

// ─── Chat query detector (tanya pendapatan/pengeluaran) ──────────────────────
const QUERY_TIPE = [
    { kata: ['pemasukan', 'pendapatan', 'masuk', 'penjualan', 'omset', 'penghasilan', 'income', 'untung', 'hasil', 'uang masuk', 'dapet', 'dapat'], tipe: 'pemasukan' },
    { kata: ['pengeluaran', 'keluar', 'belanja', 'biaya', 'bayar'],     tipe: 'pengeluaran' },
];

const QUERY_PERIODE = [
    { kata: ['hari ini', 'sekarang', 'tadi', 'today'], periode: 'harian'   },
    { kata: ['minggu ini', 'pekan ini'],                periode: 'mingguan' },
    { kata: ['bulan ini'],                              periode: 'bulanan'  },
];

export function isChatQuery(text) {
    const lower = text.toLowerCase().trim();

    // Harus ada kata tanya atau kata kunci query
    const adaTanya = ['berapa', 'total', 'jumlah', 'lihat', 'cek', 'gimana', 'bagaimana', 'rekap'].some(k => lower.includes(k));
    if (!adaTanya) return { isQuery: false };

    let tipe = null;
    for (const { kata, tipe: t } of QUERY_TIPE) {
        if (kata.some(k => lower.includes(k))) { tipe = t; break; }
    }
    if (!tipe) return { isQuery: false };

    let periode = 'harian'; // default hari ini
    for (const { kata, periode: p } of QUERY_PERIODE) {
        if (kata.some(k => lower.includes(k))) { periode = p; break; }
    }

    return { isQuery: true, tipe, periode };
}

// ─── Keyword detector ─────────────────────────────────────────────────────────
const KEYWORDS_SPESIFIK = [
    { kata: ['hari ini', 'harian'],      periode: 'harian'   },
    { kata: ['minggu ini', 'mingguan'],  periode: 'mingguan' },
    { kata: ['bulan ini', 'bulanan'],    periode: 'bulanan'  },
];

const KEYWORDS_UMUM = [
    'laporan', 'report', 'rekap', 'rekapitulasi',
    'pemasukan saya', 'pengeluaran saya', 'transaksi saya',
    'keuangan saya', 'summary', 'rangkuman', 'omset', 'pendapatan'
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
export async function handleReportMenu(nomorWa, sender, text, userProfile, accessCheck) {
    const isAwaiting = await getAwaiting(nomorWa);
    if (!isAwaiting) return false;

    const map = { '1': 'harian', '2': 'mingguan', '3': 'bulanan' };
    const periode = map[text.trim()];

    if (!periode) {
        await deleteAwaiting(nomorWa);
        return false;
    }

    await deleteAwaiting(nomorWa);

    // POTONG TOKEN: Karena laporan akan digenerate
    const sisaToken = accessCheck
        ? (await deductToken(userProfile.id, nomorWa, accessCheck.tokenDibutuhkan))?.newBalance
        : null;

    logger.info(`📊 Laporan ${periode} untuk ${nomorWa}`);

    const nama      = userProfile.nama || userProfile.nama_bisnis || 'kamu';
    const kategori  = userProfile.kategori_bisnis || 'Umum';
    const laporan   = await generateLaporan(userProfile.id, periode, nama, kategori);
    const tokenLine = (sisaToken != null && isFinite(sisaToken)) ? `\n🪙 Token tersisa: ${sisaToken}` : '';
    bus.emit('whatsapp.send_message', { to: sender, text: laporan + tokenLine });
    return true;
}

// ─── Listener event report.requested ─────────────────────────────────────────
bus.on('chat.query', async ({ sender, nomorWa, tipe, periode, userProfile, sisaToken }) => {
    logger.info(`💬 Chat query: ${tipe} ${periode} untuk ${nomorWa}`);
    const nama      = userProfile.nama || userProfile.nama_bisnis || null;
    const kategori  = userProfile.kategori_bisnis || 'Umum';
    const pesan     = await generateChatResponse(userProfile.id, tipe, periode, nama, kategori);
    const tokenLine = (sisaToken != null && isFinite(sisaToken)) ? `\n🪙 Token tersisa: ${sisaToken}` : '';
    bus.emit('whatsapp.send_message', { to: sender, text: pesan + tokenLine });
});

bus.on('report.requested', async ({ sender, nomorWa, periode, userProfile, sisaToken }) => {
    if (periode) {
        logger.info(`📊 Laporan ${periode} untuk ${nomorWa}`);
        const nama      = userProfile.nama || userProfile.nama_bisnis || 'kamu';
        const kategori  = userProfile.kategori_bisnis || 'Umum';
        const laporan   = await generateLaporan(userProfile.id, periode, nama, kategori);
        const tokenLine = (sisaToken != null && isFinite(sisaToken)) ? `\n🪙 Token tersisa: ${sisaToken}` : '';
        bus.emit('whatsapp.send_message', { to: sender, text: laporan + tokenLine });
        return;
    }

    await setAwaiting(nomorWa);
    bus.emit('whatsapp.send_message', { to: sender, text: MENU_LAPORAN });
});