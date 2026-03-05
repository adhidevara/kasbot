// src/modules/onboarding/onboarding.service.js
import { supabase } from '../../config/supabase.js';
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Minta Gemini untuk menyarankan kategori bisnis yang tepat
 */
async function saranKategoriBisnis(namaBisnis) {
    try {
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
            generationConfig: { responseMimeType: 'application/json' }
        });

        const prompt = `
            Berikan saran kategori bisnis yang paling tepat untuk bisnis bernama "${namaBisnis}" dalam konteks UMKM Indonesia.
            
            Pilih SATU dari kategori ini yang paling cocok:
            - Warung/Toko Kelontong
            - Kuliner/F&B
            - Peternakan
            - Pertanian
            - Jasa
            - Retail Fashion
            - Bengkel/Otomotif
            - Kesehatan/Apotek
            - Pendidikan/Les
            - Properti/Kontrakan
            - Teknologi/Digital
            - Lainnya
            
            Jika tidak ada yang cocok, berikan nama kategori baru yang relevan (maks 3 kata).
            
            Kembalikan JSON: { "kategori": string, "alasan": string }
        `;

        const result = await model.generateContent(prompt);
        const parsed = JSON.parse(result.response.text());
        return parsed;
    } catch (err) {
        logger.error('❌ Gagal saran kategori:', err.message);
        return null;
    }
}

const KATEGORI_BISNIS = {
    '1': 'Warung/Toko Kelontong',
    '2': 'Kuliner/F&B',
    '3': 'Peternakan',
    '4': 'Pertanian',
    '5': 'Jasa',
    '6': 'Retail Fashion',
    '7': 'Lainnya'
};

// State onboarding per user (in-memory, cukup untuk MVP)
const onboardingState = new Map();

/**
 * Cek apakah user sudah terdaftar di database
 */
export async function isUserRegistered(nomorWa) {
    const { data } = await supabase
        .from('pengguna')
        .select('id, nama_bisnis, kategori_bisnis, onboarding_selesai')
        .eq('nomor_wa', nomorWa)
        .single();
    return data || null;
}

/**
 * Ambil profil user lengkap (untuk konteks AI)
 */
export async function getUserProfile(nomorWa) {
    const { data } = await supabase
        .from('pengguna')
        .select('*')
        .eq('nomor_wa', nomorWa)
        .single();
    return data || null;
}

/**
 * Proses alur onboarding percakapan 4 langkah
 * Return: { reply: string, done: boolean }
 */
