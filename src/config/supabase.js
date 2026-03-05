// src/config/supabase.js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import logger from '../shared/logger.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

logger.info('🔍 Memuat konfigurasi Supabase...');
logger.info('SUPABASE_URL:', supabaseUrl ? '✅ Ditemukan' : '❌ Tidak Ditemukan');
logger.info('SUPABASE_KEY:', supabaseKey ? '✅ Ditemukan' : '❌ Tidak Ditemukan');

if (!supabaseUrl || !supabaseKey) {
    logger.error('SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di .env');
    process.exit(1); // Hentikan server jika config tidak lengkap
}

export const supabase = createClient(supabaseUrl, supabaseKey);