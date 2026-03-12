# 🤖 KasBot — AI Asisten Keuangan UMKM via WhatsApp

KasBot adalah bot WhatsApp berbasis AI yang membantu pelaku UMKM Indonesia mencatat transaksi keuangan secara otomatis melalui teks, foto struk, maupun voice note — tanpa perlu aplikasi tambahan.

---

## ✨ Fitur Utama

- **📝 Pencatatan Teks** — Catat transaksi cukup dengan ketik pesan natural seperti *"jual ayam 10 ekor @50000"*
- **🖼️ OCR Foto Struk** — Foto struk kasir langsung diproses dan dicatat otomatis via Google Vision API
- **🎙️ Voice Note** — Rekam transaksi dengan suara, ditranskripsi via OpenAI Whisper
- **🧠 AI Extraction** — Gemini AI mengekstrak item, qty, satuan, harga, diskon, dan pajak secara otomatis
- **👤 Onboarding Personalisasi** — Setup profil bisnis via percakapan WA (nama bisnis, kategori, bahan baku utama)
- **📊 CFO Virtual** — Laporan transaksi otomatis dikirim balik ke user setiap pencatatan beserta sisa token
- **⚠️ Anomaly Detection** — Deteksi otomatis jika ada transaksi yang tidak wajar dibanding histori
- **🪙 Token System** — Setiap aktivitas (teks/foto/voice note) menggunakan 1 token; voice note dihitung per 15 detik

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
│   │   │   └── tier.service.js     # Manajemen token & plan
│   │   └── whatsapp/
│   │       └── whatsapp.service.js # Koneksi & listener WhatsApp
│   ├── api/
│   │   └── routes/
│   │       ├── admin.routes.js     # Manajemen token & plan (admin)
│   │       ├── auth.routes.js
│   │       ├── transaksi.routes.js
│   │       ├── laporan.routes.js
│   │       ├── anomali.routes.js
│   │       ├── stats.routes.js
│   │       ├── user.routes.js
│   │       └── wa.routes.js
│   └── shared/
│       ├── errorHandler.js         # Global error handler
│       ├── eventBus.js             # Event bus antar modul
│       ├── logger.js               # Logger dengan level kontrol
│       ├── queue.js                # BullMQ queue definitions
│       ├── redis.js                # Redis client + cache helpers
│       ├── scheduler.js            # Scheduler harian/mingguan
│       └── queue.worker.js         # BullMQ workers
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

# Level log: silent | error | warn | info | verbose
LOG_LEVEL=info
```

### 3. Jalankan Redis
```bash
docker run -d -p 6379:6379 redis:alpine
```

### 4. Setup Database
Jalankan `migration_final.sql` di **Supabase → SQL Editor**. File ini mencakup seluruh schema termasuk token system. Jika DB sudah ada sebelumnya, bagian PATCH di bawah file tersebut aman dijalankan ulang (`IF NOT EXISTS`).

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

---

## 📊 Alur Sistem

```
Pesan WA masuk (teks / foto / voice note)
    ↓
Masuk ke BullMQ Queue
    ↓
Cek onboarding & token user
    ↓
Media processing (OCR / STT jika perlu)
    ↓
AI Gemini ekstrak transaksi → JSON
    ↓
Deduct token user
    ↓
Simpan ke Supabase (transaksi + detail + penyesuaian)
    ↓
CFO Virtual kirim laporan + sisa token ke user
    ↓
