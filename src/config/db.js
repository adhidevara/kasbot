// src/config/db.js
// ─── Database Abstraction Layer ───────────────────────────────────────────────
// DB_DRIVER=supabase (default) | DB_DRIVER=mysql
//
// API unified — sama di kedua driver:
//   const { data, error } = await db.from('tabel').select('*').eq('col', val)
//   const { data, error } = await db.from('tabel').insert({...}).single()
//   const { data, error } = await db.from('tabel').upsert({...}, 'conflict_col')
//   const { data, error } = await db.from('tabel').update({...}).eq('col', val)
//   const { data, error } = await db.from('tabel').delete().eq('col', val)
// ─────────────────────────────────────────────────────────────────────────────

import 'dotenv/config';
import logger from '../shared/logger.js';

const DRIVER = process.env.DB_DRIVER || 'supabase';
logger.info(`🗄️  DB Driver: ${DRIVER}`);

// ══════════════════════════════════════════════════════════════════════════════
// MYSQL DRIVER
// ══════════════════════════════════════════════════════════════════════════════
let _pool = null;

async function getMySQLPool() {
    if (_pool) return _pool;
    const mysql = (await import('mysql2/promise')).default;
    _pool = mysql.createPool({
        host:               process.env.DB_HOST     || '127.0.0.1',
        port:               Number(process.env.DB_PORT) || 3306,
        database:           process.env.DB_DATABASE,
        user:               process.env.DB_USERNAME,
        password:           process.env.DB_PASSWORD,
        waitForConnections: true,
        connectionLimit:    10,
        charset:            'utf8mb4',
        timezone:           '+00:00',
    });
    logger.info('✅ MySQL pool siap');
    return _pool;
}

function serializeVal(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
}

function deserializeRow(row) {
    if (!row) return row;
    const out = { ...row };
    for (const [k, v] of Object.entries(out)) {
        if (typeof v === 'string') {
            const t = v.trim();
            if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
                try { out[k] = JSON.parse(v); } catch (_) {}
            }
        }
    }
    return out;
}

