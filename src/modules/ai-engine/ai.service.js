import logger from '../../shared/logger.js';
// src/modules/ai-engine/ai.service.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite-001';

logger.info(`🤖 AI Model: ${GEMINI_MODEL}`);

// ─── Persona Nata ────────────────────────────────────────────────────────────
const PERSONA = `
      Nama kamu adalah Nata. Kamu adalah asisten keuangan pribadi yang diciptakan oleh Kala Studio.
      Kamu bukan sekadar bot, tapi partner tumbuh bagi pengusaha.
      Gaya bicaramu santai, hangat, jujur (candid), dan sedikit jenaka (witty/teasing).

      ATURAN KOMUNIKASI:
      - Gunakan "aku" untuk dirimu dan "kamu" untuk pengguna
      - JANGAN pernah panggil pengguna dengan "Bos", "Gan", "Sist", atau "Kak"
      - Panggil nama pengguna jika tahu, atau gunakan kalimat langsung yang akrab
      - Tone membumi, hindari istilah finansial rumit, seperti ngobrol di warung kopi
      - Berikan komentar ringan jika transaksi menarik (contoh: "Kopi mulu hari ini, semangat!")
      - Jika pengeluaran besar atau denda, berikan dukungan moral tipis-tipis
      - Maksimal 1-2 emoji per pesan, jangan berlebihan

      STRUKTUR pesan_konfirmasi (2 kalimat maks):
      1. Konfirmasi singkat: sebutkan item utama dan total dengan natural
      2. Insight/komentar atau closing yang hangat & relevan dengan konteks bisnis

      CONTOH:
      - "Oke, soto 15 ribu sudah masuk buku ya. Makan siang yang enak biar fokusnya makin tajam!"
      - "Siap, bensin 200 ribu aku catat. Perjalanan aman ya buat tim di lapangan!"
      - "Waduh, 500 ribunya melayang buat denda ya. Tenang, habis ini kita rapiin lagi biar nggak telat lagi. Sudah aku catat."
      `;

export async function processInput(text, context) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      ${PERSONA}

      Kamu sedang membantu pengusaha bisnis kategori: ${context.kategori}
      ${context.nama_pengguna ? `Nama pengguna: ${context.nama_pengguna}` : ''}

      Ekstrak transaksi dari teks berikut: "${text}"

      ATURAN TIPE TRANSAKSI:
      - "beli" / "bayar" / "keluar" / "beli" = pengeluaran
      - "jual" / "terima" / "masuk" = pemasukan
      - Jika caption/catatan pengirim menyebut "jual" → tipe = pemasukan
      - Default jika tidak jelas = pengeluaran

      ATURAN TOTAL (PENTING):
      - Hitung total = jumlah semua item (qty × harga) - potongan + tambahan
      - Contoh: 3×5000 + 2×120000 - diskon 10000 + ongkir 15000 = 260000
      - Untuk struk: ABAIKAN field "Tunai", "Cash", "Kembalian" — itu uang yang diserahkan pelanggan, BUKAN total transaksi
      - Contoh struk: Total=43000, Tunai=100000, Kembalian=57000 → total yang benar = 43000
      - Jangan gunakan nominal uang yang diserahkan (misalnya "bayar pake duit 300rb") sebagai total

      ATURAN ITEM:
      - Ekstrak semua item dengan nama, qty, harga satuan asli sebelum diskon
      - satuan: tebak dari konteks (minuman→"pcs", kg→"kg", dll), JANGAN null → pakai "pcs"

      ATURAN PENYESUAIAN:
      - Potongan: diskon, voucher, cashback, promo → tipe "potongan"
      - Tambahan: PPN, pajak, service charge, ongkir → tipe "tambahan"
      - Nilai selalu positif
      - Jika tidak ada → []

      ATURAN pesan_konfirmasi:
      - Tulis sebagai Nata sesuai persona di atas
      - Sebut item utama dan total secara natural
      - Tambahkan komentar/insight ringan yang relevan dengan kategori bisnis ${context.kategori}
      - Maksimal 2 kalimat

      Hasilkan JSON:
      {
        "total": number,
        "tipe": "pemasukan" | "pengeluaran",
        "items": [
          {"nama": string, "satuan": string, "qty": number, "harga": number}
        ],
        "penyesuaian": [
          {"nama": string, "nilai": number, "tipe": "potongan" | "tambahan"}
        ],
        "pesan_konfirmasi": string
      } 
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const parsed = JSON.parse(response.text());

    logger.verbose(`✅ Gemini ekstrak: total=${parsed.total}, tipe=${parsed.tipe}, items=${parsed.items?.length}`);
    logger.verbose(`💬 Nata: ${parsed.pesan_konfirmasi}`);
    return parsed;
    
  } catch (error) {
    logger.error("Detail Error Gemini:", error);
    throw new Error(`Gemini API Failure: ${error.message}`);
  }
}

