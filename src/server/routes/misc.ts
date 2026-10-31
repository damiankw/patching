import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

export const miscRouter = Router();
miscRouter.use(requireRole('viewer'));

miscRouter.get('/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toUpperCase();
  if (!q) return res.json({ sites: [], racks: [], devices: [], vlans: [] });
  const like = `%${q}%`;
  const sites = db.prepare(`SELECT id, code, name FROM sites WHERE UPPER(code) LIKE ? OR UPPER(name) LIKE ? OR UPPER(address) LIKE ? LIMIT 10`).all(like, like, like);
  const racks = db.prepare(`SELECT r.id, r.code, r.name, s.code AS site_code, ro.code AS room_code FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    WHERE UPPER(r.code) LIKE ? OR UPPER(r.name) LIKE ? LIMIT 10`).all(like, like);
  const devices = db.prepare(`SELECT d.id, d.code, d.name, d.serial, d.ip_address, d.position_u, dt.name AS type_name, r.id AS rack_id, r.code AS rack_code, s.code AS site_code
    FROM devices d JOIN device_types dt ON dt.id = d.device_type_id JOIN racks r ON r.id = d.rack_id JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    WHERE UPPER(d.code) LIKE ? OR UPPER(d.name) LIKE ? OR UPPER(d.serial) LIKE ? OR UPPER(d.ip_address) LIKE ? OR UPPER(d.notes) LIKE ? LIMIT 20`).all(like, like, like, like, like);
  const vlans = db.prepare(`SELECT v.id, v.vid, v.name, v.site_id, s.code AS site_code FROM vlans v JOIN sites s ON s.id = v.site_id WHERE CAST(v.vid AS TEXT) LIKE ? OR UPPER(v.name) LIKE ? LIMIT 10`).all(like, like);
  res.json({ sites, racks, devices, vlans });
});

miscRouter.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const q = String(req.query.q ?? '').trim().toUpperCase();
  const rows = db.prepare(`SELECT * FROM activity_log WHERE (? = '' OR UPPER(entity_label || ' ' || user_name || ' ' || action || ' ' || entity_type) LIKE '%' || ? || '%')
    ORDER BY id DESC LIMIT ? OFFSET ?`).all(q, q, limit, offset) as { details: string }[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM activity_log WHERE (? = '' OR UPPER(entity_label || ' ' || user_name || ' ' || action || ' ' || entity_type) LIKE '%' || ? || '%')`).get(q, q) as { c: number }).c;
  res.json({ total, rows: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })) });
});

miscRouter.get('/stats', (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  res.json({
    sites: one('SELECT COUNT(*) AS c FROM sites'), racks: one('SELECT COUNT(*) AS c FROM racks'),
    devices: one('SELECT COUNT(*) AS c FROM devices'), connections: one('SELECT COUNT(*) AS c FROM connections'),
    vlans: one('SELECT COUNT(*) AS c FROM vlans'),
  });
});

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

const EXPORTS: Record<string, { sql: string; columns: string[] }> = {
  racks: {
    sql: `SELECT s.code AS site, f.code AS floor, ro.code AS room, r.code AS rack, r.name, r.height_u,
      (SELECT COUNT(*) FROM devices d WHERE d.rack_id = r.id) AS devices,
      (SELECT COALESCE(SUM(dt.height_u),0) FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = r.id) AS used_u, r.notes
      FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id ORDER BY s.code, f.code, ro.code, r.code`,
    columns: ['site', 'floor', 'room', 'rack', 'name', 'height_u', 'devices', 'used_u', 'notes'],
  },
  devices: {
    sql: `SELECT s.code AS site, r.code AS rack, d.code AS device, d.name, dt.name AS type, dt.category, dt.manufacturer, dt.model, d.position_u, dt.height_u, d.serial, d.ip_address, d.notes
      FROM devices d JOIN device_types dt ON dt.id = d.device_type_id JOIN racks r ON r.id = d.rack_id JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
      ORDER BY s.code, r.code, d.position_u DESC`,
    columns: ['site', 'rack', 'device', 'name', 'type', 'category', 'manufacturer', 'model', 'position_u', 'height_u', 'serial', 'ip_address', 'notes'],
  },
  ports: {
    sql: `SELECT s.code AS site, r.code AS rack, d.code AS device, p.face, p.name AS port, p.kind, v.vid AS vlan, p.notes,
      (SELECT d2.code || ':' || p2.name FROM connections c JOIN ports p2 ON p2.id = CASE WHEN c.port_a_id = p.id THEN c.port_b_id ELSE c.port_a_id END JOIN devices d2 ON d2.id = p2.device_id WHERE c.port_a_id = p.id OR c.port_b_id = p.id) AS connected_to
      FROM ports p JOIN devices d ON d.id = p.device_id LEFT JOIN vlans v ON v.id = p.vlan_id JOIN racks r ON r.id = d.rack_id JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
      ORDER BY s.code, r.code, d.position_u DESC, p.face, p.sort`,
    columns: ['site', 'rack', 'device', 'face', 'port', 'kind', 'vlan', 'connected_to', 'notes'],
  },
  connections: {
    sql: `SELECT sa.code AS a_site, ra.code AS a_rack, da.code AS a_device, pa.face AS a_face, pa.name AS a_port,
      sb.code AS b_site, rb.code AS b_rack, db2.code AS b_device, pb.face AS b_face, pb.name AS b_port, c.cable_type, c.color, c.label, c.length_m, c.notes
      FROM connections c
      JOIN ports pa ON pa.id = c.port_a_id JOIN devices da ON da.id = pa.device_id JOIN racks ra ON ra.id = da.rack_id JOIN rooms roa ON roa.id = ra.room_id JOIN floors fa ON fa.id = roa.floor_id JOIN sites sa ON sa.id = fa.site_id
      JOIN ports pb ON pb.id = c.port_b_id JOIN devices db2 ON db2.id = pb.device_id JOIN racks rb ON rb.id = db2.rack_id JOIN rooms rob ON rob.id = rb.room_id JOIN floors fb ON fb.id = rob.floor_id JOIN sites sb ON sb.id = fb.site_id
      ORDER BY sa.code, ra.code, da.code, pa.sort`,
    columns: ['a_site', 'a_rack', 'a_device', 'a_face', 'a_port', 'b_site', 'b_rack', 'b_device', 'b_face', 'b_port', 'cable_type', 'color', 'label', 'length_m', 'notes'],
  },
  vlans: {
    sql: `SELECT s.code AS site, v.vid, v.name, v.description, (SELECT COUNT(*) FROM ports p WHERE p.vlan_id = v.id) AS ports FROM vlans v JOIN sites s ON s.id = v.site_id ORDER BY s.code, v.vid`,
    columns: ['site', 'vid', 'name', 'description', 'ports'],
  },
};

miscRouter.get('/export/:what.csv', (req, res) => {
  const spec = EXPORTS[req.params.what as string];
  if (!spec) return res.status(404).json({ error: 'Unknown export' });
  const rows = db.prepare(spec.sql).all() as Record<string, unknown>[];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rackdocs-${req.params.what}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv(rows, spec.columns));
});
