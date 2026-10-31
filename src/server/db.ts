import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = path.join(DATA_DIR, 'rackdocs.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS floors (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (site_id, code)
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  floor_id INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (floor_id, code)
);
CREATE TABLE IF NOT EXISTS racks (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  height_u INTEGER NOT NULL DEFAULT 42,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, code)
);
CREATE TABLE IF NOT EXISTS device_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  height_u INTEGER NOT NULL DEFAULT 1,
  passthrough INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#4b5563',
  is_builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS device_type_ports (
  id INTEGER PRIMARY KEY,
  device_type_id INTEGER NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  face TEXT NOT NULL CHECK (face IN ('front','rear')),
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (device_type_id, face, name)
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  rack_id INTEGER NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  device_type_id INTEGER NOT NULL REFERENCES device_types(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  position_u INTEGER NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (rack_id, code)
);
CREATE TABLE IF NOT EXISTS ports (
  id INTEGER PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  face TEXT NOT NULL CHECK (face IN ('front','rear')),
  sort INTEGER NOT NULL DEFAULT 0,
  passthrough_port_id INTEGER REFERENCES ports(id) ON DELETE SET NULL,
  vlan_id INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (device_id, face, name)
);
CREATE TABLE IF NOT EXISTS vlans (
  id INTEGER PRIMARY KEY,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  vid INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (site_id, vid)
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY,
  port_a_id INTEGER NOT NULL UNIQUE REFERENCES ports(id) ON DELETE CASCADE,
  port_b_id INTEGER NOT NULL UNIQUE REFERENCES ports(id) ON DELETE CASCADE,
  cable_type TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  length_m REAL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (port_a_id <> port_b_id)
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
CREATE INDEX IF NOT EXISTS idx_devices_rack ON devices(rack_id);
CREATE INDEX IF NOT EXISTS idx_ports_device ON ports(device_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
`;

db.exec(SCHEMA);

type PortSpec = { prefix?: string; from: number; to: number; kind: string; face: 'front' | 'rear'; names?: string[] };
type TypeSeed = {
  name: string; manufacturer?: string; model?: string; category: string; height_u: number;
  passthrough?: boolean; color: string; ports: PortSpec[];
};

function range(prefix: string, from: number, to: number, kind: string, face: 'front' | 'rear'): PortSpec {
  return { prefix, from, to, kind, face };
}
function named(names: string[], kind: string, face: 'front' | 'rear'): PortSpec {
  return { from: 0, to: 0, kind, face, names };
}

const SEED_TYPES: TypeSeed[] = [
  { name: '24-port patch panel', category: 'patch_panel', height_u: 1, passthrough: true, color: '#1f2937',
    ports: [range('', 1, 24, 'rj45', 'front'), range('', 1, 24, 'rj45', 'rear')] },
  { name: '48-port patch panel', category: 'patch_panel', height_u: 2, passthrough: true, color: '#1f2937',
    ports: [range('', 1, 48, 'rj45', 'front'), range('', 1, 48, 'rj45', 'rear')] },
  { name: '12-port LC fibre panel', category: 'patch_panel', height_u: 1, passthrough: true, color: '#374151',
    ports: [range('', 1, 12, 'lc', 'front'), range('', 1, 12, 'lc', 'rear')] },
  { name: '24-port LC fibre panel', category: 'patch_panel', height_u: 1, passthrough: true, color: '#374151',
    ports: [range('', 1, 24, 'lc', 'front'), range('', 1, 24, 'lc', 'rear')] },
  { name: '24-port switch (4 SFP+)', category: 'switch', height_u: 1, color: '#2563eb',
    ports: [range('', 1, 24, 'rj45', 'front'), range('', 25, 28, 'sfp+', 'front'), named(['CON', 'MGMT'], 'console', 'front'), named(['PSU1'], 'power_in', 'rear')] },
  { name: '48-port switch (4 SFP+)', category: 'switch', height_u: 1, color: '#2563eb',
    ports: [range('', 1, 48, 'rj45', 'front'), range('', 49, 52, 'sfp+', 'front'), named(['CON', 'MGMT'], 'console', 'front'), named(['PSU1', 'PSU2'], 'power_in', 'rear')] },
  { name: '8-port PoE switch', category: 'switch', height_u: 1, color: '#2563eb',
    ports: [range('', 1, 8, 'rj45', 'front'), range('', 9, 10, 'sfp', 'front'), named(['PSU1'], 'power_in', 'rear')] },
  { name: 'Router 1U', category: 'router', height_u: 1, color: '#7c3aed',
    ports: [named(['WAN1', 'WAN2', 'LAN1', 'LAN2', 'LAN3', 'LAN4', 'CON'], 'rj45', 'front'), named(['PSU1'], 'power_in', 'rear')] },
  { name: 'Firewall 1U', category: 'firewall', height_u: 1, color: '#dc2626',
    ports: [named(['WAN', 'LAN', 'DMZ', 'OPT1', 'OPT2', 'MGMT'], 'rj45', 'front'), named(['PSU1', 'PSU2'], 'power_in', 'rear')] },
  { name: 'Server 1U', category: 'server', height_u: 1, color: '#059669',
    ports: [named(['ETH1', 'ETH2', 'ETH3', 'ETH4', 'IPMI'], 'rj45', 'rear'), named(['PSU1', 'PSU2'], 'power_in', 'rear')] },
  { name: 'Server 2U', category: 'server', height_u: 2, color: '#059669',
    ports: [named(['ETH1', 'ETH2', 'ETH3', 'ETH4', 'IPMI'], 'rj45', 'rear'), named(['SFP1', 'SFP2'], 'sfp+', 'rear'), named(['PSU1', 'PSU2'], 'power_in', 'rear')] },
  { name: 'Storage 2U', category: 'storage', height_u: 2, color: '#0d9488',
    ports: [named(['ETH1', 'ETH2', 'MGMT'], 'rj45', 'rear'), named(['SFP1', 'SFP2', 'SFP3', 'SFP4'], 'sfp+', 'rear'), named(['PSU1', 'PSU2'], 'power_in', 'rear')] },
  { name: 'PDU 1U (8 outlets)', category: 'pdu', height_u: 1, color: '#d97706',
    ports: [range('OUT', 1, 8, 'power_out', 'rear'), named(['IN'], 'power_in', 'rear')] },
  { name: 'UPS 2U', category: 'ups', height_u: 2, color: '#d97706',
    ports: [range('OUT', 1, 6, 'power_out', 'rear'), named(['IN', 'MGMT'], 'power_in', 'rear')] },
  { name: 'KVM 1U', category: 'other', height_u: 1, color: '#6b7280',
    ports: [range('', 1, 8, 'other', 'rear'), named(['PSU1'], 'power_in', 'rear')] },
  { name: 'Blank panel 1U', category: 'other', height_u: 1, color: '#9ca3af', ports: [] },
  { name: 'Blank panel 2U', category: 'other', height_u: 2, color: '#9ca3af', ports: [] },
  { name: 'Cable manager 1U', category: 'other', height_u: 1, color: '#9ca3af', ports: [] },
  { name: 'Shelf 1U', category: 'other', height_u: 1, color: '#9ca3af', ports: [] },
];

export function expandPortSpecs(specs: PortSpec[]): { name: string; kind: string; face: 'front' | 'rear'; sort: number }[] {
  const out: { name: string; kind: string; face: 'front' | 'rear'; sort: number }[] = [];
  let sort = 0;
  for (const s of specs) {
    if (s.names) {
      for (const n of s.names) out.push({ name: n, kind: s.kind, face: s.face, sort: sort++ });
    } else {
      for (let i = s.from; i <= s.to; i++) out.push({ name: `${s.prefix ?? ''}${i}`, kind: s.kind, face: s.face, sort: sort++ });
    }
  }
  return out;
}

export function seedDeviceTypes() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM device_types WHERE is_builtin = 1').get() as { c: number }).c;
  if (count > 0) return;
  const insType = db.prepare(`INSERT INTO device_types (name, manufacturer, model, category, height_u, passthrough, color, is_builtin)
    VALUES (@name, @manufacturer, @model, @category, @height_u, @passthrough, @color, 1)`);
  const insPort = db.prepare(`INSERT INTO device_type_ports (device_type_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)`);
  const tx = db.transaction(() => {
    for (const t of SEED_TYPES) {
      const r = insType.run({ name: t.name, manufacturer: t.manufacturer ?? '', model: t.model ?? '', category: t.category,
        height_u: t.height_u, passthrough: t.passthrough ? 1 : 0, color: t.color });
      for (const p of expandPortSpecs(t.ports)) insPort.run(r.lastInsertRowid, p.name, p.kind, p.face, p.sort);
    }
  });
  tx();
}

seedDeviceTypes();
