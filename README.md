# 🤖 KasBot — AI Asisten Keuangan UMKM via WhatsApp

KasBot adalah bot WhatsApp berbasis AI yang membantu pelaku UMKM Indonesia mencatat transaksi keuangan secara otomatis melalui teks, foto struk, maupun voice note — tanpa perlu aplikasi tambahan.

---

## ✨ Fitur Utama

- **📝 Pencatatan Teks** — Catat transaksi cukup dengan ketik pesan natural seperti *"jual ayam 10 ekor @50000"*
- **🖼️ OCR Foto Struk** — Foto struk kasir langsung diproses dan dicatat otomatis via Google Vision API
- **🎙️ Voice Note** — Rekam transaksi dengan suara, ditranskripsi via OpenAI Whisper
- **🧠 AI Extraction** — Gemini AI mengekstrak item, qty, satuan, harga, diskon, dan pajak secara otomatis
- **👤 Onboarding Personalisasi** — Setup profil bisnis via percakapan WA (nama bisnis, kategori, bahan baku utama)
- **📊 CFO Virtual** — Laporan transaksi otomatis dikirim balik ke user setiap pencatatan
- **⚠️ Anomaly Detection** — Deteksi otomatis jika ada transaksi yang tidak wajar dibanding histori
- **💳 Tier System** — Trial 14 hari gratis, upgrade ke Basic/Pro untuk fitur lengkap

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|---|---|
| WhatsApp Interface | Node.js + Baileys |
| AI Extraction | Google Gemini 2.0 Flash Lite |
| OCR Struk | Google Cloud Vision API |
| Speech to Text | OpenAI Whisper |
| Database | Supabase (PostgreSQL) |
| Runtime | Node.js v22+ |

---

## 📁 Struktur Proyek

```
src/
├── config/
│   └── supabase.js           # Koneksi Supabase terpusat
├── modules/
│   ├── ai-engine/
│   │   ├── ai.listener.js    # Orchestrator utama (onboarding, tier, AI)
│   │   └── ai.service.js     # Integrasi Gemini AI
│   ├── anomaly/
│   │   └── anomaly.service.js # Deteksi anomali transaksi (Z-score)
│   ├── cfo-virtual/
│   │   └── cfo.listener.js   # Format & kirim laporan ke user
│   ├── finance/
│   │   └── finance.listener.js # Simpan transaksi ke Supabase
│   ├── media/
│   │   ├── media.listener.js # Handler OCR & STT
│   │   ├── ocr.service.js    # Google Vision API
│   │   └── stt.service.js    # OpenAI Whisper
│   ├── onboarding/
│   │   └── onboarding.service.js # Alur onboarding 4 langkah via WA
│   ├── tier/
│   │   └── tier.service.js   # Manajemen plan & batas akses
│   └── whatsapp/
│       └── whatsapp.service.js # Koneksi & listener WhatsApp
└── shared/
    ├── errorHandler.js       # Global error handler
    ├── eventBus.js           # Event bus antar modul
    └── logger.js             # Logger dengan level kontrol
```

---

## ⚙️ Setup

### 1. Clone & Install
```bash
git clone https://github.com/username/kas-bot-be.git
cd kas-bot-be
npm install
```

### 2. Konfigurasi Environment
```bash
cp .env.example .env
```

Isi `.env`:
```env
SUPABASE_URL=
SUPABASE_KEY=
GEMINI_API_KEY=
GOOGLE_VISION_API_KEY=
OPENAI_API_KEY=
ADMIN_WA=628xxxxxxxxxx@s.whatsapp.net
LOG_LEVEL=info
```

### 3. Setup Database
Jalankan `migration_final.sql` di Supabase SQL Editor.

### 4. Jalankan
```bash
npm start
```

Scan QR yang muncul di terminal dengan WhatsApp > Perangkat Tertaut.

---

## 📊 Alur Sistem

```
Pesan WA masuk (teks / foto / voice note)
    ↓
Cek onboarding & tier user
    ↓
Media processing (OCR / STT jika perlu)
    ↓
AI Gemini ekstrak transaksi → JSON
    ↓
Simpan ke Supabase (transaksi + detail + penyesuaian)
    ↓
CFO Virtual kirim laporan ke user
    ↓
Anomaly detection (plan Basic/Pro)
```

---

## 💳 Paket Langganan

| Plan | Harga | Transaksi/Bulan | Anomali Detection |
|---|---|---|---|
| Trial | Gratis | 30 | ❌ |
| Basic | Rp 149.000/bulan | 300 | ✅ |
| Pro | Rp 149.000/bulan | Unlimited | ✅ |

---

## 📝 Contoh Penggunaan

```
User: jual ayam 10 ekor @50000
Bot:  💰 LAPORAN CFO KASBOT
      Tipe: PEMASUKAN
      Total Bayar: Rp500.000
      Item:
      - Ayam (10 ekor) — Rp50.000/satuan

User: [kirim foto struk Indomaret]
Bot:  🔍 Sedang membaca struk Anda...
      💸 LAPORAN CFO KASBOT
      Tipe: PENGELUARAN
      Total Bayar: Rp76.300
      Item:
      - Indomie Goreng (3 pcs) — Rp3.500/satuan
      🏷️ Potongan:
        - Diskon Member: -Rp2.000
```

---

> Dokumen konfidensial — hanya untuk kalangan internal tim pendiri.

---

## 📄 Lisensi

Lisensi **Business Source License 1.1 (BSL)**:

- ✅ **Trial-Use** untuk penggunaan non-komersial (personal, edukasi, riset)
- 💳 **Berbayar** untuk penggunaan komersial (SaaS, produk, layanan berbayar)
- 🔓 Otomatis menjadi **MIT License** pada **1 Januari 2028**

Untuk lisensi komersial, hubungi pemilik proyek.