-- ============================================================
-- MIGRATION: Full Schema KasBot
-- Sesuai struktur Supabase yang sudah ada
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- 1. Tabel pengguna
CREATE TABLE IF NOT EXISTS pengguna (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nomor_wa            TEXT UNIQUE,
    nama                TEXT,
    nama_bisnis         TEXT,
    email               TEXT UNIQUE,
    password_hash       TEXT,
    kategori_bisnis     TEXT,
    bahan_baku          TEXT[],
    alamat              TEXT,
    threshold_alert     JSONB DEFAULT '{}'::jsonb,
    onboarding_selesai  BOOLEAN DEFAULT FALSE,
    welcomed            BOOLEAN DEFAULT FALSE,
    is_comingsoon       BOOLEAN DEFAULT FALSE,
    plan                TEXT DEFAULT 'trial',
    trial_ends_at       TIMESTAMPTZ,
    token_balance       NUMERIC DEFAULT 0,
    token_total         NUMERIC DEFAULT 0,
    token_reset_at      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel transaksi
CREATE TABLE IF NOT EXISTS transaksi (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pengguna_id     UUID REFERENCES pengguna(id) ON DELETE CASCADE,
    pengguna_id_alt TEXT,
    total           NUMERIC NOT NULL,
    tipe            VARCHAR CHECK (tipe IN ('pemasukan', 'pengeluaran')),
    sumber_input    TEXT CHECK (sumber_input IN ('teks', 'suara', 'foto', 'whatsapp')),
    deskripsi       TEXT,
    pesan_ai        TEXT,
    transaksi_at    TIMESTAMPTZ DEFAULT NOW(),
    ai_confidence   NUMERIC(3,2),
    kategori        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabel detail_transaksi
CREATE TABLE IF NOT EXISTS detail_transaksi (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaksi_id    UUID REFERENCES transaksi(id) ON DELETE CASCADE,
    pengguna_id     UUID REFERENCES pengguna(id),
    nama_item       TEXT NOT NULL,
    kuantitas       NUMERIC(10,3) NOT NULL,
    harga_satuan    NUMERIC,
    satuan          TEXT,
    subtotal        NUMERIC,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabel penyesuaian_transaksi (diskon, pajak, service charge, dll)
CREATE TABLE IF NOT EXISTS penyesuaian_transaksi (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaksi_id    UUID REFERENCES transaksi(id) ON DELETE CASCADE,
    pengguna_id     UUID REFERENCES pengguna(id),
    nama            TEXT NOT NULL,       -- Label asli dari struk (PPN, Diskon, VC, dll)
    nilai           NUMERIC NOT NULL,    -- Selalu positif
    tipe            TEXT CHECK (tipe IN ('potongan', 'tambahan')),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabel onboarding_state (persistent, bukan in-memory)
CREATE TABLE IF NOT EXISTS onboarding_state (
    nomor_wa    TEXT PRIMARY KEY,
    state       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabel report_state (persistent awaiting periode)
CREATE TABLE IF NOT EXISTS report_state (
    nomor_wa    TEXT PRIMARY KEY,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transaksi_user_date
    ON transaksi (pengguna_id, transaksi_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaksi_user_tipe
    ON transaksi (pengguna_id, tipe, transaksi_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaksi_alt_wa
    ON transaksi (pengguna_id_alt, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_detail_item_user
    ON detail_transaksi (pengguna_id, nama_item, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_penyesuaian_transaksi
    ON penyesuaian_transaksi (transaksi_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_updated
    ON onboarding_state (updated_at);

CREATE INDEX IF NOT EXISTS idx_report_state_updated
    ON report_state (updated_at);

CREATE INDEX IF NOT EXISTS idx_pengguna_email
    ON pengguna (email)
    WHERE email IS NOT NULL;

-- ============================================================
-- PATCH: Jalankan ini jika DB sudah existing (bukan fresh install)
-- Aman dijalankan berkali-kali (IF NOT EXISTS)
-- ============================================================
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS nama           TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS email          TEXT UNIQUE;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS password_hash  TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS alamat         TEXT;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS welcomed       BOOLEAN DEFAULT FALSE;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS is_comingsoon       BOOLEAN DEFAULT FALSE;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS token_warning_sent  BOOLEAN DEFAULT FALSE;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS token_balance        NUMERIC DEFAULT 0;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS token_total    NUMERIC DEFAULT 0;
ALTER TABLE pengguna ADD COLUMN IF NOT EXISTS token_reset_at TIMESTAMPTZ;
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS pesan_ai      TEXT;
