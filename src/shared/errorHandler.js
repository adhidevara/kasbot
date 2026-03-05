// src/shared/errorHandler.js
import bus from './eventBus.js';
import logger from './logger.js';

bus.on('error.occurred', (errData) => {
    logger.error(`[${errData.context}]:`, errData.error);

    const target = errData.sender_id || process.env.ADMIN_WA;
    if (!target) {
        logger.warn('errorHandler: Tidak ada target penerima error notification.');
        return;
    }

    bus.emit('whatsapp.send_message', {
        to: target,
        text: '⚠️ Maaf, sistem kami sedang mengalami kendala teknis. Transaksi Anda akan kami proses manual.'
    });
});