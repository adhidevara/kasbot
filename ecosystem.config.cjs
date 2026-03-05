// ecosystem.config.cjs
module.exports = {
    apps: [
        {
            name: 'kasbot',
            script: 'server.js',
            interpreter: 'node',

            // ─── Auto Restart ───────────────────────────────
            watch: false,               // Jangan watch file (production)
            autorestart: true,          // Restart otomatis jika crash
            max_restarts: 10,           // Maks restart sebelum PM2 menyerah
            restart_delay: 5000,        // Tunggu 5 detik sebelum restart
            min_uptime: '10s',          // Minimal hidup 10 detik agar dianggap sukses

            // ─── Memory Limit ───────────────────────────────
            max_memory_restart: '512M', // Restart jika memory > 512MB

            // ─── Environment ────────────────────────────────
            env: {
                NODE_ENV: 'development',
                LOG_LEVEL: 'verbose'
            },
            env_production: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'warn'       // Production: hanya warn & error
            },

            // ─── Log Files ──────────────────────────────────
            output: './logs/pm2-out.log',
            error: './logs/pm2-error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,

            // ─── Node.js ESM support ─────────────────────────
            node_args: '--experimental-vm-modules'
        }
    ]
};