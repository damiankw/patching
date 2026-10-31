// Thin wrapper over node-sqlite3-wasm (pure WebAssembly, no native build) that
// presents the small better-sqlite3-style API the rest of the server uses:
//   db.prepare(sql).get(...params) / .all(...params) / .run(...params)
//   db.exec(sql), db.pragma(text), db.transaction(fn), db.close()
// Positional params are passed as separate arguments; a single plain object is
// treated as named params (keys may omit the @ prefix).
import sqlite from 'node-sqlite3-wasm';
import type { Statement as WasmStatement } from 'node-sqlite3-wasm';

// The package is CommonJS, so named ESM imports are not available; destructure the default export.
const { Database: WasmDatabase, SQLite3Error } = sqlite;
type WasmDatabase = InstanceType<typeof WasmDatabase>;

type Bind = (string | number | bigint | boolean | null | Uint8Array)[] | Record<string, string | number | bigint | boolean | null | Uint8Array>;
export type Row = Record<string, unknown>;

export { SQLite3Error };

function normalise(args: unknown[]): Bind | undefined {
  if (args.length === 0) return undefined;
  const clean = (v: unknown) => (v === undefined ? null : v) as string | number | bigint | boolean | null | Uint8Array;
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Uint8Array)) {
    const out: Record<string, ReturnType<typeof clean>> = {};
    for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) out[/^[@:$]/.test(k) ? k : `@${k}`] = clean(v);
    return out;
  }
  return args.map(clean);
}

export class Statement {
  constructor(private readonly db: Db, private readonly sql: string) {}
  get<T = Row>(...params: unknown[]): T | undefined {
    const r = this.db.stmt(this.sql).get(normalise(params));
    return (r ?? undefined) as T | undefined;
  }
  all<T = Row>(...params: unknown[]): T[] {
    return this.db.stmt(this.sql).all(normalise(params)) as T[];
  }
  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this.db.stmt(this.sql).run(normalise(params));
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

const CACHE_LIMIT = 400;

export class Db {
  private readonly raw: WasmDatabase;
  private readonly cache = new Map<string, WasmStatement>();
  constructor(path: string) {
    this.raw = new WasmDatabase(path);
  }
  /** Prepared statements are cached by SQL text and reused; the oldest is finalized when the cache is full. */
  stmt(sql: string): WasmStatement {
    let s = this.cache.get(sql);
    if (s) return s;
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.entries().next().value;
      if (oldest) { try { oldest[1].finalize(); } catch { /* ignore */ } this.cache.delete(oldest[0]); }
    }
    s = this.raw.prepare(sql);
    this.cache.set(sql, s);
    return s;
  }
  prepare(sql: string) { return new Statement(this, sql); }
  exec(sql: string) { this.raw.exec(sql); }
  pragma(text: string) { this.raw.exec(`PRAGMA ${text}`); }
  transaction<A extends unknown[], T>(fn: (...args: A) => T): (...args: A) => T {
    return (...args: A) => {
      this.exec('BEGIN');
      try { const r = fn(...args); this.exec('COMMIT'); return r; }
      catch (e) { try { this.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    };
  }
  close() {
    for (const s of this.cache.values()) { try { s.finalize(); } catch { /* ignore */ } }
    this.cache.clear();
    this.raw.close();
  }
}
