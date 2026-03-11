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

// ─── Helper: ownership check ─────────────────────────────────────────────────
// Pastikan user yang request adalah pemilik data (cocokkan JWT id atau nomor_wa)
function checkOwnership(requestUser, targetUser) {
    if (requestUser.id && requestUser.id === targetUser.id) return true;
    if (requestUser.nomor_wa && requestUser.nomor_wa === targetUser.nomor_wa) return true;
    return false;
}

export async function transaksiRoutes(fastify) {

    // GET /api/transaksi/:nomorWa — list dengan filter & paginasi
    fastify.get('/:nomorWa', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { tipe, dari, sampai, limit = 20, page = 1 } = request.query;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        // Ownership check
        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

        const limitNum = Number(limit);
        const pageNum = Number(page);
        const offset = (pageNum - 1) * limitNum;

        // Query data + count in one go
        let query = db.from('transaksi')
            .select('id, tipe, total, kategori, deskripsi, pesan_ai, sumber_input, ai_confidence, transaksi_at', { count: 'exact' })
            .eq('pengguna_id', user.id);

        if (tipe) query = query.eq('tipe', tipe);
        if (dari) query = query.gte('transaksi_at', `${dari} 00:00:00`);
        if (sampai) query = query.lte('transaksi_at', `${sampai} 23:59:59`);

        const { data, error, count } = await query
            .order('transaksi_at', { ascending: false })
            .range(offset, offset + limitNum - 1);

        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({
            data,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count ?? 0,
                total_pages: Math.ceil((count ?? 0) / limitNum),
            },
        });
    });


    // GET /api/transaksi/:nomorWa/full — list transaksi lengkap dengan items & penyesuaian
    fastify.get('/:nomorWa/full', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;
        const { tipe, dari, sampai, limit = 20, page = 1 } = request.query;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        // Ownership check
        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

        const limitNum = Number(limit);
        const pageNum = Number(page);
        const offset = (pageNum - 1) * limitNum;

        // 1. Ambil list transaksi + count
        let query = db.from('transaksi')
            .select('id, tipe, total, kategori, deskripsi, pesan_ai, sumber_input, ai_confidence, transaksi_at', { count: 'exact' })
            .eq('pengguna_id', user.id);

        if (tipe) query = query.eq('tipe', tipe);
        if (dari) query = query.gte('transaksi_at', `${dari} 00:00:00`);
        if (sampai) query = query.lte('transaksi_at', `${sampai} 23:59:59`);

        const { data: transaksiList, error, count } = await query
            .order('transaksi_at', { ascending: false })
            .range(offset, offset + limitNum - 1);

        if (error) return reply.code(500).send({ success: false, message: error.message });
        if (!transaksiList.length) return reply.send({ data: [], pagination: { page: pageNum, limit: limitNum, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limitNum) } });

        // 2. Ambil semua items & penyesuaian sekaligus (batch, bukan N+1)
        const ids = transaksiList.map(t => t.id);

        const [{ data: allItems }, { data: allPenyesuaian }] = await Promise.all([
            db.from('detail_transaksi')
                .select('transaksi_id, nama_item, kuantitas, satuan, harga_satuan, subtotal')
                .in('transaksi_id', ids),
            db.from('penyesuaian_transaksi')
                .select('transaksi_id, nama, tipe, nilai')
                .in('transaksi_id', ids),
        ]);

        // 3. Group by transaksi_id
        const itemsMap = {};
        const penyesuaianMap = {};
        for (const item of (allItems || [])) {
            if (!itemsMap[item.transaksi_id]) itemsMap[item.transaksi_id] = [];
            itemsMap[item.transaksi_id].push(item);
        }
        for (const p of (allPenyesuaian || [])) {
            if (!penyesuaianMap[p.transaksi_id]) penyesuaianMap[p.transaksi_id] = [];
            penyesuaianMap[p.transaksi_id].push(p);
        }

        // 4. Gabungkan
        const data = transaksiList.map(trx => ({
            ...trx,
            items: itemsMap[trx.id] || [],
            penyesuaian: penyesuaianMap[trx.id] || [],
        }));

        return reply.send({
            data,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: count ?? 0,
                total_pages: Math.ceil((count ?? 0) / limitNum),
            },
        });
    });

    // GET /api/transaksi/:nomorWa/summary — ringkasan cepat bulan ini
    fastify.get('/:nomorWa/summary', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

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
                total: user.token_total ?? 0,
            },
            plan: user.plan,
        });
    });

    // GET /api/transaksi/:nomorWa/:id — detail + items + penyesuaian
    fastify.get('/:nomorWa/:id', { preHandler: [verifyToken] }, async (request, reply) => {
        const { nomorWa, id } = request.params;

        const user = await getUserProfile(normalizeNomorWa(nomorWa));
        if (!user) return reply.code(404).send({ success: false, message: 'Pengguna tidak ditemukan' });

        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

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

        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

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

        if (!checkOwnership(request.user, user)) {
            return reply.code(403).send({ success: false, message: 'Akses ditolak' });
        }

        const { data: trx } = await db.from('transaksi').select('id').eq('id', id).eq('pengguna_id', user.id).single();
        if (!trx) return reply.code(404).send({ success: false, message: 'Transaksi tidak ditemukan' });

        const { error } = await db.from('transaksi').delete().eq('id', id);
        if (error) return reply.code(500).send({ success: false, message: error.message });

        return reply.send({ success: true, message: 'Transaksi berhasil dihapus' });
    });
}