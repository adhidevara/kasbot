// src/modules/onboarding/onboarding.service.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { cacheGet, cacheSet, cacheDel } from '../../shared/redis.js';
import bcrypt from 'bcrypt';

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

const USER_CACHE_TTL = 30; // 1 menit

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
        `Halo! Salam Kenal aku *Nata* dari *KalaStudioAI* 👋\n\n` +
        `Mulai hari ini, aku bisa jadi asisten keuangan pribadi kamu. ` +
        `Kamu punya *15 Token Gratis* buat nyobain saktinya catat transaksi pakai suara atau foto nota.\n\n` +
        `Cara pakainya simpel: cukup kirim *Teks*, *Voice Note*, atau *Foto Nota* di sini — nanti aku yang catat otomatis.\n\n` +
        `Tapi sebentar nih, boleh aku tahu *nama bisnis* kamu?`
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
                `✅ Okay, *${namaBisnis}* dicatat!\n\n` +
                `Bisnis Anda masuk kategori apa nih? (ketik angka ya!)\n\n` +
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
                `Boleh kenalan dong, siapa nama kamu?`,
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
                `Boleh kenalan dong, siapa nama kamu?`,
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
                `Boleh kenalan dong, siapa nama kamu?`,
            done: false
        };
    }

    // ── Step 3: Nama pribadi ──────────────────────────────────────────────────
    if (state.step === 3) {
        const nama = text.trim();
        await setState(nomorWa, { ...state, step: 4, nama });
        return {
            reply:
                `Senang kenal kamu, *${nama}*! 😊\n\n` +
                `Sekarang, boleh minta *alamat email* kamu?\n` +
                `_(Email ini akan dipakai untuk login ke dashboard KalaStudio)_`,
            done: false
        };
    }

    // ── Step 4: Email ─────────────────────────────────────────────────────────
    if (state.step === 4) {
        const email = text.trim().toLowerCase();
        const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

        if (!emailValid) {
            return {
                reply:
                    `⚠️ Format email tidak valid. Coba lagi ya!\n` +
                    `_Contoh: namakamu@gmail.com_`,
                done: false
            };
        }

        // Cek apakah email sudah dipakai
        const { data: existing } = await db
            .from('pengguna')
            .select('nomor_wa')
            .eq('email', email)
            .single();

        if (existing) {
            return {
                reply:
                    `⚠️ Email *${email}* sudah terdaftar.\n` +
                    `Silakan gunakan email lain:`,
                done: false
            };
        }

        await setState(nomorWa, { ...state, step: 5, email });
        return {
            reply:
                `✅ Email *${email}* dicatat!\n\n` +
                `Terakhir, buat *password* untuk login ke dashboard:\n` +
                `_(Minimal 8 karakter)_`,
            done: false
        };
    }

    // ── Step 5: Password → Hash → Simpan ke Supabase ─────────────────────────
    if (state.step === 5) {
        const password = text.trim();

        if (password.length < 8) {
            return {
                reply: `⚠️ Password terlalu pendek. Minimal *8 karakter* ya!`,
                done: false
            };
        }

        let passwordHash;
        try {
            passwordHash = await bcrypt.hash(password, 10);
        } catch (err) {
            logger.error('Gagal hash password:', err.message);
            return { reply: '❌ Terjadi kesalahan. Coba kirim password kamu lagi.', done: false };
        }

        const { error } = await db.from('pengguna').upsert({
            nomor_wa:           nomorWa,
            nama:               state.nama,
            nama_bisnis:        state.nama_bisnis,
            kategori_bisnis:    state.kategori_bisnis,
            email:              state.email,
            password_hash:      passwordHash,
            onboarding_selesai: true,
            welcomed:           true,
            plan:               'trial',
            trial_ends_at:      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            token_balance:      15,
            token_total:        15,
            token_reset_at:     new Date().toISOString(),
            updated_at:         new Date().toISOString()
        }, { onConflict: 'nomor_wa' });

        if (error) {
            logger.error('Gagal simpan onboarding:', error.message);
            return { reply: '❌ Terjadi kesalahan. Coba kirim password kamu lagi.', done: false };
        }

        await deleteState(nomorWa);
        await invalidateUserCache(nomorWa);

        return {
            reply:
                `Semuanya sudah beres, *${state.nama}*! 🎉\n\n` +
                `🏪 *${state.nama_bisnis}*\n` +
                `📂 ${state.kategori_bisnis}\n` +
                `📧 ${state.email}\n\n` +
                `Kamu punya *15 Token* dan *7 hari trial gratis* buat nyobain Nata.\n\n` +
                `🔐 Login ke dashboard kamu di:\n` +
                `https://www.kalastudioai.com/login\n\n` +
                `Yuk, coba kirim transaksi pertama kamu sekarang!\n` +
                `_Contoh: "jual ayam 10 ekor @50000" atau "beli pakan 50 kg @15000"_`,
            done: true
        };
    }

    await deleteState(nomorWa);
    return { reply: '⚠️ Terjadi kesalahan onboarding. Kirim pesan apa saja untuk mulai ulang.', done: false };
}