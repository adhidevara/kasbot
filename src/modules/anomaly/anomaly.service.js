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

        const values = histori.map(t => Number(t.total));
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
 * Hitung range 4 minggu dalam bulan berjalan (atau bulan tertentu)
 * Minggu-1: tgl 1–7, Minggu-2: tgl 8–14, Minggu-3: tgl 15–21, Minggu-4: tgl 22–akhir
 */
function getWeekRanges(year, month) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return [
        { minggu: 1, dari: `${year}-${String(month + 1).padStart(2, '0')}-01`, sampai: `${year}-${String(month + 1).padStart(2, '0')}-07` },
        { minggu: 2, dari: `${year}-${String(month + 1).padStart(2, '0')}-08`, sampai: `${year}-${String(month + 1).padStart(2, '0')}-14` },
        { minggu: 3, dari: `${year}-${String(month + 1).padStart(2, '0')}-15`, sampai: `${year}-${String(month + 1).padStart(2, '0')}-21` },
        { minggu: 4, dari: `${year}-${String(month + 1).padStart(2, '0')}-22`, sampai: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` },
    ];
}

const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/**
 * Generate insight mingguan per minggu-1 s/d minggu-4
 * Return: array 4 item, tiap item berisi periode, ringkasan, anomali, insight
 */
export async function generateInsightMingguan(penggunaId, kategori_bisnis, bulan = null) {
    const target  = bulan ? new Date(bulan + '-01') : new Date();
    const year    = target.getFullYear();
    const month   = target.getMonth();
    const weeks   = getWeekRanges(year, month);

    // Ambil semua transaksi bulan ini sekaligus (1 query)
    const { data: allTrx } = await db
        .from('transaksi')
        .select('total, tipe, transaksi_at')
        .eq('pengguna_id', penggunaId)
        .gte('transaksi_at', weeks[0].dari + ' 00:00:00')
        .lte('transaksi_at', weeks[3].sampai + ' 23:59:59')
        .order('transaksi_at', { ascending: true });

    const hasil = [];

    for (const week of weeks) {
        const trx = (allTrx || []).filter(t => {
            const tgl = t.transaksi_at.slice(0, 10);
            return tgl >= week.dari && tgl <= week.sampai;
        });

        const pemasukan   = trx.filter(t => t.tipe === 'pemasukan').map(t => Number(t.total));
        const pengeluaran = trx.filter(t => t.tipe === 'pengeluaran').map(t => Number(t.total));

        const totalPemasukan   = pemasukan.reduce((s, v) => s + v, 0);
        const totalPengeluaran = pengeluaran.reduce((s, v) => s + v, 0);
        const labaKotor        = totalPemasukan - totalPengeluaran;
        const margin           = totalPemasukan > 0 ? ((labaKotor / totalPemasukan) * 100).toFixed(1) : '0.0';

        // ── Deteksi anomali per hari dalam minggu ─────────────────────────
        const anomali = [];

        // Group transaksi per hari
        const hariMap = {};
        for (const t of trx) {
            const tgl = t.transaksi_at.slice(0, 10);
            if (!hariMap[tgl]) hariMap[tgl] = { pemasukan: [], pengeluaran: [] };
            hariMap[tgl][t.tipe].push(Number(t.total));
        }

        // Hitung rata-rata pengeluaran & pemasukan harian dalam minggu ini
        const hariList = Object.keys(hariMap);
        if (hariList.length >= 2) {
            const dailyPemasukan   = hariList.map(d => hariMap[d].pemasukan.reduce((s, v) => s + v, 0));
            const dailyPengeluaran = hariList.map(d => hariMap[d].pengeluaran.reduce((s, v) => s + v, 0));

            const avgPemasukan   = dailyPemasukan.reduce((s, v) => s + v, 0) / dailyPemasukan.length;
            const avgPengeluaran = dailyPengeluaran.reduce((s, v) => s + v, 0) / dailyPengeluaran.length;

            for (const tgl of hariList) {
                const dp = hariMap[tgl].pengeluaran.reduce((s, v) => s + v, 0);
                const di = hariMap[tgl].pemasukan.reduce((s, v) => s + v, 0);
                const namaHari = NAMA_HARI[new Date(tgl).getDay()];

                if (avgPengeluaran > 0 && dp > avgPengeluaran * 1.4) {
                    const pct = Math.round(((dp - avgPengeluaran) / avgPengeluaran) * 100);
                    anomali.push({
                        tipe: 'pengeluaran_tinggi',
                        pesan: `Pengeluaran ${namaHari} ${pct}% lebih tinggi dari rata-rata minggu ini`,
                        tanggal: tgl,
                        nilai: dp,
                    });
                }
                if (avgPemasukan > 0 && di > avgPemasukan * 1.4) {
                    const pct = Math.round(((di - avgPemasukan) / avgPemasukan) * 100);
                    anomali.push({
                        tipe: 'pemasukan_tinggi',
                        pesan: `Pemasukan ${namaHari} ${pct}% lebih tinggi dari rata-rata minggu ini`,
                        tanggal: tgl,
                        nilai: di,
                    });
                }
            }
        }

        // ── Generate insight teks ─────────────────────────────────────────
        const insight = [];

        if (trx.length === 0) {
            insight.push('Tidak ada transaksi pada minggu ini');
        } else {
            // Hari pemasukan tertinggi
            if (hariList.length > 0) {
                const bestDay = hariList.reduce((best, tgl) => {
                    const total = hariMap[tgl].pemasukan.reduce((s, v) => s + v, 0);
                    return total > (hariMap[best]?.pemasukan.reduce((s, v) => s + v, 0) ?? 0) ? tgl : best;
                }, hariList[0]);
                const namaHari = NAMA_HARI[new Date(bestDay).getDay()];
                const nilaiTertinggi = hariMap[bestDay].pemasukan.reduce((s, v) => s + v, 0);
                if (nilaiTertinggi > 0) {
                    insight.push(`Pemasukan tertinggi di hari ${namaHari} (Rp${nilaiTertinggi.toLocaleString('id-ID')}) — pertimbangkan tambah stok bahan baku`);
                }
            }

            // Margin insight
            const marginNum = parseFloat(margin);
            if (marginNum >= 60) {
                insight.push(`Margin keuntungan minggu ini ${margin}% — performa sangat baik`);
            } else if (marginNum >= 30) {
                insight.push(`Margin keuntungan minggu ini ${margin}% — cukup sehat, pertahankan`);
            } else if (marginNum > 0) {
                insight.push(`Margin keuntungan minggu ini hanya ${margin}% — cek efisiensi pengeluaran`);
            } else if (totalPemasukan === 0) {
                insight.push('Belum ada pemasukan minggu ini');
            } else {
                insight.push(`Pengeluaran melebihi pemasukan minggu ini — perlu evaluasi biaya operasional`);
            }
        }

        hasil.push({
            minggu:  week.minggu,
            periode: { dari: week.dari, sampai: week.sampai },
            ringkasan: {
                total_pemasukan:   totalPemasukan,
                total_pengeluaran: totalPengeluaran,
                laba_kotor:        labaKotor,
                margin_persen:     parseFloat(margin),
                jumlah_transaksi:  trx.length,
            },
            anomali,
            insight,
        });
    }

    return { bulan: `${year}-${String(month + 1).padStart(2, '0')}`, minggu: hasil };
}