Anomaly detection (plan Starter/Business)
```

---

## 🪙 Token System

Setiap aktivitas pengguna menggunakan token:

| Aktivitas | Token |
|---|---|
| Input teks | 1 token |
| Scan foto struk | 1 token |
| Voice note 1–15 detik | 1 token |
| Voice note 16–30 detik | 2 token |
| Voice note 31–45 detik | 3 token |

Token **tidak dikurangi** jika AI gagal mengenali transaksi.

---

## 💳 Paket Langganan

| Plan | Harga | Token/Bulan | Anomali Detection | Insight Mingguan |
|---|---|---|---|---|
| Trial | Gratis 14 hari | 50 token | ❌ | ❌ |
| Starter | Rp 99.000/bulan | 300 token | ✅ | ❌ |
| Business | Rp 249.000/bulan | 1.000 token | ✅ | ✅ |

Token di-reset manual oleh admin. Top-up tersedia via API admin.

---

## 🔐 Auth API

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | `/api/auth/register` | Daftarkan user baru (bypass onboarding WA) |
| POST | `/api/auth/login` | Login via email atau nomor WA |
| POST | `/api/auth/set-password` | Tambah email & password untuk akun WA onboarding |
| POST | `/api/auth/change-password` | Ganti password |

### POST /api/auth/register

Digunakan untuk mendaftarkan user secara langsung (misal user beta / jalur VIP) tanpa perlu onboarding via WhatsApp. User yang didaftarkan lewat endpoint ini akan langsung menerima sapaan personal dari Nata saat pertama kali chat.

```json
{
  "nama": "Budi Santoso",
  "nama_bisnis": "Warung Budi",
  "email": "budi@email.com",
  "password": "password123",
  "nomor_wa": "628123456789",
  "kategori_bisnis": "Warung/Toko Kelontong",
  "bahan_baku": ["beras", "minyak", "gula"],
  "alamat": "Jl. Mawar No. 10, Surabaya",
  "plan": "trial"
}
```

**Field wajib:** `nama`, `nama_bisnis`, `email`, `password`, `kategori_bisnis`
**Field opsional:** `nomor_wa`, `bahan_baku`, `alamat`, `plan` (default: `trial`)

**Response:**
```json
{
  "success": true,
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "nama": "Budi Santoso",
    "nama_bisnis": "Warung Budi",
    "email": "budi@email.com",
    "nomor_wa": "628123456789@s.whatsapp.net",
    "kategori_bisnis": "Warung/Toko Kelontong",
    "alamat": "Jl. Mawar No. 10, Surabaya",
    "plan": "trial",
    "token_balance": 15,
    "trial_ends_at": "..."
  }
}
```

### POST /api/auth/login

```json
{ "email": "budi@email.com", "password": "password123" }
// atau
{ "nomor_wa": "628123456789", "password": "password123" }
```

---

## 👤 User API

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/users` | List semua pengguna (admin) |
| POST | `/api/users/register` | Daftarkan pengguna via WA saja (admin, tanpa email/password) |
| GET | `/api/users/:nomorWa` | Profil pengguna |
| PATCH | `/api/users/:nomorWa` | Update profil pengguna |
| GET | `/api/users/:nomorWa/plan` | Status plan & kuota token |
| PATCH | `/api/users/:nomorWa/plan` | Upgrade/downgrade plan (admin) |
| DELETE | `/api/users/:nomorWa` | Hapus pengguna (admin) |

### PATCH /api/users/:nomorWa

Field yang dapat diupdate: `nama`, `nama_bisnis`, `kategori_bisnis`, `bahan_baku`, `threshold_alert`, `alamat`

```json
{ "alamat": "Jl. Melati No. 5, Bandung" }
```

---

## 🔧 Admin API

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | `/api/admin/user/:nomorWa` | Info user + token |
| POST | `/api/admin/token/topup` | Top-up token user |
| POST | `/api/admin/plan/set` | Set plan user |

Contoh top-up:
```json
POST /api/admin/token/topup
{ "nomor_wa": "6282264226680", "jumlah": 100 }
```

---

## 📝 Contoh Penggunaan

```
User: jual ayam 10 ekor @50000
Bot:  💰 LAPORAN CFO KASBOT
      Tipe: PEMASUKAN
      Item:
      - Ayam (10 ekor) — Rp50.000/satuan
      Total Bayar: Rp500.000
      🪙 Token tersisa: 49

User: [kirim foto struk Indomaret]
Bot:  🔍 Sedang membaca struk Anda...
      💸 LAPORAN CFO KASBOT
      Tipe: PENGELUARAN
      Total Bayar: Rp76.300
      🏷️ Potongan: Diskon Member -Rp2.000
      🪙 Token tersisa: 48
```

---

## 🔧 Skalabilitas

| Skala | Status | Implementasi |
|---|---|---|
| 1–20 user | ✅ Done | PM2 auto-restart, LOG_LEVEL=warn |
| 20–50 user | ✅ Done | BullMQ + Redis queue, state ke Supabase |
| 50–100 user | 🔜 Planned | WA Business API, Redis cache, connection pooling |
| 100+ user | 🔜 Planned | Multi-instance, load balancer, migrate dari Baileys |

---

> Dokumen konfidensial — hanya untuk kalangan internal tim pendiri.

---

## 📄 Lisensi

Lisensi **Business Source License 1.1 (BSL)**:

- ✅ **Trial-Use** untuk penggunaan non-komersial (personal, edukasi, riset)
- 💳 **Berbayar** untuk penggunaan komersial (SaaS, produk, layanan berbayar)
- 🔓 Otomatis menjadi **MIT License** pada **1 Januari 2028**

Untuk lisensi komersial, hubungi pemilik proyek.