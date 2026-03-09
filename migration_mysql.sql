-- ============================================================
-- MIGRATION: Full Schema KasBot — MySQL
-- Konversi dari Supabase (PostgreSQL) ke MySQL 5.7+
-- Jalankan di MySQL client / phpMyAdmin / DBeaver
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Tabel pengguna
CREATE TABLE IF NOT EXISTS `pengguna` (
    `id`                 VARCHAR(36)  NOT NULL DEFAULT (UUID()),
    `nomor_wa`           TEXT         NOT NULL,
    `nama_bisnis`        TEXT,
    `kategori_bisnis`    TEXT,
    `bahan_baku`         JSON,                        -- ganti TEXT[] Postgres
    `threshold_alert`    JSON         DEFAULT (JSON_OBJECT()),
    `onboarding_selesai` TINYINT(1)   DEFAULT 0,      -- ganti BOOLEAN
    `plan`               VARCHAR(20)  DEFAULT 'trial',
    `trial_ends_at`      DATETIME,
    `created_at`         DATETIME     DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_nomor_wa` (`nomor_wa`(191))        -- TEXT perlu panjang untuk UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabel transaksi
CREATE TABLE IF NOT EXISTS `transaksi` (
    `id`            VARCHAR(36)    NOT NULL DEFAULT (UUID()),
    `pengguna_id`   VARCHAR(36),
    `pengguna_id_alt` TEXT,
    `total`         DECIMAL(15,2)  NOT NULL,
    `tipe`          ENUM('pemasukan','pengeluaran'),
    `sumber_input`  ENUM('teks','suara','foto','whatsapp'),
    `deskripsi`     TEXT,
    `transaksi_at`  DATETIME       DEFAULT CURRENT_TIMESTAMP,
    `ai_confidence` DECIMAL(3,2),
    `kategori`      TEXT,
    `created_at`    DATETIME       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_transaksi_pengguna`
        FOREIGN KEY (`pengguna_id`) REFERENCES `pengguna`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabel detail_transaksi
CREATE TABLE IF NOT EXISTS `detail_transaksi` (
    `id`            VARCHAR(36)    NOT NULL DEFAULT (UUID()),
    `transaksi_id`  VARCHAR(36),
    `pengguna_id`   VARCHAR(36),
    `nama_item`     TEXT           NOT NULL,
    `kuantitas`     DECIMAL(10,3)  NOT NULL,
    `harga_satuan`  DECIMAL(15,2),
    `satuan`        TEXT,
    `subtotal`      DECIMAL(15,2),
    `created_at`    DATETIME       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_detail_transaksi`
        FOREIGN KEY (`transaksi_id`) REFERENCES `transaksi`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_detail_pengguna`
        FOREIGN KEY (`pengguna_id`) REFERENCES `pengguna`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabel penyesuaian_transaksi
CREATE TABLE IF NOT EXISTS `penyesuaian_transaksi` (
    `id`            VARCHAR(36)    NOT NULL DEFAULT (UUID()),
    `transaksi_id`  VARCHAR(36),
    `pengguna_id`   VARCHAR(36),
    `nama`          TEXT           NOT NULL,
    `nilai`         DECIMAL(15,2)  NOT NULL,
    `tipe`          ENUM('potongan','tambahan'),
    `created_at`    DATETIME       DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_penyesuaian_transaksi`
        FOREIGN KEY (`transaksi_id`) REFERENCES `transaksi`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_penyesuaian_pengguna`
        FOREIGN KEY (`pengguna_id`) REFERENCES `pengguna`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabel onboarding_state
CREATE TABLE IF NOT EXISTS `onboarding_state` (
    `nomor_wa`      VARCHAR(30)    NOT NULL,
    `state`         JSON           NOT NULL,
    `updated_at`    DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`nomor_wa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tabel report_state
CREATE TABLE IF NOT EXISTS `report_state` (
    `nomor_wa`      VARCHAR(30)    NOT NULL,
    `updated_at`    DATETIME       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`nomor_wa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INDEX untuk performa query
-- ============================================================
CREATE INDEX `idx_transaksi_user_date`
    ON `transaksi` (`pengguna_id`, `transaksi_at` DESC);

CREATE INDEX `idx_transaksi_user_tipe`
    ON `transaksi` (`pengguna_id`, `tipe`, `transaksi_at` DESC);

CREATE INDEX `idx_transaksi_alt_wa`
    ON `transaksi` (`pengguna_id_alt`(191), `created_at` DESC);

CREATE INDEX `idx_detail_item_user`
    ON `detail_transaksi` (`pengguna_id`, `created_at` DESC);

CREATE INDEX `idx_penyesuaian_transaksi`
    ON `penyesuaian_transaksi` (`transaksi_id`);

CREATE INDEX `idx_onboarding_updated`
    ON `onboarding_state` (`updated_at`);

CREATE INDEX `idx_report_state_updated`
    ON `report_state` (`updated_at`);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- CATATAN PERBEDAAN SUPABASE vs MYSQL
-- ============================================================
-- UUID()     : MySQL 8.0+ support DEFAULT (UUID()) — MySQL 5.7 perlu generate di app
-- TEXT[]     : Tidak ada di MySQL — diganti JSON array
-- JSONB      : Tidak ada di MySQL — diganti JSON
-- TIMESTAMPTZ: Tidak ada di MySQL — diganti DATETIME (simpan UTC di app)
-- BOOLEAN    : Diganti TINYINT(1) — 0=false, 1=true
-- ============================================================
