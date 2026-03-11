// src/modules/finance/finance.listener.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { deductToken } from '../tier/tier.service.js';

bus.on('ai.processing_finished', async (payload) => {
    logger.info("Finance Module: Menyimpan transaksi ke Database...");

    try {
        // 1. Simpan transaksi utama
        const { data: trx, error: trxErr } = await db
            .from('transaksi')
            .insert([{
                pengguna_id:     payload.user_id,
                pengguna_id_alt: payload.pengguna_id_alt,
                total:           payload.total,
                tipe:            payload.tipe,
                sumber_input:    payload.source_type,
                deskripsi:       payload.text,
                pesan_ai:        payload.pesan_konfirmasi ?? null,
                transaksi_at:    new Date().toISOString()
            }])
            .select('*')
            .single();

        if (trxErr) throw trxErr;

        // 2. Simpan detail item
        if (payload.items && payload.items.length > 0) {
            const details = payload.items.map(item => ({
                transaksi_id: trx.id,
                pengguna_id:  payload.user_id,
                nama_item:    item.nama,
                satuan:       item.satuan,
                kuantitas:    item.qty,
                harga_satuan: item.harga,
                subtotal:     (item.qty || 0) * (item.harga || 0)
            }));
            const { error: detailErr } = await db.from('detail_transaksi').insert(details);
            if (detailErr) throw detailErr;
        }

        // 3. Simpan penyesuaian (diskon, pajak, dll)
        if (payload.penyesuaian && payload.penyesuaian.length > 0) {
            const adjustments = payload.penyesuaian.map(p => ({
                transaksi_id: trx.id,
                pengguna_id:  payload.user_id,
                nama:         p.nama,
                nilai:        p.nilai,
                tipe:         p.tipe
            }));
            const { error: adjErr } = await db.from('penyesuaian_transaksi').insert(adjustments);
            if (adjErr) throw adjErr;
            logger.verbose(`💾 ${adjustments.length} penyesuaian disimpan`);
        }

        // 4. Deduct token — setelah semua data berhasil tersimpan ke DB
        if (payload.token_digunakan > 0) {
            const deductResult = await deductToken(payload.user_id, payload.pengguna_id_alt, payload.token_digunakan);
            if (!deductResult) {
                logger.error(`⚠️ deductToken gagal untuk user ${payload.user_id} — transaksi tetap tersimpan, perlu manual correction`);
            }
        }

        bus.emit('finance.transaction_saved', {
            ...payload,
            transaksi_id: trx.id,
            status: 'success'
        });

    } catch (err) {
        logger.error('Finance error:', err.message);
        bus.emit('error.occurred', { context: 'finance_save', error: err.message });
    }
});