function MySQLQueryBuilder(table) {
    const s = {
        table, action: null, data: null, columns: '*',
        wheres: [], orderCol: null, orderAsc: true,
        limitN: null, singleRow: false, conflictCol: null,
        returning: false, // flag: insert/upsert + .select() → return inserted data
    };

    function buildWhere() {
        if (!s.wheres.length) return { clause: '', params: [] };
        const parts = [], params = [];
        for (const { col, op, val } of s.wheres) {
            if (op === 'IN') {
                parts.push(`\`${col}\` IN (${val.map(() => '?').join(',')})`);
                params.push(...val);
            } else {
                parts.push(`\`${col}\` ${op} ?`);
                params.push(val);
            }
        }
        return { clause: 'WHERE ' + parts.join(' AND '), params };
    }

    async function execute() {
        const pool = await getMySQLPool();
        try {
            if (s.action === 'select') {
                const { clause, params } = buildWhere();
                let sql = `SELECT ${s.columns} FROM \`${s.table}\` ${clause}`;
                if (s.orderCol) sql += ` ORDER BY \`${s.orderCol}\` ${s.orderAsc ? 'ASC' : 'DESC'}`;
                if (s.limitN)   sql += ` LIMIT ${s.limitN}`;
                const [rows] = await pool.query(sql, params);
                const data = rows.map(deserializeRow);
                return { data: s.singleRow ? (data[0] ?? null) : data, error: null };
            }

            if (s.action === 'insert') {
                const results = [];
                for (const row of s.data) {
                    if (!row.id) {
                        const [[{ uuid }]] = await pool.query('SELECT UUID() as uuid');
                        row.id = uuid;
                    }
                    const keys = Object.keys(row);
                    const vals = keys.map(k => serializeVal(row[k]));
                    await pool.query(
                        `INSERT INTO \`${s.table}\` (${keys.map(k=>`\`${k}\``).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,
                        vals
                    );
                    results.push(deserializeRow(row));
                }
                // .insert().select().single() → return inserted row(s)
                if (s.returning) {
                    return { data: s.singleRow ? (results[0] ?? null) : results, error: null };
                }
                return { data: null, error: null };
            }

            if (s.action === 'upsert') {
                for (const row of s.data) {
                    // Hanya generate UUID jika tabel pakai 'id' sebagai PK
                    // (skip jika tabel pakai PK lain seperti nomor_wa)
                    const hasDifferentPK = s.conflictCol && s.conflictCol !== 'id';
                    if (!row.id && !hasDifferentPK) {
                        const [[{ uuid }]] = await pool.query('SELECT UUID() as uuid');
                        row.id = uuid;
                    }
                    const keys = Object.keys(row);
                    const vals = keys.map(k => serializeVal(row[k]));
                    const updKeys = keys.filter(k => k !== 'id' && k !== s.conflictCol);
                    const updPart = updKeys.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');
                    await pool.query(
                        `INSERT INTO \`${s.table}\` (${keys.map(k=>`\`${k}\``).join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updPart}`,
                        vals
                    );
                }
                return { data: null, error: null };
            }

            if (s.action === 'update') {
                const { clause, params } = buildWhere();
                const keys = Object.keys(s.data);
                const vals = keys.map(k => serializeVal(s.data[k]));
                await pool.query(
                    `UPDATE \`${s.table}\` SET ${keys.map(k=>`\`${k}\` = ?`).join(', ')} ${clause}`,
                    [...vals, ...params]
                );
                return { data: null, error: null };
            }

            if (s.action === 'delete') {
                const { clause, params } = buildWhere();
                await pool.query(`DELETE FROM \`${s.table}\` ${clause}`, params);
                return { data: null, error: null };
            }

            return { data: null, error: new Error(`Unknown action: ${s.action}`) };

        } catch (err) {
            logger.error(`DB MySQL Error [${s.action} ${s.table}]:`, err.message);
            return { data: null, error: err };
        }
    }

    const b = {
        select(cols = '*') {
            if (s.action === 'insert' || s.action === 'upsert') {
                // .insert().select() pattern → tetap insert, tapi return data
                s.returning = true;
                s.columns = cols === '*' ? '*' : cols;
            } else {
                s.action = 'select';
                s.columns = cols === '*' ? '*' : cols;
            }
            return b;
        },
        insert(data)       { s.action = 'insert'; s.data = Array.isArray(data) ? data : [data]; return b; },
        update(data)       { s.action = 'update'; s.data = data; return b; },
        delete()           { s.action = 'delete'; return b; },
        upsert(data, opts) {
            s.action = 'upsert';
            s.data = Array.isArray(data) ? data : [data];
            s.conflictCol = typeof opts === 'string' ? opts : (opts?.onConflict ?? null);
            return b;
        },
        eq(col, val)  { s.wheres.push({ col, op: '=',  val }); return b; },
        neq(col, val) { s.wheres.push({ col, op: '!=', val }); return b; },
        gte(col, val) { s.wheres.push({ col, op: '>=', val }); return b; },
        lte(col, val) { s.wheres.push({ col, op: '<=', val }); return b; },
        gt(col, val)  { s.wheres.push({ col, op: '>',  val }); return b; },
        lt(col, val)  { s.wheres.push({ col, op: '<',  val }); return b; },
        in(col, vals) { s.wheres.push({ col, op: 'IN', val: vals }); return b; },
        order(col, { ascending = true } = {}) { s.orderCol = col; s.orderAsc = ascending; return b; },
        limit(n)  { s.limitN = n; return b; },
        single()  { s.singleRow = true; s.limitN = 1; return b; },
        then(res, rej) { return execute().then(res, rej); },
        catch(rej)     { return execute().catch(rej); },
    };
    return b;
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPABASE DRIVER — wrap ke supabase-js dengan lazy init
// ══════════════════════════════════════════════════════════════════════════════
let _supabase = null;

async function getSupabase() {
    if (_supabase) return _supabase;
    const { createClient } = await import('@supabase/supabase-js');
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    logger.info('✅ Supabase client siap');
    return _supabase;
}

// Supabase builder adalah synchronous — chain dulu, execute saat di-await
function SupabaseQueryBuilder(table) {
    // Antrian method calls yang akan dieksekusi setelah client siap
    const calls = []; // [{ method, args }]

    async function execute() {
        const client = await getSupabase();
        let builder = client.from(table);
        for (const { method, args } of calls) {
            if (typeof builder[method] !== 'function') {
                throw new TypeError(`Supabase builder: method "${method}" tidak tersedia`);
            }
            builder = builder[method](...args);
        }
        return builder; // PostgrestBuilder — awaitable
    }

    const METHODS = ['select','insert','upsert','update','delete',
                     'eq','neq','gte','lte','gt','lt','in',
                     'order','limit','single','range','ilike','like',
                     'is','contains','containedBy','overlaps','not','or','filter'];

    const proxy = new Proxy({}, {
        get(_, prop) {
            if (prop === 'then')  return (res, rej) => execute().then(r => r).then(res, rej);
            if (prop === 'catch') return (rej)       => execute().catch(rej);
            if (METHODS.includes(prop)) {
                return (...args) => {
                    calls.push({ method: prop, args });
                    return proxy;
                };
            }
            return undefined;
        }
    });

    return proxy;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════════════════════
export const db = {
    from(table) {
        return DRIVER === 'mysql'
            ? MySQLQueryBuilder(table)
            : SupabaseQueryBuilder(table);
    }
};

export const isMySQL    = () => DRIVER === 'mysql';
export const isSupabase = () => DRIVER !== 'mysql';