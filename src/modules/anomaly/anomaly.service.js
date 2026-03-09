// src/modules/anomaly/anomaly.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';


const Z_SCORE_THRESHOLD = 2.0; // Standar deviasi threshold

/**
 * Hitung mean dan standar deviasi dari array angka
 */
function calcStats(values) {
    if (values.length < 3) return null; // Butuh minimal 3 data point
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    return { mean, std };
}

/**
 * Ambil histori transaksi 30 hari terakhir per tipe
 */
async function getHistori30Hari(penggunaId, tipe) {
    const tiga0HariLalu = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await db
        .from('transaksi')
        .select('total, transaksi_at')
        .eq('pengguna_id', penggunaId)
        .eq('tipe', tipe)
        .gte('transaksi_at', tiga0HariLalu)
        .order('transaksi_at', { ascending: false });

    return data || [];
}

/**
 * Deteksi anomali untuk transaksi baru
 * Return: { isAnomali: boolean, message: string | null }
 */
export async function detectAnomali(penggunaId, transaksiNominal, tipe) {
    try {
        const histori = await getHistori30Hari(penggunaId, tipe);

        if (histori.length < 3) return { isAnomali: false }; // Data belum cukup

        const values = histori.map(t => t.total);
        const stats = calcStats(values);

        if (!stats || stats.std === 0) return { isAnomali: false };

        const zScore = Math.abs((transaksiNominal - stats.mean) / stats.std);

        if (zScore < Z_SCORE_THRESHOLD) return { isAnomali: false };

        // Anomali terdeteksi — buat pesan
        const rataFormatted = `Rp${Math.round(stats.mean).toLocaleString('id-ID')}`;
        const nominalFormatted = `Rp${transaksiNominal.toLocaleString('id-ID')}`;
        const multiplier = (transaksiNominal / stats.mean).toFixed(1);
        const label = tipe === 'pengeluaran' ? 'pengeluaran' : 'pemasukan';

        let message;
        if (transaksiNominal > stats.mean) {
            message =
                `⚠️ *Anomali Terdeteksi!*\n\n` +
                `${label === 'pengeluaran' ? '📈' : '🚀'} *${label.charAt(0).toUpperCase() + label.slice(1)}* hari ini (${nominalFormatted}) ` +
                `*${multiplier}x lebih ${transaksiNominal > stats.mean ? 'tinggi' : 'rendah'}* dari rata-rata Anda (${rataFormatted}).\n\n` +
                `Apakah ini ${label === 'pengeluaran' ? 'pembelian stok bulk atau ada yang perlu dicek ulang?' : 'penjualan spesial atau ada event tertentu?'}`;
        } else {
            message =
                `⚠️ *Anomali Terdeteksi!*\n\n` +
                `📉 *${label.charAt(0).toUpperCase() + label.slice(1)}* hari ini (${nominalFormatted}) ` +
                `jauh di bawah rata-rata Anda (${rataFormatted}).\n\n` +
                `Apakah ada perubahan jam operasional atau kendala hari ini?`;
        }

        return { isAnomali: true, message, zScore: zScore.toFixed(2) };

    } catch (err) {
        logger.error('❌ Anomaly detection error:', err.message);
        return { isAnomali: false };
    }
}

/**
 * Generate insight mingguan (dipanggil tiap Senin 07:00)
 */
export async function generateInsightMingguan(penggunaId, kategori_bisnis) {
    const tujuhHariLalu = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: transaksi } = await db
        .from('transaksi')
        .select('total, tipe, created_at')
        .eq('pengguna_id', penggunaId)
        .gte('created_at', tujuhHariLalu);

    if (!transaksi || transaksi.length === 0) return null;

    const totalPemasukan = transaksi
        .filter(t => t.tipe === 'pemasukan')
        .reduce((sum, t) => sum + t.total, 0);

    const totalPengeluaran = transaksi
        .filter(t => t.tipe === 'pengeluaran')
        .reduce((sum, t) => sum + t.total, 0);

    const labaKotor = totalPemasukan - totalPengeluaran;
    const margin = totalPemasukan > 0
        ? ((labaKotor / totalPemasukan) * 100).toFixed(1)
        : 0;

    const emoji = labaKotor >= 0 ? '✅' : '⚠️';

    return (
        `📊 *INSIGHT MINGGUAN KASBOT*\n\n` +
        `💰 Total Pemasukan: Rp${totalPemasukan.toLocaleString('id-ID')}\n` +
        `💸 Total Pengeluaran: Rp${totalPengeluaran.toLocaleString('id-ID')}\n` +
        `${emoji} Laba Kotor: Rp${labaKotor.toLocaleString('id-ID')}\n` +
        `📈 Gross Margin: ${margin}%\n\n` +
        `_Laporan otomatis KasBot — ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}_`
    );
}