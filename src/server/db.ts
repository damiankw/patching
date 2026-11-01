import fs from 'node:fs';
import path from 'node:path';
import { Db } from './sqlite.js';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'rackdocs.db');
const LOCK_DIR = `${DB_PATH}.lock`;
const PID_FILE = path.join(DATA_DIR, 'rackdocs.pid');

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/**
 * The WebAssembly SQLite driver holds a lock directory next to the database for the
 * life of the connection and removes it on a clean close. After a crash, power loss
 * or SIGKILL the directory is left behind and the database would report "locked"
 * forever. We record our PID; on start, a PID file pointing at a dead process (or at
 * ourselves, as happens for PID 1 in a fresh container) means any lock is stale.
 */
function claimInstance() {
  let recordedPid = 0;
  try { recordedPid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch { /* no pid file */ }
  const otherRunning = recordedPid > 0 && recordedPid !== process.pid && processAlive(recordedPid);
  if (otherRunning) {
    console.error(`Another rackdocs instance (pid ${recordedPid}) appears to be using ${DB_PATH}.`);
    console.error(`If that is not the case, delete ${PID_FILE} and ${LOCK_DIR} and start again.`);
    process.exit(1);
  }
  if (fs.existsSync(LOCK_DIR)) {
    console.warn('Removing stale database lock left by an unclean shutdown');
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  }
  fs.writeFileSync(PID_FILE, String(process.pid));
  process.on('exit', () => {
    try { if (Number(fs.readFileSync(PID_FILE, 'utf8').trim()) === process.pid) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  });
}

claimInstance();

/** A database created by the first release (sites/racks model) cannot be upgraded in place; keep it as a backup. */
function retireV1Database() {
  if (!fs.existsSync(DB_PATH)) return;
  const probe = new Db(DB_PATH);
  const hasSites = !!probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sites'").get();
  const hasMeta = !!probe.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get();
  probe.close();
  if (hasSites && !hasMeta) {
    const backup = path.join(DATA_DIR, `rackdocs-v1-backup-${new Date().toISOString().slice(0, 10)}.db`);
    fs.renameSync(DB_PATH, backup);
    console.warn(`Found a database from the first release. It was moved to ${backup} and a new one was created.`);
  }
}
retireV1Database();

export const db = new Db(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 0,
  plan_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  plan_w INTEGER NOT NULL DEFAULT 2000,
  plan_h INTEGER NOT NULL DEFAULT 1400,
  plan_scale REAL,
  plan_opacity INTEGER NOT NULL DEFAULT 50,
  plan_contrast INTEGER NOT NULL DEFAULT 100,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (location_id, code)
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  points TEXT NOT NULL DEFAULT '[]',
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (floor_id, code)
);
CREATE TABLE IF NOT EXISTS device_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('floor','rack')),
  icon TEXT NOT NULL DEFAULT 'box',
  passive INTEGER NOT NULL DEFAULT 0,
  is_rack INTEGER NOT NULL DEFAULT 0,
  is_tray INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS device_type_ports (
  id INTEGER PRIMARY KEY,
  device_type_id INTEGER NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  face TEXT NOT NULL DEFAULT 'front',
  wireless_mode TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  device_type_id INTEGER NOT NULL REFERENCES device_types(id),
  name TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  height_u INTEGER NOT NULL DEFAULT 1,
  width_pct INTEGER NOT NULL DEFAULT 100,
  color TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS template_ports (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  face TEXT NOT NULL DEFAULT 'front',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (template_id, name)
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  rack_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  device_type_id INTEGER NOT NULL REFERENCES device_types(id),
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  position_u INTEGER,
  height_u INTEGER NOT NULL DEFAULT 1,
  width_pct INTEGER NOT NULL DEFAULT 100,
  slot_x INTEGER NOT NULL DEFAULT 0,
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  purchase_date TEXT NOT NULL DEFAULT '',
  operation_start TEXT NOT NULL DEFAULT '',
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_floor ON devices(floor_id, COALESCE(room_id, 0), code) WHERE rack_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_rack ON devices(rack_id, code) WHERE rack_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_floor ON devices(floor_id);
CREATE INDEX IF NOT EXISTS idx_devices_rack ON devices(rack_id);
CREATE TABLE IF NOT EXISTS ports (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  face TEXT NOT NULL DEFAULT 'front',
  sort INTEGER NOT NULL DEFAULT 0,
  wireless_mode TEXT,
  vlan_id INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
  wlan_id INTEGER REFERENCES wlans(id) ON DELETE SET NULL,
  speed INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (device_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ports_device ON ports(device_id);
CREATE TABLE IF NOT EXISTS vlans (
  id INTEGER PRIMARY KEY,
  vid INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wlans (
  id INTEGER PRIMARY KEY,
  ssid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  security TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY,
  port_a_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  port_b_id INTEGER NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('building','user')),
  color TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  cable_type TEXT NOT NULL DEFAULT '',
  length_m REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (port_a_id <> port_b_id)
);
CREATE INDEX IF NOT EXISTS idx_conn_a ON connections(port_a_id);
CREATE INDEX IF NOT EXISTS idx_conn_b ON connections(port_b_id);
CREATE TABLE IF NOT EXISTS device_files (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  entity_label TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(id DESC);
CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  messages TEXT NOT NULL DEFAULT '[]',
  transcript TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
db.exec(SCHEMA);
db.prepare("INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '2')").run();

/** Additive migrations for databases created by earlier v2 builds. */
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumnIfMissing('templates', 'width_pct', 'INTEGER NOT NULL DEFAULT 100');
addColumnIfMissing('devices', 'width_pct', 'INTEGER NOT NULL DEFAULT 100');
addColumnIfMissing('devices', 'slot_x', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('device_types', 'is_tray', 'INTEGER NOT NULL DEFAULT 0');

export function getMeta(key: string, fallback = ''): string {
  const r = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get<{ value: string }>(key);
  return r?.value ?? fallback;
}
export function setMeta(key: string, value: string) {
  db.prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ---------- Seed data ----------
interface PortSeed { names: string[]; kind: string; face?: 'front' | 'rear'; wireless_mode?: string }
const r = (prefix: string, from: number, to: number, kind: string, face: 'front' | 'rear' = 'front', pad = 2): PortSeed =>
  ({ names: Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(pad, '0')}`), kind, face });

const FLOOR_TYPES: { name: string; prefix: string; icon: string; passive?: boolean; is_rack?: boolean; ports: PortSeed[] }[] = [
  { name: 'Access Control Panel', prefix: 'ACP', icon: 'scan-face', ports: [r('', 1, 1, 'rj45')] },
  { name: 'Access Point', prefix: 'AP', icon: 'radio', ports: [r('', 1, 1, 'rj45'), { names: ['W01'], kind: 'wireless', wireless_mode: 'broadcast' }] },
  { name: 'Camera', prefix: 'CAM', icon: 'cctv', ports: [r('', 1, 1, 'rj45')] },
  { name: 'Desktop', prefix: 'DP', icon: 'monitor', ports: [r('', 1, 1, 'rj45')] },
  { name: 'Telecommunications Outlet', prefix: 'TO', icon: 'square-dot', passive: true, ports: [r('', 1, 1, 'rj45')] },
  { name: 'ISP Uplink', prefix: 'ISP', icon: 'globe', ports: [r('', 1, 1, 'rj45')] },
  { name: 'Laptop', prefix: 'LP', icon: 'laptop', ports: [r('', 1, 1, 'rj45'), { names: ['W01'], kind: 'wireless', wireless_mode: 'client' }] },
  { name: 'Phone', prefix: 'PH', icon: 'phone', ports: [r('', 1, 2, 'rj45')] },
  { name: 'Printer', prefix: 'PR', icon: 'printer', ports: [r('', 1, 1, 'rj45')] },
  { name: '3D Printer', prefix: '3DP', icon: 'box', ports: [r('', 1, 1, 'rj45')] },
  { name: 'Rack', prefix: 'RK', icon: 'server', is_rack: true, ports: [] },
  { name: 'Screen', prefix: 'SCR', icon: 'tv', ports: [r('', 1, 1, 'rj45')] },
];
const RACK_TYPES: { name: string; prefix: string; icon: string; passive?: boolean; is_tray?: boolean }[] = [
  { name: 'Cable Manager', prefix: 'CM', icon: 'cable' },
  { name: 'Firewall', prefix: 'FW', icon: 'shield' },
  { name: 'Miscellaneous', prefix: 'MISC', icon: 'box' },
  { name: 'Patch Panel', prefix: 'PP', icon: 'ellipsis', passive: true },
  { name: 'Rack Tray', prefix: 'TR', icon: 'box', is_tray: true },
  { name: 'Router', prefix: 'RT', icon: 'route' },
  { name: 'Server', prefix: 'SRV', icon: 'hard-drive' },
  { name: 'SFP Device', prefix: 'SFP', icon: 'usb' },
  { name: 'Switch', prefix: 'SW', icon: 'network' },
  { name: 'UPS', prefix: 'UPS', icon: 'battery-charging' },
];
const TEMPLATES: { type: string; name: string; height_u: number; width_pct?: number; ports: PortSeed[] }[] = [
  { type: 'Patch Panel', name: 'Patch Panel - 24 Ports - RJ45', height_u: 1, ports: [r('', 1, 24, 'rj45')] },
  { type: 'Patch Panel', name: 'Patch Panel - 48 Ports - RJ45', height_u: 2, ports: [r('', 1, 48, 'rj45')] },
  { type: 'Patch Panel', name: 'Patch Panel - 12 Ports - LC', height_u: 1, ports: [r('', 1, 12, 'lc')] },
  { type: 'Patch Panel', name: 'Patch Panel - 24 Ports - LC', height_u: 1, ports: [r('', 1, 24, 'lc')] },
  { type: 'Switch', name: 'Switch - 8 Ports - RJ45', height_u: 1, ports: [r('', 1, 8, 'rj45'), r('', 9, 10, 'sfp')] },
  { type: 'Switch', name: 'Switch - 24 Ports - RJ45', height_u: 1, ports: [r('', 1, 24, 'rj45'), r('', 25, 28, 'sfp+')] },
  { type: 'Switch', name: 'Switch - 48 Ports - RJ45', height_u: 1, ports: [r('', 1, 48, 'rj45'), r('', 49, 52, 'sfp+')] },
  { type: 'Switch', name: 'Switch - 24 Ports - SFP+', height_u: 1, ports: [r('', 1, 24, 'sfp+')] },
  { type: 'Firewall', name: 'Firewall - 6 Ports', height_u: 1, ports: [{ names: ['WAN', 'LAN', 'DMZ', 'OPT1', 'OPT2', 'MGMT'], kind: 'rj45' }] },
  { type: 'Router', name: 'Router - 4 Ports', height_u: 1, ports: [{ names: ['WAN1', 'WAN2', 'LAN1', 'LAN2'], kind: 'rj45' }, { names: ['CON'], kind: 'console' }] },
  { type: 'Server', name: 'Server - 1U', height_u: 1, ports: [{ names: ['ETH1', 'ETH2', 'ETH3', 'ETH4', 'IPMI'], kind: 'rj45', face: 'rear' }, { names: ['PSU1', 'PSU2'], kind: 'power', face: 'rear' }] },
  { type: 'Server', name: 'Server - 2U', height_u: 2, ports: [{ names: ['ETH1', 'ETH2', 'ETH3', 'ETH4', 'IPMI'], kind: 'rj45', face: 'rear' }, { names: ['SFP1', 'SFP2'], kind: 'sfp+', face: 'rear' }, { names: ['PSU1', 'PSU2'], kind: 'power', face: 'rear' }] },
  { type: 'UPS', name: 'UPS - 2U', height_u: 2, ports: [{ names: ['MGMT'], kind: 'rj45', face: 'rear' }, r('OUT', 1, 6, 'power', 'rear', 1)] },
  { type: 'SFP Device', name: 'Media Converter', height_u: 1, ports: [{ names: ['RJ45'], kind: 'rj45' }, { names: ['SFP'], kind: 'sfp' }] },
  { type: 'Cable Manager', name: 'Cable Manager - 1U', height_u: 1, ports: [] },
  { type: 'Cable Manager', name: 'Cable Manager - 2U', height_u: 2, ports: [] },
  { type: 'Miscellaneous', name: 'Blank Panel - 1U', height_u: 1, ports: [] },
  { type: 'Miscellaneous', name: 'Shelf - 1U', height_u: 1, ports: [] },
  { type: 'Miscellaneous', name: 'KVM - 1U', height_u: 1, ports: [r('', 1, 8, 'other')] },
  { type: 'Rack Tray', name: 'Rack Tray - 1U', height_u: 1, width_pct: 100, ports: [] },
  { type: 'Rack Tray', name: 'Rack Tray - 2U', height_u: 2, width_pct: 100, ports: [] },
  { type: 'Server', name: 'Server - 1U - 1/2 width', height_u: 1, width_pct: 50, ports: [{ names: ['ETH1', 'ETH2'], kind: 'rj45', face: 'rear' }, { names: ['PSU'], kind: 'power', face: 'rear' }] },
  { type: 'Server', name: 'Desktop NAS - 4U - 1/3 width', height_u: 4, width_pct: 33, ports: [{ names: ['ETH1', 'ETH2'], kind: 'rj45', face: 'rear' }, { names: ['PSU'], kind: 'power', face: 'rear' }] },
  { type: 'Miscellaneous', name: 'Mini PC - 1U - 1/3 width', height_u: 1, width_pct: 33, ports: [{ names: ['ETH1'], kind: 'rj45', face: 'rear' }, { names: ['HDMI'], kind: 'hdmi', face: 'rear' }] },
  { type: 'Miscellaneous', name: 'CCTV recorder - 2U - 1/2 width', height_u: 2, width_pct: 50, ports: [{ names: ['ETH1'], kind: 'rj45', face: 'rear' }, { names: ['HDMI', 'VGA'], kind: 'hdmi', face: 'rear' }, r('CAM', 1, 8, 'other', 'rear', 1)] },
];

export function seed() {
  if (db.prepare('SELECT 1 FROM device_types LIMIT 1').get()) return;
  const insType = db.prepare('INSERT INTO device_types (name, prefix, kind, icon, passive, is_rack, is_builtin, sort) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  const insTypePort = db.prepare('INSERT INTO device_type_ports (device_type_id, name, kind, face, wireless_mode, sort) VALUES (?, ?, ?, ?, ?, ?)');
  const insTpl = db.prepare('INSERT INTO templates (device_type_id, name, height_u, width_pct, is_builtin) VALUES (?, ?, ?, ?, 1)');
  const insTplPort = db.prepare('INSERT INTO template_ports (template_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    const typeIds = new Map<string, number>();
    FLOOR_TYPES.forEach((t, i) => {
      const id = insType.run(t.name, t.prefix, 'floor', t.icon, t.passive ? 1 : 0, t.is_rack ? 1 : 0, i).lastInsertRowid;
      typeIds.set(t.name, id);
      let sort = 0;
      for (const p of t.ports) for (const n of p.names) insTypePort.run(id, n, p.kind, p.face ?? 'front', p.wireless_mode ?? null, sort++);
    });
    RACK_TYPES.forEach((t, i) => { const id = insType.run(t.name, t.prefix, 'rack', t.icon, t.passive ? 1 : 0, 0, i).lastInsertRowid; if (t.is_tray) db.prepare('UPDATE device_types SET is_tray = 1 WHERE id = ?').run(id); typeIds.set(t.name, id); });
    for (const t of TEMPLATES) {
      const id = insTpl.run(typeIds.get(t.type)!, t.name, t.height_u, t.width_pct ?? 100).lastInsertRowid;
      let sort = 0;
      for (const p of t.ports) for (const n of p.names) insTplPort.run(id, n, p.kind, p.face ?? 'front', sort++);
    }
  })();
}
seed();
/** Templates added after the first v2 release: insert into existing databases if absent. */
function seedNewTemplates() {
  if (!db.prepare("SELECT 1 FROM device_types WHERE name = 'Rack Tray'").get()) db.prepare("INSERT INTO device_types (name, prefix, kind, icon, passive, is_rack, is_tray, is_builtin, sort) VALUES ('Rack Tray', 'TR', 'rack', 'box', 0, 0, 1, 1, 4)").run();
  const ins = db.prepare('INSERT INTO templates (device_type_id, name, height_u, width_pct, is_builtin) VALUES (?, ?, ?, ?, 1)');
  const insPort = db.prepare('INSERT INTO template_ports (template_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)');
  for (const t of TEMPLATES.filter((x) => x.width_pct !== undefined)) {
    if (db.prepare('SELECT 1 FROM templates WHERE name = ?').get(t.name)) continue;
    const type = db.prepare('SELECT id FROM device_types WHERE name = ?').get<{ id: number }>(t.type); if (!type) continue;
    const id = ins.run(type.id, t.name, t.height_u, t.width_pct ?? 100).lastInsertRowid;
    let sort = 0; for (const p of t.ports) for (const n of p.names) insPort.run(id, n, p.kind, p.face ?? 'front', sort++);
  }
}
seedNewTemplates();
