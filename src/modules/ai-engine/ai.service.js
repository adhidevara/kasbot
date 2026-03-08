import logger from '../../shared/logger.js';
// src/modules/ai-engine/ai.service.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite-001';

logger.info(`🤖 AI Model: ${GEMINI_MODEL}`);

export async function processInput(text, context) {
  try {
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
      Kamu adalah CFO Virtual KasBot. Ekstrak transaksi dari teks berikut: "${text}"
      Konteks bisnis: ${context.kategori}

      ATURAN TIPE TRANSAKSI:
      - "beli" / "bayar" / "keluar" / "beli" = pengeluaran
      - "jual" / "terima" / "masuk" = pemasukan
      - Jika caption/catatan pengirim menyebut "jual" → tipe = pemasukan
      - Default jika tidak jelas = pengeluaran

      ATURAN TOTAL (PENTING):
      - Gunakan field "Total" atau "Subtotal" = harga barang yang dibeli
      - ABAIKAN field: "Tunai", "Total Bayar", "Kembalian", "Cash", "Bayar", "Kembali"
      - Field "Tunai"/"Total Bayar" = uang yang diserahkan pelanggan, BUKAN nilai transaksi
      - Contoh: Total=43000, Tunai=100000, Kembalian=57000 → total yang benar = 43000

      ATURAN ITEM:
      - Ekstrak semua item dengan nama, qty, harga satuan asli sebelum diskon
      - satuan: tebak dari konteks (minuman→"pcs", kg→"kg", dll), JANGAN null → pakai "pcs"

      ATURAN PENYESUAIAN:
      - Potongan: diskon, voucher, cashback, promo → tipe "potongan"
      - Tambahan: PPN, pajak, service charge, ongkir → tipe "tambahan"
      - Nilai selalu positif
      - Jika tidak ada → []

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
    const parsed = JSON.parse(response.text());

    logger.verbose(`✅ Gemini ekstrak: total=${parsed.total}, tipe=${parsed.tipe}, items=${parsed.items?.length}`);
    return parsed;
    
  } catch (error) {
    logger.error("Detail Error Gemini:", error);
    throw new Error(`Gemini API Failure: ${error.message}`);
  }
}