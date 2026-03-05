import pkg from 'eventemitter2';

// untuk komunikasi antar modul, terutama untuk event WhatsApp yang masuk
const { EventEmitter2 } = pkg;

const bus = new EventEmitter2({
    wildcard: true,
    delimiter: '.',
    newListener: false,
    maxListeners: 20
});

export default bus;