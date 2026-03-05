// src/shared/logger.js

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, verbose: 4 };
const current = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const logger = {
    error: (...args) => current >= LEVELS.error && console.error('❌', ...args),
    warn:  (...args) => current >= LEVELS.warn  && console.warn('⚠️', ...args),
    info:  (...args) => current >= LEVELS.info  && console.log(...args),
    verbose: (...args) => current >= LEVELS.verbose && console.log('🔍', ...args),
};

export default logger;