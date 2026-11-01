import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, UPLOAD_DIR } from '../db.js';
import { requireRole } from '../auth.js';
import { notFound } from '../errors.js';
import { DEVICE_COLS, DEVICE_JOIN, DEVICE_PATH, getPort, resolvePath, tracePort } from '../model.js';

export const miscRouter = Router();
miscRouter.use(requireRole('viewer'));

miscRouter.get('/files/:uuid', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE uuid = ?').get<{ uuid: string; mime: string; name: string }>(String(req.params.uuid));
  if (!f) throw notFound('File not found');
  const p = path.join(UPLOAD_DIR, f.uuid);
  if (!fs.existsSync(p)) throw notFound('File missing on disk');
  res.setHeader('Content-Type', f.mime); res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(p).pipe(res);
});

miscRouter.get('/resolve', (req, res) => {
  const r = resolvePath(String(req.query.path ?? ''));
  if (!r) throw notFound(`Nothing found at path ${req.query.path}`);
  res.json(r);
});

miscRouter.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toUpperCase();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const out: { kind: string; id: number; path: string; name: string; sub: string; to: string }[] = [];
  for (const l of db.prepare('SELECT id, code, name, address FROM locations WHERE UPPER(code) LIKE ? OR UPPER(name) LIKE ? OR UPPER(address) LIKE ? LIMIT 5').all<{ id: number; code: string; name: string; address: string }>(like, like, like))
    out.push({ kind: 'Location', id: l.id, path: l.code, name: l.name, sub: l.address, to: `/locations/${l.id}` });
  for (const f of db.prepare('SELECT f.id, f.code, f.name, l.code AS lc FROM floors f JOIN locations l ON l.id = f.location_id WHERE UPPER(f.code) LIKE ? OR UPPER(f.name) LIKE ? LIMIT 5').all<{ id: number; code: string; name: string; lc: string }>(like, like))
    out.push({ kind: 'Floor', id: f.id, path: `${f.lc}/${f.code}`, name: f.name, sub: '', to: `/floors/${f.id}` });
  for (const r of db.prepare('SELECT r.id, r.code, r.name, r.floor_id, l.code AS lc, f.code AS fc FROM rooms r JOIN floors f ON f.id = r.floor_id JOIN locations l ON l.id = f.location_id WHERE UPPER(r.code) LIKE ? OR UPPER(r.name) LIKE ? LIMIT 5').all<{ id: number; code: string; name: string; floor_id: number; lc: string; fc: string }>(like, like))
    out.push({ kind: 'Room', id: r.id, path: `${r.lc}/${r.fc}/${r.code}`, name: r.name, sub: '', to: `/floors/${r.floor_id}?room=${r.id}` });
  for (const d of db.prepare(`SELECT d.id, d.name, d.serial, d.rack_id, d.floor_id, dt.name AS type_name, dt.is_rack, ${DEVICE_PATH} AS path ${DEVICE_JOIN}
      WHERE UPPER(d.code) LIKE ? OR UPPER(d.name) LIKE ? OR UPPER(d.serial) LIKE ? OR UPPER(d.model) LIKE ? OR UPPER(d.manufacturer) LIKE ? OR UPPER(d.notes) LIKE ? LIMIT 15`).all<{ id: number; name: string; serial: string; rack_id: number | null; floor_id: number; type_name: string; is_rack: number; path: string }>(like, like, like, like, like, like))
    out.push({ kind: d.is_rack ? 'Rack' : d.rack_id ? 'Rack device' : 'Device', id: d.id, path: d.path, name: d.name, sub: d.type_name + (d.serial ? ` · SN ${d.serial}` : ''), to: d.is_rack ? `/racks/${d.id}` : d.rack_id ? `/racks/${d.rack_id}?device=${d.id}` : `/floors/${d.floor_id}?device=${d.id}` });
  for (const v of db.prepare('SELECT id, vid, name FROM vlans WHERE CAST(vid AS TEXT) LIKE ? OR UPPER(name) LIKE ? LIMIT 5').all<{ id: number; vid: number; name: string }>(like, like))
    out.push({ kind: 'VLAN', id: v.id, path: `VLAN ${v.vid}`, name: v.name, sub: '', to: `/networks/vlans` });
  for (const w of db.prepare('SELECT id, ssid, name FROM wlans WHERE UPPER(ssid) LIKE ? OR UPPER(name) LIKE ? LIMIT 5').all<{ id: number; ssid: string; name: string }>(like, like))
    out.push({ kind: 'WLAN', id: w.id, path: w.ssid, name: w.name, sub: '', to: `/networks/wlans` });
  res.json(out);
});