export async function processOnboarding(nomorWa, text) {
    // Ambil state saat ini
    let state = onboardingState.get(nomorWa) || { step: 1 };

    if (state.step === 1) {
        // Langkah 1: Nama bisnis
        const namaBisnis = text.trim();
        onboardingState.set(nomorWa, { step: 2, nama_bisnis: namaBisnis });

        return {
            reply:
                `✅ *${namaBisnis}* dicatat!\n\n` +
                `Bisnis Anda masuk kategori apa? (ketik angka)\n\n` +
                `1. Warung/Toko Kelontong\n` +
                `2. Kuliner/F&B\n` +
                `3. Peternakan\n` +
                `4. Pertanian\n` +
                `5. Jasa\n` +
                `6. Retail Fashion\n` +
                `7. Lainnya`,
            done: false
        };
    }

    if (state.step === 2) {
        // Langkah 2: Kategori bisnis
        const pilihan = text.trim();
        const kategori = KATEGORI_BISNIS[pilihan];

        if (!kategori) {
            return {
                reply: `⚠️ Pilihan tidak valid. Ketik angka 1-7 sesuai kategori bisnis Anda.`,
                done: false
            };
        }

        // Jika pilih "Lainnya" → minta user ketik kategorinya sendiri
        if (pilihan === '7') {
            onboardingState.set(nomorWa, { ...state, step: '2b' });
            return {
                reply:
                    `Silakan ketik kategori bisnis Anda:\n` +
                    `_(contoh: Bengkel Motor, Laundry, Apotek, Toko Bangunan)_`,
                done: false
            };
        }

        onboardingState.set(nomorWa, { ...state, step: 3, kategori_bisnis: kategori });

        return {
            reply:
                `✅ Kategori *${kategori}* dipilih.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    // Step 2b: User sudah ketik kategori → AI analisa dan sarankan nama yang lebih tepat
    if (state.step === '2b') {
        const inputKategori = text.trim();

        const saran = await saranKategoriBisnis(`${state.nama_bisnis} - kategori: ${inputKategori}`);

        let kategoriFinal;
        if (saran && saran.kategori.toLowerCase() !== inputKategori.toLowerCase()) {
            // AI punya saran yang berbeda → tampilkan dan minta konfirmasi
            onboardingState.set(nomorWa, { ...state, step: '2c', kategori_user: inputKategori, saran_kategori: saran.kategori });
            return {
                reply:
                    `🤖 Saya menganalisa kategori *"${inputKategori}"* untuk bisnis *"${state.nama_bisnis}"*.\n\n` +
                    `Saran kategori yang lebih tepat:\n` +
                    `📂 *${saran.kategori}*\n` +
                    `_${saran.alasan}_\n\n` +
                    `Ketik:\n` +
                    `*1* — Pakai saran AI (${saran.kategori})\n` +
                    `*2* — Tetap pakai "${inputKategori}"`,
                done: false
            };
        }

        // AI setuju dengan input user
        kategoriFinal = saran?.kategori || inputKategori;
        onboardingState.set(nomorWa, { ...state, step: 3, kategori_bisnis: kategoriFinal });

        return {
            reply:
                `✅ Kategori *${kategoriFinal}* dicatat.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    // Step 2c: Pilih antara saran AI atau kategori sendiri
    if (state.step === '2c') {
        const pilihan2c = text.trim();
        const kategoriFinal = pilihan2c === '1' ? state.saran_kategori : state.kategori_user;

        onboardingState.set(nomorWa, { ...state, step: 3, kategori_bisnis: kategoriFinal });

        return {
            reply:
                `✅ Kategori *${kategoriFinal}* dicatat.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    if (state.step === 3) {
        // Langkah 3: Bahan baku utama
        const bahanRaw = text.trim();
        const bahanArray = bahanRaw.split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);

        onboardingState.set(nomorWa, { ...state, step: 4, bahan_baku: bahanArray });

        // Simpan ke Supabase
        const { error } = await supabase.from('pengguna').upsert({
            nomor_wa: nomorWa,
            nama_bisnis: state.nama_bisnis,
            kategori_bisnis: state.kategori_bisnis,
            bahan_baku: bahanArray,
            onboarding_selesai: true,
            plan: 'trial',
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 hari
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'nomor_wa' });

        if (error) {
            logger.error('❌ Gagal simpan onboarding:', error.message);
            return { reply: '❌ Terjadi kesalahan. Coba kirim ulang bahan baku Anda.', done: false };
        }

        // Bersihkan state
        onboardingState.delete(nomorWa);

        return {
            reply:
                `🎉 *Profil bisnis Anda sudah siap!*\n\n` +
                `🏪 *Bisnis:* ${state.nama_bisnis}\n` +
                `📂 *Kategori:* ${state.kategori_bisnis}\n` +
                `📦 *Bahan utama dipantau:* ${bahanArray.join(', ')}\n\n` +
                `⏳ *Status:* Trial 14 hari (GRATIS)\n\n` +
                `Mulai catat transaksi pertama Anda sekarang!\n` +
                `_Contoh: "jual ayam 10 ekor @50000" atau "beli pakan 50 kg @15000"_`,
            done: true
        };
    }

    // Fallback reset
    onboardingState.delete(nomorWa);
    return { reply: '⚠️ Terjadi kesalahan onboarding. Kirim pesan apa saja untuk mulai ulang.', done: false };
}

/**
 * Mulai alur onboarding baru
 */
export function startOnboarding(nomorWa) {
    onboardingState.set(nomorWa, { step: 1 });
    return (
        `👋 *Halo! Selamat datang di KasBot!*\n\n` +
        `Saya asisten keuangan AI Anda yang akan membantu mencatat transaksi dan memberi insight bisnis.\n\n` +
        `Boleh saya tahu *nama bisnis* Anda?`
    );
}

/**
 * Cek apakah user sedang dalam proses onboarding
 */
export function isInOnboarding(nomorWa) {
    return onboardingState.has(nomorWa);
}