// src/api/routes/transaksi.routes.js
import { verifyToken } from '../middleware/auth.middleware.js';
import { db } from '../../config/db.js';
import { getUserProfile } from '../../modules/onboarding/onboarding.service.js';

// ─── Helper: normalize nomor WA ──────────────────────────────────────────────
function normalizeNomorWa(nomorWa) {
    if (!nomorWa) return nomorWa;
    if (nomorWa.includes('@')) return nomorWa;
    return `${nomorWa}@s.whatsapp.net`;
}

export async function transaksiRoutes(fastify) {

    // GET /api/transaksi/:nomorWa — list dengan filter & paginasi
    fastify.get('/:nomorWa', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { tipe, dari, sampai, limit = 20, page = 1 } = request.query;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        let query = db.from('transaksi')
            .select('id, tipe, total, kategori, deskripsi, pesan_ai, sumber_input, ai_confidence, transaksi_at')
            .eq('pengguna_id', user.id)
            .order('transaksi_at', { ascending: false })
            .limit(Number(limit));

        if (tipe) query = query.eq('tipe', tipe);
        if (dari) query = query.gte('transaksi_at', `${dari} 00:00:00`);
        if (sampai) query = query.lte('transaksi_at', `${sampai} 23:59:59`);

        const { data, error } = await query;
        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({
            data,
            pagination: { page: Number(page), limit: Number(limit), total: data.length },
        });
    });

    // GET /api/transaksi/:nomorWa/summary — ringkasan cepat bulan ini
    fastify.get('/:nomorWa/summary', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
            .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

        const { data: trxList, error } = await db.from('transaksi')
            .select('tipe, total')
            .eq('pengguna_id', user.id)
            .gte('transaksi_at', startOfMonth);

        if (error) return reply.code(500).send({ success: false, message: error.message });

        const totalPemasukan = trxList.filter(t => t.tipe === 'pemasukan').reduce((s, t) => s + Number(t.total), 0);
        const totalPengeluaran = trxList.filter(t => t.tipe === 'pengeluaran').reduce((s, t) => s + Number(t.total), 0);

        return reply.send({
            bulan: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            total_pemasukan: totalPemasukan,
            total_pengeluaran: totalPengeluaran,
            laba_bersih: totalPemasukan - totalPengeluaran,
            jumlah_transaksi: trxList.length,
            token: {
                balance: user.token_balance ?? 0,
                total:   user.token_total ?? 0,
            },
            plan: user.plan,
        });
    });

    // GET /api/transaksi/:nomorWa/:id — detail + items + penyesuaian
    fastify.get('/:nomorWa/:id', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa, id } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const { data: trx, error: e1 } = await db.from('transaksi')
            .select('*').eq('id', id).eq('pengguna_id', user.id).single();

        if (e1 || !trx) return reply.code(404).send({ success: false, message: 'Transaksi tidak ditemukan' });

        const { data: items } = await db.from('detail_transaksi')
            .select('nama_item, kuantitas, satuan, harga_satuan, subtotal')
            .eq('transaksi_id', id);

        const { data: penyesuaian } = await db.from('penyesuaian_transaksi')
            .select('nama, tipe, nilai')
            .eq('transaksi_id', id);

        return reply.send({
            ...trx,
            items: items || [],
            penyesuaian: penyesuaian || [],
        });
    });

    // PATCH /api/transaksi/:nomorWa/:id — koreksi manual
    fastify.patch('/:nomorWa/:id', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa, id } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const allowedFields = ['total', 'tipe', 'deskripsi', 'kategori', 'transaksi_at'];
        const updateData = {};
        for (const field of allowedFields) {
            if (request.body?.[field] !== undefined) updateData[field] = request.body[field];
        }

        if (!Object.keys(updateData).length) {
            return reply.code(400).send({ success: false, message: 'Tidak ada field yang diupdate' });
        }

        const { error } = await db.from('transaksi')
            .update(updateData)
            .eq('id', id)
            .eq('pengguna_id', user.id);

        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({ success: true, message: 'Transaksi berhasil diupdate' });
    });

    // DELETE /api/transaksi/:nomorWa/:id — hapus transaksi
    fastify.delete('/:nomorWa/:id', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa, id } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        const { data: trx } = await db.from('transaksi').select('id').eq('id', id).eq('pengguna_id', user.id).single();
        if (!trx) return reply.code(404).send({ success: false, message: 'Transaksi tidak ditemukan' });

        const { error } = await db.from('transaksi').delete().eq('id', id);
        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({ success: true, message: 'Transaksi berhasil dihapus' });
    });
}