miscRouter.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500); const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const q = String(req.query.q ?? '').trim().toUpperCase();
  const action = String(req.query.action ?? ''); const type = String(req.query.entity_type ?? ''); const user = String(req.query.user ?? '');
  const from = String(req.query.from ?? ''); const to = String(req.query.to ?? '');
  const where = `(? = '' OR UPPER(entity_label) LIKE '%' || ? || '%') AND (? = '' OR action = ?) AND (? = '' OR entity_type = ?) AND (? = '' OR user_name = ?) AND (? = '' OR created_at >= ?) AND (? = '' OR created_at <= ? || ' 23:59:59')`;
  const args = [q, q, action, action, type, type, user, user, from, from, to, to];
  const rows = db.prepare(`SELECT * FROM activity_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all<{ details: string }>(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM activity_log WHERE ${where}`).get<{ c: number }>(...args)!.c;
  res.json({ total, rows: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })) });
});
miscRouter.get('/activity/filters', (_req, res) => {
  res.json({
    actions: db.prepare('SELECT DISTINCT action FROM activity_log ORDER BY action').all<{ action: string }>().map((r) => r.action),
    types: db.prepare('SELECT DISTINCT entity_type FROM activity_log ORDER BY entity_type').all<{ entity_type: string }>().map((r) => r.entity_type),
    users: db.prepare('SELECT DISTINCT user_name FROM activity_log ORDER BY user_name').all<{ user_name: string }>().map((r) => r.user_name),
  });
});

// ---------- Resources ----------
const RES: Record<string, string> = {
  locations: `SELECT l.id, l.code AS path, l.name, l.address, l.lat, l.lng, u.name AS responsible, (SELECT COUNT(*) FROM floors f WHERE f.location_id = l.id) AS floors,
    (SELECT COUNT(*) FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.location_id = l.id) AS rooms, (SELECT COUNT(*) FROM devices d JOIN floors f ON f.id = d.floor_id WHERE f.location_id = l.id) AS devices, l.created_at, l.updated_at
    FROM locations l LEFT JOIN users u ON u.id = l.responsible_user_id ORDER BY l.code`,
  floors: `SELECT f.id, l.code || '/' || f.code AS path, f.name, f.level, l.code AS location, l.id AS location_id, u.name AS responsible, (SELECT COUNT(*) FROM rooms r WHERE r.floor_id = f.id) AS rooms,
    (SELECT COUNT(*) FROM devices d WHERE d.floor_id = f.id) AS devices, CASE WHEN f.plan_file_id IS NULL THEN 'no' ELSE 'yes' END AS floor_plan, f.created_at, f.updated_at
    FROM floors f JOIN locations l ON l.id = f.location_id LEFT JOIN users u ON u.id = f.responsible_user_id ORDER BY l.code, f.level`,
  rooms: `SELECT r.id, l.code || '/' || f.code || '/' || r.code AS path, r.name, l.code AS location, l.id AS location_id, l.code || '/' || f.code AS floor, f.id AS floor_id, u.name AS responsible,
    (SELECT COUNT(*) FROM devices d WHERE d.room_id = r.id AND d.rack_id IS NULL) AS devices, r.created_at, r.updated_at
    FROM rooms r JOIN floors f ON f.id = r.floor_id JOIN locations l ON l.id = f.location_id LEFT JOIN users u ON u.id = r.responsible_user_id ORDER BY path`,
  devices: `SELECT d.id, ${DEVICE_PATH} AS path, d.name, l.code AS location, l.id AS location_id, l.code || '/' || f.code AS floor, f.id AS floor_id, l.code || '/' || f.code || '/' || COALESCE(ro.code, 'DEFAULT') AS room, ro.id AS room_id,
    rk.code AS rack, d.rack_id, dt.name AS device_type, d.manufacturer, d.model, d.serial, d.purchase_date, d.operation_start, ru.name AS responsible,
    (SELECT COUNT(*) FROM ports p WHERE p.device_id = d.id) AS ports,
    (SELECT COUNT(DISTINCT p.id) FROM ports p JOIN connections c ON c.port_a_id = p.id OR c.port_b_id = p.id WHERE p.device_id = d.id) AS connected_ports,
    d.created_at, d.updated_at ${DEVICE_JOIN} ORDER BY path`,
  ports: `SELECT p.id, ${DEVICE_PATH} || '/' || p.name AS path, p.name, p.kind, p.face, p.wireless_mode, ${DEVICE_PATH} AS device, d.id AS device_id, d.rack_id, d.floor_id, dt.name AS device_type, v.vid AS vlan, w.ssid AS wlan, p.speed,
    (SELECT COUNT(*) FROM connections c WHERE (c.port_a_id = p.id OR c.port_b_id = p.id) AND c.type = 'building') AS building, (SELECT COUNT(*) FROM connections c WHERE (c.port_a_id = p.id OR c.port_b_id = p.id) AND c.type = 'user') AS user_conn
    FROM ports p LEFT JOIN vlans v ON v.id = p.vlan_id LEFT JOIN wlans w ON w.id = p.wlan_id JOIN devices d ON d.id = p.device_id JOIN device_types dt ON dt.id = d.device_type_id LEFT JOIN rooms ro ON ro.id = d.room_id JOIN floors f ON f.id = d.floor_id JOIN locations l ON l.id = f.location_id LEFT JOIN devices rk ON rk.id = d.rack_id ORDER BY path`,
};
miscRouter.get('/resources/:tab', (req, res) => {
  const tab = String(req.params.tab);
  if (tab === 'connections') {
    const rows = db.prepare('SELECT * FROM connections ORDER BY id DESC').all<{ id: number; port_a_id: number; port_b_id: number; type: string; color: string; label: string; cable_type: string; length_m: number | null; created_at: string }>();
    return res.json(rows.map((c) => { const a = getPort(c.port_a_id); const b = getPort(c.port_b_id); const t = tracePort(c.port_a_id);
      return { id: c.id, path: `${a.path} ⇄ ${b.path}`, from: a.path, to: b.path, type: c.type, color: c.color, label: c.label, cable_type: c.cable_type, length_m: c.length_m, complete: t.complete ? 'yes' : 'no', chain_from: t.steps[0].port.path, chain_to: t.steps[t.steps.length - 1].port.path, a_device_id: a.device_id, a_rack_id: a.rack_id, a_floor_id: a.floor_id, created_at: c.created_at }; }));
  }
  const sql = RES[tab];
  if (!sql) throw notFound('Unknown resource tab');
  res.json(db.prepare(sql).all());
});

