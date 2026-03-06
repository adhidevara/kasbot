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
| AI Extraction | Google Gemini *(configurable via env)* |
| OCR Struk | Google Cloud Vision API |
| Speech to Text | OpenAI Whisper |
| Database | Supabase (PostgreSQL) |
| Queue System | BullMQ + Redis |
| Process Manager | PM2 |
| Runtime | Node.js v22+ |

---

## 📁 Struktur Proyek

```
kasbot/
├── src/
│   ├── config/
│   │   └── supabase.js             # Koneksi Supabase terpusat
│   ├── modules/
│   │   ├── ai-engine/
│   │   │   ├── ai.listener.js      # Orchestrator utama (onboarding, tier, AI)
│   │   │   └── ai.service.js       # Integrasi Gemini AI
│   │   ├── anomaly/
│   │   │   └── anomaly.service.js  # Deteksi anomali transaksi (Z-score)
│   │   ├── cfo-virtual/
│   │   │   └── cfo.listener.js     # Format & kirim laporan ke user
│   │   ├── finance/
│   │   │   └── finance.listener.js # Simpan transaksi ke Supabase
│   │   ├── media/
│   │   │   ├── media.listener.js   # Handler OCR & STT
│   │   │   ├── ocr.service.js      # Google Vision API
│   │   │   └── stt.service.js      # OpenAI Whisper
│   │   ├── onboarding/
│   │   │   └── onboarding.service.js # Alur onboarding 4 langkah via WA
│   │   ├── tier/
│   │   │   └── tier.service.js     # Manajemen plan & batas akses
│   │   └── whatsapp/
│   │       └── whatsapp.service.js # Koneksi & listener WhatsApp
│   └── shared/
│       ├── errorHandler.js         # Global error handler
│       ├── eventBus.js             # Event bus antar modul
│       ├── logger.js               # Logger dengan level kontrol
│       ├── queue.js                # BullMQ queue definitions
│       └── queue.worker.js         # BullMQ workers (text + media)
├── logs/                           # PM2 log output (auto-generated)
├── ecosystem.config.cjs            # Konfigurasi PM2
├── migration_final.sql             # Schema database Supabase
├── .env.example                    # Template environment variables
└── server.js                       # Entry point
```

---

## ⚙️ Setup

### 1. Clone & Install
```bash
git clone https://github.com/adhidevara/kasbot.git
cd kasbot
npm install
npm install -g pm2
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

# Model Gemini: gemini-2.0-flash-lite-001 | gemini-2.0-flash | gemini-2.5-flash-lite
GEMINI_MODEL=gemini-2.5-flash-lite

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

# Level log: silent | error | warn | info | verbose
LOG_LEVEL=info
```

### 3. Jalankan Redis
```bash
# Menggunakan Docker
docker run -d -p 6379:6379 redis:alpine
```

### 4. Setup Database
Jalankan `migration_final.sql` di **Supabase → SQL Editor**.

### 5. Jalankan

**Development:**
```bash
npm run dev
```

**Production (dengan PM2):**
```bash
npm run prod
```

Scan QR yang muncul di terminal dengan **WhatsApp → Perangkat Tertaut**.

---

## 🖥️ PM2 Commands

```bash
npm run prod      # Jalankan production (LOG_LEVEL=warn, auto-restart)
npm run dev       # Jalankan development (LOG_LEVEL=verbose)
npm run stop      # Hentikan bot
npm run restart   # Restart bot
npm run logs      # Lihat log realtime
npm run status    # Cek status bot
```

**Auto-start saat server reboot:**
```bash
pm2 startup
pm2 save
```

---

## 📊 Alur Sistem

```
Pesan WA masuk (teks / foto / voice note)
    ↓
Masuk ke BullMQ Queue (messageQueue / mediaQueue)
    ↓
Worker memproses antrian (maks 5 concurrent teks, 3 media)
    ↓
Cek onboarding & tier user (state di Supabase)
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

## 🔧 Skalabilitas

| Skala | Status | Implementasi |
|---|---|---|
| 1–20 user | ✅ Done | PM2 auto-restart, LOG_LEVEL=warn |
| 20–50 user | ✅ Done | BullMQ + Redis queue, onboardingState ke Supabase |
| 50–100 user | 🔜 Planned | WA Business API, Redis cache, connection pooling |
| 100+ user | 🔜 Planned | Multi-instance, load balancer, migrate dari Baileys |

---

## 💳 Paket Langganan

| Plan | Harga | Transaksi/Bulan | Anomali Detection |
|---|---|---|---|
| Trial | Gratis 14 hari | 30 | ❌ |
| Basic | Rp 149.000/bulan | 300 | ✅ |
| Pro | Rp 289.000/bulan | Unlimited | ✅ |

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
