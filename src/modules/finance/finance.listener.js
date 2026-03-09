// src/modules/finance/finance.listener.js
import { db } from '../../config/db.js';
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';

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
            await db.from('detail_transaksi').insert(details);
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
            await db.from('penyesuaian_transaksi').insert(adjustments);
            logger.verbose(`💾 ${adjustments.length} penyesuaian disimpan`);
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