// src/modules/onboarding/onboarding.service.js
import { supabase } from '../../config/supabase.js';
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const KATEGORI_BISNIS = {
    '1': 'Warung/Toko Kelontong',
    '2': 'Kuliner/F&B',
    '3': 'Peternakan',
    '4': 'Pertanian',
    '5': 'Jasa',
    '6': 'Retail Fashion',
    '7': 'Lainnya'
};

// ─── UTILITIES: DB STATE ─────────────────────────────────────────────────────

async function getState(nomorWa) {
    const { data } = await supabase
        .from('onboarding_state')
        .select('state')
        .eq('nomor_wa', nomorWa)
        .single();
    return data?.state || null;
}

async function setState(nomorWa, state) {
    await supabase.from('onboarding_state').upsert({
        nomor_wa: nomorWa,
        state,
        updated_at: new Date().toISOString()
    }, { onConflict: 'nomor_wa' });
}

async function deleteState(nomorWa) {
    await supabase.from('onboarding_state').delete().eq('nomor_wa', nomorWa);
}

// ─── AI ASSISTANT ────────────────────────────────────────────────────────────

async function saranKategoriBisnis(namaBisnis) {
    try {
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite-001',
            generationConfig: { responseMimeType: 'application/json' }
        });

        const prompt = `
            Berikan saran kategori bisnis yang paling tepat untuk bisnis bernama "${namaBisnis}" dalam konteks UMKM Indonesia.
            Pilih SATU dari kategori ini yang paling cocok:
            Warung/Toko Kelontong, Kuliner/F&B, Peternakan, Pertanian, Jasa, Retail Fashion,
            Bengkel/Otomotif, Kesehatan/Apotek, Pendidikan/Les, Properti/Kontrakan, Teknologi/Digital, Lainnya.
            JSON: { "kategori": string, "alasan": string }
        `;

        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
    } catch (err) {
        logger.error('AI Error (saranKategoriBisnis):', err.message);
        return null;
    }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export async function isUserRegistered(nomorWa) {
    const { data } = await supabase
        .from('pengguna')
        .select('id, onboarding_selesai')
        .eq('nomor_wa', nomorWa)
        .single();
    return data?.onboarding_selesai ? data : null;
}

export async function isInOnboarding(nomorWa) {
    const state = await getState(nomorWa);
    return state !== null;
}

/**
 * Memulai onboarding - WAJIB dipanggil jika user belum terdaftar & belum ada state
 */
export async function startOnboarding(nomorWa) {
    await setState(nomorWa, { step: 1 });
    return (
        `👋 *Halo! Selamat datang di KasBot!*\n\n` +
        `Saya asisten keuangan AI Anda. Saya akan membantu Anda mencatat transaksi dan memberi insight terkait usaha anda dengan lebih mudah.\n\n` +
        `Boleh saya tahu *nama bisnis* Anda?`
    );
}

/**
 * Alur Logika Utama Onboarding
 */
export async function processOnboarding(nomorWa, text) {
    let state = await getState(nomorWa);
    
    // Jika state kosong tapi masuk ke sini, paksa balik ke step 1
    if (!state) {
        return { reply: await startOnboarding(nomorWa), done: false };
    }

    const input = text.trim();

    switch (state.step) {
        case 1: // Simpan Nama Bisnis
            await setState(nomorWa, { step: 2, nama_bisnis: input });
            return {
                reply: `✅ *${input}* dicatat!\n\n` +
                       `Bisnis Anda masuk kategori apa? (Ketik angkanya)\n\n` +
                       `1. Warung/Kelontong\n2. Kuliner/F&B\n3. Peternakan\n4. Pertanian\n5. Jasa\n6. Retail Fashion\n7. Lainnya`,
                done: false
            };

        case 2: // Pilih Kategori
            const kategori = KATEGORI_BISNIS[input];
            if (!kategori) return { reply: `⚠️ Pilih angka 1-7 yang tersedia.`, done: false };

            if (input === '7') {
                await setState(nomorWa, { ...state, step: '2b' });
                return { reply: `Silakan ketik kategori bisnis Anda:\n_(Contoh: Laundry, Bengkel, Apotek)_`, done: false };
            }

            await setState(nomorWa, { ...state, step: 3, kategori_bisnis: kategori });
            return { reply: `✅ Kategori *${kategori}*.\n\nApa 3 produk/bahan utama Anda?\n_(Contoh: beras, sabun, telur)_`, done: false };

        case '2b': // Analisis AI untuk input manual
            const saran = await saranKategoriBisnis(`${state.nama_bisnis} - ${input}`);
            if (saran && saran.kategori.toLowerCase() !== input.toLowerCase()) {
                await setState(nomorWa, { ...state, step: '2c', kategori_user: input, saran_kategori: saran.kategori });
                return {
                    reply: `🤖 Kami menyarankan kategori:\n📂 *${saran.kategori}*\n_${saran.alasan}_\n\nKetik:\n*1* — Gunakan saran AI\n*2* — Tetap "${input}"`,
                    done: false
                };
            }
            await setState(nomorWa, { ...state, step: 3, kategori_bisnis: input });
            return { reply: `✅ Kategori *${input}* dicatat.\n\nApa 3 produk/bahan utama Anda?\n_(Pisah dengan koma)_`, done: false };

        case '2c': // Konfirmasi saran AI
            const finalCat = input === '1' ? state.saran_kategori : state.kategori_user;
            await setState(nomorWa, { ...state, step: 3, kategori_bisnis: finalCat });
            return { reply: `✅ Kategori *${finalCat}* dicatat.\n\nApa 3 produk/bahan utama Anda?\n_(Pisah dengan koma)_`, done: false };

        case 3: // Finalisasi Data
            const bahan = input.split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
            
            const { error } = await supabase.from('pengguna').upsert({
                nomor_wa: nomorWa,
                nama_bisnis: state.nama_bisnis,
                kategori_bisnis: state.kategori_bisnis,
                bahan_baku: bahan,
                onboarding_selesai: true,
                trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
            });

            if (error) {
                logger.error('DB Upsert Error:', error.message);
                return { reply: `❌ Maaf, ada gangguan teknis. Coba kirim ulang bahan baku Anda.`, done: false };
            }

            await deleteState(nomorWa);
            return {
                reply: `🎉 *Profil bisnis anda sudah Selesai kami kenali!*\n\n🏪 *Bisnis:* ${state.nama_bisnis}\n📂 *Kategori:* ${state.kategori_bisnis}\n📦 *3 Bahan utama:* ${bahan.join(', ')}\n⌛*Status*: Trial 14 hari (Gratis)\n\nSilakan mulai mencatat transaksi pertama Anda!\n_Contoh: "jual kopi 5 cup @75000"_`,
                done: true
            };

        default:
            await deleteState(nomorWa);
            return { reply: `⚠️ Sesi error. Silakan kirim pesan apa saja untuk memulai kembali.`, done: false };
    }
}