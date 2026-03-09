// test-db-mysql.js
// ─── Simulasi test koneksi MySQL lokal ────────────────────────────────────────
// Jalankan: DB_DRIVER=mysql node test-db-mysql.js
//
// Pastikan MySQL lokal sudah jalan dan:
//   1. Database "kasbot" sudah dibuat
//   2. migration_mysql.sql sudah dijalankan
//   3. .env sudah diisi DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD

import 'dotenv/config';

// Override driver ke mysql untuk test ini
process.env.DB_DRIVER = 'mysql';

import { db } from './src/config/db.js';

const WA_TEST = '6281234567890';

async function run() {
    console.log('\n🧪 === KasBot MySQL Test ===\n');

    // ─── 1. INSERT pengguna ──────────────────────────────────────────────────
    console.log('1️⃣  INSERT pengguna...');
    const { data: userInsert, error: e1 } = await db.from('pengguna').insert({
        nomor_wa:           WA_TEST,
        nama_bisnis:        'Toko Test',
        kategori_bisnis:    'retail',
        bahan_baku:         ['beras', 'gula'],   // array → JSON
        onboarding_selesai: 1,
        plan:               'trial',
        trial_ends_at:      new Date(Date.now() + 14 * 86400 * 1000).toISOString()
            .replace('T', ' ').replace(/\.\d+Z$/, ''),
    }).single();

    if (e1) { console.error('❌ INSERT gagal:', e1.message); process.exit(1); }
    console.log('✅ Inserted:', userInsert?.id);

    const userId = userInsert?.id;

    // ─── 2. SELECT single ────────────────────────────────────────────────────
    console.log('\n2️⃣  SELECT pengguna by nomor_wa...');
    const { data: user, error: e2 } = await db.from('pengguna')
        .select('*').eq('nomor_wa', WA_TEST).single();

    if (e2 || !user) { console.error('❌ SELECT gagal:', e2?.message); process.exit(1); }
    console.log('✅ Found:', user.nama_bisnis, '| plan:', user.plan);
    console.log('   bahan_baku (JSON parsed):', user.bahan_baku); // harus array

    // ─── 3. INSERT transaksi ─────────────────────────────────────────────────
    console.log('\n3️⃣  INSERT transaksi...');
    const { data: trx, error: e3 } = await db.from('transaksi').insert({
        pengguna_id:     user.id,
        pengguna_id_alt: WA_TEST,
        total:           150000,
        tipe:            'pemasukan',
        sumber_input:    'teks',
        deskripsi:       'jual beras 10kg @15000',
        transaksi_at:    new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
    }).single();

    if (e3) { console.error('❌ INSERT transaksi gagal:', e3.message); process.exit(1); }
    console.log('✅ Transaksi ID:', trx?.id);

    // ─── 4. INSERT detail ────────────────────────────────────────────────────
    console.log('\n4️⃣  INSERT detail_transaksi...');
    const { error: e4 } = await db.from('detail_transaksi').insert([{
        transaksi_id: trx.id,
        pengguna_id:  user.id,
        nama_item:    'beras',
        kuantitas:    10,
        harga_satuan: 15000,
        satuan:       'kg',
        subtotal:     150000,
    }]);
    if (e4) { console.error('❌ INSERT detail gagal:', e4.message); process.exit(1); }
    console.log('✅ Detail inserted');

    // ─── 5. UPSERT onboarding_state ─────────────────────────────────────────
    console.log('\n5️⃣  UPSERT onboarding_state...');
    const { error: e5 } = await db.from('onboarding_state').upsert({
        nomor_wa: WA_TEST,
        state:    { step: 'nama_bisnis', attempts: 1 },
    }, 'nomor_wa');
    if (e5) { console.error('❌ UPSERT gagal:', e5.message); process.exit(1); }
    console.log('✅ Upserted');

    // ─── 6. SELECT dengan gte ────────────────────────────────────────────────
    console.log('\n6️⃣  SELECT transaksi dengan gte...');
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    const { data: trxList, error: e6 } = await db.from('transaksi')
        .select('id, total, tipe')
        .eq('pengguna_id_alt', WA_TEST)
        .gte('created_at', startOfMonth.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''))
        .order('transaksi_at', { ascending: false });

    if (e6) { console.error('❌ SELECT transaksi gagal:', e6.message); process.exit(1); }
    console.log(`✅ Ditemukan ${trxList.length} transaksi bulan ini`);

    // ─── 7. UPDATE ───────────────────────────────────────────────────────────
    console.log('\n7️⃣  UPDATE pengguna plan...');
    const { error: e7 } = await db.from('pengguna')
        .update({ plan: 'basic' })
        .eq('nomor_wa', WA_TEST);
    if (e7) { console.error('❌ UPDATE gagal:', e7.message); process.exit(1); }
    console.log('✅ Plan updated to basic');

    // ─── 8. DELETE (cleanup) ─────────────────────────────────────────────────
    console.log('\n8️⃣  DELETE cleanup...');
    await db.from('onboarding_state').delete().eq('nomor_wa', WA_TEST);
    await db.from('detail_transaksi').delete().eq('pengguna_id', user.id);
    await db.from('transaksi').delete().eq('pengguna_id', user.id);
    await db.from('pengguna').delete().eq('nomor_wa', WA_TEST);
    console.log('✅ Cleanup selesai');

    console.log('\n🎉 Semua test PASSED — MySQL driver berfungsi!\n');
    process.exit(0);
}

run().catch(err => {
    console.error('❌ Test error:', err.message);
    process.exit(1);
});