// src/modules/onboarding/onboarding.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { cacheGet, cacheSet, cacheDel } from '../../shared/redis.js';

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

const USER_CACHE_TTL = 5 * 60; // 5 menit

// ─── Supabase-backed onboarding state ────────────────────────────────────────

async function getState(nomorWa) {
    const { data } = await db
        .from('onboarding_state')
        .select('state')
        .eq('nomor_wa', nomorWa)
        .single();
    return data?.state || null;
}

async function setState(nomorWa, state) {
    await db.from('onboarding_state').upsert({
        nomor_wa: nomorWa,
        state,
        updated_at: new Date().toISOString()
    }, { onConflict: 'nomor_wa' });
}

async function deleteState(nomorWa) {
    await db.from('onboarding_state').delete().eq('nomor_wa', nomorWa);
}

// ─── Gemini: Saran kategori bisnis ───────────────────────────────────────────

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
            Jika tidak ada yang cocok, berikan nama kategori baru yang relevan (maks 3 kata).
            Kembalikan JSON: { "kategori": string, "alasan": string }
        `;

        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text());
    } catch (err) {
        logger.error('Gagal saran kategori:', err.message);
        return null;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isUserRegistered(nomorWa) {
    const cacheKey = `user:${nomorWa}`;

    // Cek cache dulu
    const cached = await cacheGet(cacheKey);
    if (cached) {
        logger.verbose(`⚡ Cache hit: user ${nomorWa}`);
        return cached;
    }

    // Cache miss → query Supabase
    const { data } = await db
        .from('pengguna')
        .select('*') // ambil semua sekalian untuk tier check
        .eq('nomor_wa', nomorWa)
        .single();

    if (data) {
        await cacheSet(cacheKey, data, USER_CACHE_TTL);
        logger.verbose(`💾 Cache set: user ${nomorWa}`);
    }

    return data || null;
}

export async function getUserProfile(nomorWa) {
    // Reuse isUserRegistered — sudah ada cache
    return isUserRegistered(nomorWa);
}

export async function invalidateUserCache(nomorWa) {
    await cacheDel(`user:${nomorWa}`);
    logger.verbose(`🗑️ Cache invalidated: user ${nomorWa}`);
}

export async function isInOnboarding(nomorWa) {
    const state = await getState(nomorWa);
    return state !== null;
}

export async function startOnboarding(nomorWa) {
    await setState(nomorWa, { step: 1 });
    return (
        `👋 *Halo! Selamat datang di KasBot!*\n\n` +
        `Saya asisten keuangan AI Anda yang akan membantu mencatat transaksi dan memberi insight bisnis.\n\n` +
        `Boleh saya tahu *nama bisnis* Anda?`
    );
}

export async function processOnboarding(nomorWa, text) {
    let state = await getState(nomorWa) || { step: 1 };

    // ── Step 1: Nama bisnis ──────────────────────────────────────────────────
    if (state.step === 1) {
        const namaBisnis = text.trim();
        await setState(nomorWa, { step: 2, nama_bisnis: namaBisnis });
        return {
            reply:
                `✅ *${namaBisnis}* dicatat!\n\n` +
                `Bisnis Anda masuk kategori apa? (ketik angka)\n\n` +
                `1. Warung/Toko Kelontong\n2. Kuliner/F&B\n3. Peternakan\n` +
                `4. Pertanian\n5. Jasa\n6. Retail Fashion\n7. Lainnya`,
            done: false
        };
    }

    // ── Step 2: Pilih kategori ───────────────────────────────────────────────
    if (state.step === 2) {
        const pilihan = text.trim();
        const kategori = KATEGORI_BISNIS[pilihan];

        if (!kategori) {
            return { reply: `⚠️ Pilihan tidak valid. Ketik angka 1-7.`, done: false };
        }

        if (pilihan === '7') {
            await setState(nomorWa, { ...state, step: '2b' });
            return {
                reply:
                    `Silakan ketik kategori bisnis Anda:\n` +
                    `_(contoh: Bengkel Motor, Laundry, Apotek, Toko Bangunan)_`,
                done: false
            };
        }

        await setState(nomorWa, { ...state, step: 3, kategori_bisnis: kategori });
        return {
            reply:
                `✅ Kategori *${kategori}* dipilih.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    // ── Step 2b: Input kategori manual → AI analisa ──────────────────────────
    if (state.step === '2b') {
        const inputKategori = text.trim();
        const saran = await saranKategoriBisnis(`${state.nama_bisnis} - kategori: ${inputKategori}`);

        if (saran && saran.kategori.toLowerCase() !== inputKategori.toLowerCase()) {
            await setState(nomorWa, { ...state, step: '2c', kategori_user: inputKategori, saran_kategori: saran.kategori });
            return {
                reply:
                    `🤖 Saya menganalisa kategori *"${inputKategori}"* untuk bisnis *"${state.nama_bisnis}"*.\n\n` +
                    `Saran kategori yang lebih tepat:\n` +
                    `📂 *${saran.kategori}*\n_${saran.alasan}_\n\n` +
                    `Ketik:\n*1* — Pakai saran AI (${saran.kategori})\n*2* — Tetap pakai "${inputKategori}"`,
                done: false
            };
        }

        const kategoriFinal = saran?.kategori || inputKategori;
        await setState(nomorWa, { ...state, step: 3, kategori_bisnis: kategoriFinal });
        return {
            reply:
                `✅ Kategori *${kategoriFinal}* dicatat.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    // ── Step 2c: Konfirmasi saran AI ─────────────────────────────────────────
    if (state.step === '2c') {
        const kategoriFinal = text.trim() === '1' ? state.saran_kategori : state.kategori_user;
        await setState(nomorWa, { ...state, step: 3, kategori_bisnis: kategoriFinal });
        return {
            reply:
                `✅ Kategori *${kategoriFinal}* dicatat.\n\n` +
                `Apa 3 bahan baku atau produk utama bisnis Anda?\n` +
                `_(pisah dengan koma, contoh: terigu, gula, telur)_`,
            done: false
        };
    }

    // ── Step 3: Bahan baku → Simpan ke Supabase ──────────────────────────────
    if (state.step === 3) {
        const bahanArray = text.trim().split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);

        const { error } = await db.from('pengguna').upsert({
            nomor_wa: nomorWa,
            nama_bisnis: state.nama_bisnis,
            kategori_bisnis: state.kategori_bisnis,
            bahan_baku: bahanArray,
            onboarding_selesai: true,
            plan: 'trial',
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            token_balance: 50,
            token_total:   50,
            token_reset_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'nomor_wa' });

        if (error) {
            logger.error('Gagal simpan onboarding:', error.message);
            return { reply: '❌ Terjadi kesalahan. Coba kirim ulang bahan baku Anda.', done: false };
        }

        await deleteState(nomorWa);
        await invalidateUserCache(nomorWa); // Cache lama tidak valid lagi

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

    await deleteState(nomorWa);
    return { reply: '⚠️ Terjadi kesalahan onboarding. Kirim pesan apa saja untuk mulai ulang.', done: false };
}