function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}
miscRouter.get('/export/:tab.csv', (req, res) => {
  const tab = String(req.params.tab);
  let rows: Record<string, unknown>[];
  if (tab === 'connections') {
    rows = db.prepare('SELECT * FROM connections ORDER BY id').all<{ port_a_id: number; port_b_id: number; type: string; color: string; label: string; cable_type: string; length_m: number | null; notes: string }>()
      .map((c) => { const t = tracePort(c.port_a_id); return { from: getPort(c.port_a_id).path, to: getPort(c.port_b_id).path, type: c.type, color: c.color, label: c.label, cable_type: c.cable_type, length_m: c.length_m, chain_from: t.steps[0].port.path, chain_to: t.steps[t.steps.length - 1].port.path, complete: t.complete ? 'yes' : 'no', notes: c.notes }; });
  } else if (tab === 'activity') {
    rows = db.prepare('SELECT created_at, user_name, action, entity_type, entity_label, details FROM activity_log ORDER BY id DESC').all();
  } else if (tab === 'vlans') {
    rows = db.prepare('SELECT vid, name, description, (SELECT COUNT(*) FROM ports p WHERE p.vlan_id = vlans.id) AS ports FROM vlans ORDER BY vid').all();
  } else if (tab === 'wlans') {
    rows = db.prepare('SELECT ssid, name, security, description, (SELECT COUNT(*) FROM ports p WHERE p.wlan_id = wlans.id) AS ports FROM wlans ORDER BY ssid').all();
  } else if (tab === 'racks') {
    rows = db.prepare(`SELECT ${DEVICE_PATH} AS path, d.name, l.code AS location, f.code AS floor, COALESCE(ro.code, 'DEFAULT') AS room, d.height_u AS rack_units, (SELECT COUNT(*) FROM devices c WHERE c.rack_id = d.id) AS devices, d.manufacturer, d.model, d.serial, d.notes ${DEVICE_JOIN} WHERE dt.is_rack = 1 ORDER BY path`).all();
  } else {
    const sql = RES[tab]; if (!sql) throw notFound('Unknown export');
    rows = db.prepare(sql).all();
    for (const r of rows) for (const k of Object.keys(r)) if (/_id$/.test(k) || k === 'id') delete r[k];
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rackdocs-${tab}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(rows));
});

miscRouter.get('/stats', (_req, res) => {
  const one = (sql: string) => db.prepare(sql).get<{ c: number }>()!.c;
  res.json({ locations: one('SELECT COUNT(*) AS c FROM locations'), floors: one('SELECT COUNT(*) AS c FROM floors'), rooms: one('SELECT COUNT(*) AS c FROM rooms'),
    devices: one('SELECT COUNT(*) AS c FROM devices'), racks: one('SELECT COUNT(*) AS c FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE dt.is_rack = 1'),
    connections: one('SELECT COUNT(*) AS c FROM connections'), vlans: one('SELECT COUNT(*) AS c FROM vlans'), wlans: one('SELECT COUNT(*) AS c FROM wlans') });
});
void DEVICE_COLS;
