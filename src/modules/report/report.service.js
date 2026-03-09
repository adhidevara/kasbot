// src/modules/report/report.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';

// ─── Rentang waktu ────────────────────────────────────────────────────────────
function getDateRange(periode) {
    const now = new Date();
    let from;

    if (periode === 'harian') {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (periode === 'mingguan') {
        const day = now.getDay(); // 0=Minggu
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Senin
        from = new Date(now.getFullYear(), now.getMonth(), diff);
    } else if (periode === 'bulanan') {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: now.toISOString() };
}

// ─── Ambil data transaksi ─────────────────────────────────────────────────────
async function getTransaksi(userId, from, to) {
    const { data, error } = await db
        .from('transaksi')
        .select('total, tipe, transaksi_at, deskripsi')
        .eq('pengguna_id', userId)
        .gte('transaksi_at', from)
        .lte('transaksi_at', to)
        .order('transaksi_at', { ascending: true });

    if (error) throw error;
    return data || [];
}

// ─── Bar chart ASCII ──────────────────────────────────────────────────────────
function buildBarChart(transaksi, periode) {
    if (transaksi.length === 0) return null;

    // Tentukan grouping key
    const getKey = (tgl) => {
        const d = new Date(tgl);
        if (periode === 'harian') {
            return `${String(d.getHours()).padStart(2, '0')}:00`;
        } else if (periode === 'mingguan') {
            const hari = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
            return hari[d.getDay()];
        } else {
            return `${String(d.getDate()).padStart(2, '0')}`;
        }
    };

    // Grup pemasukan & pengeluaran per slot waktu
    const slots = {};
    for (const trx of transaksi) {
        const key = getKey(trx.transaksi_at);
        if (!slots[key]) slots[key] = { masuk: 0, keluar: 0 };
        if (trx.tipe === 'pemasukan') slots[key].masuk += trx.total;
        else slots[key].keluar += trx.total;
    }

    const keys = Object.keys(slots);
    const maxVal = Math.max(...Object.values(slots).flatMap(s => [s.masuk, s.keluar]));
    const BAR_MAX = 8; // panjang bar maksimal

    let chart = '```\n';
    chart += `${''.padEnd(6)}💰Masuk  💸Keluar\n`;
    chart += `${'─'.repeat(28)}\n`;

    for (const key of keys) {
        const { masuk, keluar } = slots[key];
        const barMasuk = '█'.repeat(Math.round((masuk / maxVal) * BAR_MAX));
        const barKeluar = '█'.repeat(Math.round((keluar / maxVal) * BAR_MAX));
        const label = key.padEnd(5);
        chart += `${label} ${(barMasuk || '░').padEnd(BAR_MAX)} ${(barKeluar || '░').padEnd(BAR_MAX)}\n`;
    }

    chart += '```';
    return chart;
}

// ─── Format angka rupiah ringkas ──────────────────────────────────────────────
function rupiah(n) {
    if (n >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1)}jt`;
    if (n >= 1_000) return `Rp${(n / 1_000).toFixed(0)}rb`;
    return `Rp${n}`;
}

// ─── Generate laporan ─────────────────────────────────────────────────────────
export async function generateLaporan(userId, periode) {
    try {
        const { from, to } = getDateRange(periode);
        const transaksi = await getTransaksi(userId, from, to);

        if (transaksi.length === 0) {
            return `📊 Tidak ada transaksi untuk periode *${periode}* ini.`;
        }

        const totalMasuk  = transaksi.filter(t => t.tipe === 'pemasukan').reduce((s, t) => s + Number(t.total), 0);
        const totalKeluar = transaksi.filter(t => t.tipe === 'pengeluaran').reduce((s, t) => s + Number(t.total), 0);
        const saldo       = totalMasuk - totalKeluar;
        const jumlahTrx   = transaksi.length;

        const labelPeriode = {
            harian: 'Hari Ini',
            mingguan: 'Minggu Ini',
            bulanan: 'Bulan Ini'
        }[periode];

        const chart = buildBarChart(transaksi, periode);

        let pesan =
            `📊 *LAPORAN ${labelPeriode.toUpperCase()}*\n` +
            `${'─'.repeat(28)}\n` +
            `💰 Pemasukan  : ${rupiah(totalMasuk)}\n` +
            `💸 Pengeluaran: ${rupiah(totalKeluar)}\n` +
            `${saldo >= 0 ? '✅' : '⚠️'} Saldo       : ${rupiah(Math.abs(saldo))} ${saldo >= 0 ? '(surplus)' : '(defisit)'}\n` +
            `📋 Total Transaksi: ${jumlahTrx}x\n`;

        if (chart) {
            pesan += `\n${chart}`;
        }

        return pesan;

    } catch (err) {
        logger.error('generateLaporan error:', err.message);
        return '❌ Gagal mengambil laporan. Coba lagi.';
    }
}