// src/modules/cfo-virtual/cfo.listener.js
import logger from '../../shared/logger.js';
import bus from '../../shared/eventBus.js';
import { detectAnomali } from '../anomaly/anomaly.service.js';
import { checkFitur } from '../tier/tier.service.js';

bus.on('finance.transaction_saved', async (payload) => {
    logger.info("CFO Virtual: Menyusun laporan...");

    const message = formatCFOResponse(payload);
    bus.emit('whatsapp.send_message', { to: payload.sender, text: message });

    // Anomaly detection (hanya untuk plan basic/pro)
    const nomorWa = payload.pengguna_id_alt || payload.sender;
    const bolehAnomali = await checkFitur(nomorWa, 'fiturAnomali');

    if (bolehAnomali && payload.user_id && payload.total) {
        const anomali = await detectAnomali(payload.user_id, payload.total, payload.tipe);
        if (anomali.isAnomali && anomali.message) {
            setTimeout(() => {
                bus.emit('whatsapp.send_message', { to: payload.sender, text: anomali.message });
            }, 1000);
        }
    }
});

function formatCFOResponse(result) {
    if (!result || result.total === 0) {
        return "❌ Maaf, saya tidak mendeteksi transaksi yang valid. Pastikan formatnya jelas (Contoh: Jual kopi 2 @15000).";
    }

    const emoji = result.tipe === 'pemasukan' ? '💰' : '💸';

    // Format item
    const items = result.items && result.items.length > 0
        ? result.items.map(i => {
            const harga = (i.harga ?? 0).toLocaleString('id-ID');
            return `- ${i.nama} (${i.qty} ${i.satuan ?? '-'}) — Rp${harga}/satuan`;
          }).join('\n')
        : '- (tidak ada detail item)';

    // Format penyesuaian (potongan & tambahan)
    const penyesuaian = result.penyesuaian ?? [];
    let penyesuaianBaris = '';

    if (penyesuaian.length > 0) {
        const potongan = penyesuaian.filter(p => p.tipe === 'potongan');
        const tambahan = penyesuaian.filter(p => p.tipe === 'tambahan');

        const totalPotongan = potongan.reduce((sum, p) => sum + p.nilai, 0);
        const totalTambahan = tambahan.reduce((sum, p) => sum + p.nilai, 0);

        let baris = '\n';

        if (potongan.length > 0) {
            baris += `🏷️ *Potongan:*\n`;
            baris += potongan.map(p => `  - ${p.nama}: -Rp${p.nilai.toLocaleString('id-ID')}`).join('\n');
            baris += `\n  _(Hemat Rp${totalPotongan.toLocaleString('id-ID')})_\n`;
        }

        if (tambahan.length > 0) {
            baris += `➕ *Biaya Tambahan:*\n`;
            baris += tambahan.map(p => `  - ${p.nama}: +Rp${p.nilai.toLocaleString('id-ID')}`).join('\n');
            baris += `\n  _(+Rp${totalTambahan.toLocaleString('id-ID')})_\n`;
        }

        penyesuaianBaris = baris;
    }

    // Info token sisa
    const tokenInfo = result.token_sisa != null
        ? `\n🪙 Token tersisa: ${result.token_sisa}`
        : '';

    // Pesan Nata dari AI — fallback ke teks generik
    const pesanNata = result.pesan_konfirmasi
        ? `${result.pesan_konfirmasi}\n\n`
        : `${emoji} Transaksi Rp${result.total.toLocaleString('id-ID')} berhasil dicatat.\n\n`;

    // Detail ringkas
    const detail =
        `📝 *Detail:*\n${items}` +
        `${penyesuaianBaris}` +
        `\n💵 *Total:* Rp${result.total.toLocaleString('id-ID')}` +
        `${tokenInfo}`;

    return `${pesanNata}${detail}`;
}