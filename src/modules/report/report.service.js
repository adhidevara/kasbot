// src/modules/report/report.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite-001';

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
export async function generateLaporan(userId, periode, nama, kategori_bisnis) {
    try {
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            generationConfig: { responseMimeType: 'application/json' }
        });

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

        const prompt = `
            Kamu adalah Nata, asisten keuangan bisnis yang santai, hangat, dan sedikit jenaka.
            Nama pengguna: ${nama}
            Kategori bisnis: ${kategori_bisnis}
            Tipe transaksi: Pemasukan & Pengeluaran
            Total masuk: ${rupiah(totalMasuk)}
            Total keluar: ${rupiah(totalKeluar)}
            Periode: ${periode}

            Buat 1 kalimat teasing/komentar singkat yang:
            - Relevan dengan kategori bisnis "${kategori_bisnis}"
            - Kontekstual dengan kondisi keuangan: masuk ${rupiah(totalMasuk)}, keluar ${rupiah(totalKeluar)}, saldo ${rupiah(Math.abs(saldo))} ${saldo >= 0 ? 'surplus' : 'defisit'}
            - Santai, natural, tidak template
            - Maksimal 12 kata
            - Boleh 1 emoji

            Contoh untuk kuliner saldo surplus: "Laris manis nih ${nama}, jangan lupa stok bahan baku ya! 🔥"
            Contoh untuk fashion saldo defisit: "${nama}, Pengeluaran lumayan nih, cek lagi yang bisa dihemat. 😅"

            Respond ONLY dengan JSON: {"teasing": "..."}`;

            logger.verbose(`🤖 Prompt Gemini Report:\n${prompt}`);
            const result = await model.generateContent(prompt);
            const raw = result.response.text();
            const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);

        let pesan =
            `${parsed.teasing || ''}\n\n` +
            `💰 Pemasukan  : ${rupiah(totalMasuk)}\n` +
            `💸 Pengeluaran: ${rupiah(totalKeluar)}\n` +
            `${saldo >= 0 ? '✅' : '⚠️'} Saldo       : ${rupiah(Math.abs(saldo))} ${saldo >= 0 ? '(surplus)' : '(defisit)'}\n` +
            `📋 Total Transaksi: ${jumlahTrx}x`;
        
        return pesan;

    } catch (err) {
        logger.error('generateLaporan error:', err.message);
        return '❌ Gagal mengambil laporan. Coba lagi.';
    }
}

// ─── Generate teasing via Gemini ─────────────────────────────────────────────
async function generateTeasing(tipe, total, periode, kategori_bisnis, nama, tipe_secondary="") {
    try {
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            generationConfig: { responseMimeType: 'application/json' }
        });

        // Untuk label tipe & periode yang lebih natural di prompt
        const labelTipe    = tipe === 'pemasukan' ? 'pemasukan' : 'pengeluaran';
        const labelPeriode = { harian: 'hari ini', mingguan: 'minggu ini', bulanan: 'bulan ini' }[periode] || 'hari ini';
        const totalFormatted = `Rp${total.toLocaleString('id-ID')}`;

        const prompt = `
            Kamu adalah Nata, asisten keuangan bisnis yang santai, hangat, dan sedikit jenaka.
            Nama pengguna: ${nama}
            Kategori bisnis: ${kategori_bisnis}
            Tipe transaksi: ${labelTipe}
            Total: ${totalFormatted}
            Periode: ${labelPeriode}

            Buat 1 kalimat teasing/komentar singkat yang:
            - Relevan dengan kategori bisnis "${kategori_bisnis}"
            - Kontekstual dengan tipe (${labelTipe}) dan jumlah (${totalFormatted})
            - Santai, natural, tidak template
            - Maksimal 12 kata
            - Boleh 1 emoji

            Contoh untuk kuliner pemasukan besar: "Laris manis nih, jangan lupa stok bahan baku ya! 🔥"
            Contoh untuk fashion pengeluaran kecil: "Hemat banget, sisa buat beli koleksi baru nih. 😄"

            Respond ONLY dengan JSON: {"teasing": "..."}`;

        console.log(`🤖 Prompt Gemini Pemasukan / Pengeluaran:\n${prompt}`);
        const result = await model.generateContent(prompt);
        const raw = result.response.text();
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
        return parsed.teasing || '';
    } catch {
        // Fallback kalau Gemini gagal
        const fallback = {
            pemasukan:   ['Mantap, cuan terus! 🔥', 'Rezeki lancar nih!', 'Oke banget hari ini!'],
            pengeluaran: ['Pastiin semua worth it ya!', 'Semoga balik modal cepet!', 'Investasi yang baik pasti balik.'],
        };
        const pool = fallback[tipe] || fallback.pengeluaran;
        return pool[Math.floor(Math.random() * pool.length)];
    }
}

// ─── Generate chat response untuk tanya pemasukan/pengeluaran ────────────────
export async function generateChatResponse(userId, tipe, periode, namaPengguna, kategori_bisnis) {
    try {
        const { from, to } = getDateRange(periode);
        const transaksi = await getTransaksi(userId, from, to);

        const labelTipe    = tipe === 'pemasukan' ? 'pemasukan' : 'pengeluaran';
        const labelPeriode = { harian: 'hari ini', mingguan: 'minggu ini', bulanan: 'bulan ini' }[periode] || 'hari ini';
        const nama         = namaPengguna || 'kamu';

        const total = transaksi
            .filter(t => t.tipe === (tipe === 'pemasukan' ? 'pemasukan' : 'pengeluaran'))
            .reduce((s, t) => s + Number(t.total), 0);

        if (total === 0) {
            return `Oke ${nama}. Belum ada ${labelTipe} tercatat ${labelPeriode}. Yuk mulai catat! 💪`;
        }

        const totalFormatted = `Rp${total.toLocaleString('id-ID')}`;
        const teasing = await generateTeasing(tipe, total, periode, kategori_bisnis || 'Umum', nama);

        return `Oke ${nama}. Total ${labelTipe} kamu ${labelPeriode} *${totalFormatted}*. ${teasing}`;

    } catch (err) {
        logger.error('generateChatResponse error:', err.message);
        return '❌ Gagal mengambil data. Coba lagi ya.';
    }
}