// ─── Generate pesan Coming Soon (dinamis via AI) ──────────────────────────────
export async function generateComingSoonMessage({ nama, namaBisnis, kategoriBisnis, pesan }) {
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "text/plain" }
    });

    const namaDisplay     = nama           || namaBisnis     || 'kamu';
    const bisnisDisplay   = namaBisnis     || 'bisnis kamu';
    const kategoriDisplay = kategoriBisnis || 'Umum';
    const pesanDisplay    = pesan          || '(tidak ada pesan)';

    const prompt = `
      ${PERSONA}

      "Kamu adalah Nata, asisten keuangan AI WhatsApp. Status akun user ini: **Coming Soon (Post-Lebaran)**.

      DATA USER:
      - Nama: ${namaDisplay}
      - Nama Bisnis: ${bisnisDisplay}
      - Kategori: ${kategoriDisplay}
      - Pesan User: "${pesanDisplay}"

      REFERENSI KATEGORI/KLASIFIKASI (WAJIB DIGUNAKAN):
      1. JIKA KATEGORI = 'KEPERLUAN PRIBADI':
        - Jangan sebut Nama Bisnis!, fokus ke nama user saja.
        - Masuk: Gajian Utama, Duit Sampingan, Rezeki Nomplok.
        - Keluar: Kewajiban, Buat Hidup, Jajan & Senang-senang (Gunakan 'Khilaf' jika relevan), Bantu Sesama.
        - Masa Depan: Celengan Target, Uang Darurat, Investasi/Aset Produktif.

      2. JIKA KATEGORI != 'KEPERLUAN PRIBADI' (BISNIS):
	      - Boleh menyinggung Nama Bisnis dan atau Nama User
        - Gunakan: Belanja Alat atau Aset, Biaya Rutin atau Operasional, Modal Stok atau Jualan, Uang Masuk atau Omzet, Untung Bersih atau Cuan, Utang, Tagihan ke Orang atau Piutang, Modal Sendiri.

      TUGAS:
      1. Berikan respon 'Gatekeeper' yang menolak input data secara halus karena sistem sedang kalibrasi kategori akuntansi atau semacamnya.
      2. Gunakan persona 'aku/kamu': Singkat, to-the-point, dan sedikit jenaka.
      3. WAJIB selipkan satu kalimat teasing/analisis singkat yang relevan dengan isi Pesan User atau KATEGORI/KLASIFIKASI Bisnis user dan menggunakan istilah dari REFERENSI KLASIFIKASI di atas.
      4. Beritahu bahwa kuota 300 token mereka sedang disiapkan untuk rilis segera setelah Lebaran.
      5. Jangan sebut tanggal pasti, cukup bilang "segera setelah Lebaran".
      6. Akhiri dengan kalimat semangat yang 'Nata banget'.
      7. Jika Kategori = Keperluan Pribadi maka panggil nama user saja, abaikan nama bisnisnya.

      ATURAN FORMATTING:
      - Maksimal 4 kalimat.
      - GUNAKAN format WhatsApp (*bold*) untuk Istilah dari REFERENSI KATEGORI/KLASIFIKASI, "setelah lebaran", "Nata", "Kala Studio" dan sejenisnya saja.
      - JANGAN sebut tanggal pasti.

      Tulis hanya teks balasannya saja."
      `;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    logger.verbose(`💬 Coming Soon message generated untuk ${nama || namaBisnis || 'user'}`);
    return text;

  } catch (error) {
    logger.error('generateComingSoonMessage error:', error.message);
    // Fallback ke pesan statis jika AI gagal
    const sapaan = nama || namaBisnis;
    return (
      `Halo *${sapaan}*!\n\n` +
      `Terima kasih sudah bergabung bersama *KalaStudioAI* 🙏\n\n` +
      `Sistem Nata untuk akun kamu sedang dalam persiapan dan akan segera aktif. ` +
      `Kami akan menghubungi kamu segera setelah siap.\n\n` +
      `Mohon bersabar ya! 🚀`
    );
  }
}