// src/modules/ai-engine/ai.service.js
import logger from '../../shared/logger.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function processInput(text, context) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash", 
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      Kamu adalah CFO Virtual KasBot. Ekstrak SEMUA transaksi dari teks berikut: "${text}"
      Konteks: ${context.kategori}

      Perhatian umum:
      - Teks mungkin berisi LEBIH DARI SATU transaksi dalam baris berbeda
      - "beli" / "bayar" / "keluar" = pengeluaran
      - "jual" / "terima" / "masuk" = pemasukan
      - Jika caption/catatan pengirim menyebut "jual" → tipe = pemasukan, meski isi struk adalah struk belanja
      - Jika ada campuran, ikuti konteks caption jika ada, jika tidak pilih tipe PALING DOMINAN
      - total = nilai TOTAL AKHIR yang benar-benar dibayar (sudah memperhitungkan semua potongan dan tambahan)

      Untuk field "harga" per item:
      - Gunakan harga SATUAN ASLI sebelum potongan apapun

      Untuk field "penyesuaian" (adjustments):
      - Tangkap SEMUA jenis potongan maupun biaya tambahan yang ditemukan di struk/teks
      - Potongan (nilai negatif): diskon, VC, voucher, cashback, potongan member, promo, subsidi
      - Biaya tambahan (nilai positif): PPN, PPh, pajak, service charge, biaya admin, ongkir, tip, surcharge
      - Setiap penyesuaian memiliki: nama (label asli dari struk), nilai (angka, selalu positif), tipe ("potongan" atau "tambahan")
      - Jika tidak ada penyesuaian sama sekali → isi array kosong []

      Untuk field "satuan":
      - Jika disebutkan → gunakan satuan tersebut
      - Jika struk kasir → tebak paling logis (minuman → "pcs", sabun → "botol", dll)
      - JANGAN isi null → gunakan "pcs" jika tidak bisa ditebak

      Hasilkan JSON:
      {
        "total": number,
        "tipe": "pemasukan" | "pengeluaran",
        "items": [
          {"nama": string, "satuan": string, "qty": number, "harga": number}
        ],
        "penyesuaian": [
          {"nama": string, "nilai": number, "tipe": "potongan" | "tambahan"}
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return JSON.parse(response.text());
    
  } catch (error) {
    logger.error("🔍 Detail Error Gemini:", error);
    throw new Error(`Gemini API Failure: ${error.message}`);
  }
}