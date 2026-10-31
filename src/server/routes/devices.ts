import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { codeSchema, idParam, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { tracePort } from '../trace.js';

export const devicesRouter = Router();
devicesRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

export function checkPlacement(rackId: number, positionU: number, heightU: number, excludeDeviceId: number | null) {
  const rack = db.prepare('SELECT height_u, code FROM racks WHERE id = ?').get(rackId) as { height_u: number; code: string } | undefined;
  if (!rack) throw notFound('Rack not found');
  const top = positionU + heightU - 1;
  if (positionU < 1 || top > rack.height_u) throw badRequest(`Device would occupy U${positionU}-U${top}; rack ${rack.code} has ${rack.height_u}U`);
  const clash = db.prepare(`SELECT d.code FROM devices d JOIN device_types dt ON dt.id = d.device_type_id
    WHERE d.rack_id = ? AND (? IS NULL OR d.id <> ?) AND d.position_u <= ? AND ? <= d.position_u + dt.height_u - 1 LIMIT 1`)
    .get(rackId, excludeDeviceId, excludeDeviceId, top, positionU) as { code: string } | undefined;
  if (clash) throw badRequest(`Overlaps ${clash.code} in rack ${rack.code}`);
}

const createBody = z.object({
  device_type_id: z.number().int().positive(),
  code: codeSchema,
  name: textSchema,
  position_u: z.number().int().min(1),
  serial: textSchema, ip_address: textSchema, notes: textSchema,
});

devicesRouter.post('/racks/:id/devices', edit, (req, res) => {
  const rackId = idParam(req);
  const b = parse(createBody, req.body);
  const type = db.prepare('SELECT * FROM device_types WHERE id = ?').get(b.device_type_id) as { height_u: number; passthrough: number; name: string } | undefined;
  if (!type) throw notFound('Device type not found');
  checkPlacement(rackId, b.position_u, type.height_u, null);
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO devices (rack_id, device_type_id, code, name, position_u, serial, ip_address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(rackId, b.device_type_id, b.code, b.name, b.position_u, b.serial, b.ip_address, b.notes);
    const deviceId = Number(r.lastInsertRowid);
    const tports = db.prepare('SELECT name, kind, face, sort FROM device_type_ports WHERE device_type_id = ? ORDER BY sort').all(b.device_type_id) as { name: string; kind: string; face: string; sort: number }[];
    const ins = db.prepare('INSERT INTO ports (device_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)');
    const ids = new Map<string, number>();
    for (const p of tports) ids.set(`${p.face}:${p.name}`, Number(ins.run(deviceId, p.name, p.kind, p.face, p.sort).lastInsertRowid));
    if (type.passthrough) {
      const upd = db.prepare('UPDATE ports SET passthrough_port_id = ? WHERE id = ?');
      for (const p of tports) {
        if (p.face !== 'front') continue;
        const rear = ids.get(`rear:${p.name}`);
        const front = ids.get(`front:${p.name}`);
        if (rear && front) { upd.run(rear, front); upd.run(front, rear); }
      }
    }
    return deviceId;
  });
  const id = tx();
  logActivity(req, 'create', 'device', id, b.code, { rack_id: rackId, type: type.name, position_u: b.position_u });
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(id));
});

const patchBody = createBody.omit({ device_type_id: true }).partial().extend({ rack_id: z.number().int().positive().optional() });

devicesRouter.patch('/devices/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchBody, req.body);
  const dev = db.prepare('SELECT d.*, dt.height_u FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.id = ?').get(id) as
    | { rack_id: number; position_u: number; height_u: number; code: string } | undefined;
  if (!dev) throw notFound('Device not found');
  const rackId = b.rack_id ?? dev.rack_id;
  const pos = b.position_u ?? dev.position_u;
  if (b.rack_id !== undefined || b.position_u !== undefined) checkPlacement(rackId, pos, dev.height_u, id);
  const fields: Record<string, unknown> = { ...b };
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE devices SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as { code: string };
  logActivity(req, b.rack_id !== undefined && b.rack_id !== dev.rack_id ? 'move' : 'update', 'device', id, row.code,
    { fields: keys, from_rack: dev.rack_id, to_rack: rackId, from_u: dev.position_u, to_u: pos });
  res.json(row);
});

devicesRouter.delete('/devices/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code, rack_id FROM devices WHERE id = ?').get(id) as { code: string; rack_id: number } | undefined;
  if (!row) throw notFound('Device not found');
  const conns = (db.prepare(`SELECT COUNT(*) AS c FROM connections c JOIN ports p ON p.id = c.port_a_id OR p.id = c.port_b_id WHERE p.device_id = ?`).get(id) as { c: number }).c;
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  logActivity(req, 'delete', 'device', id, row.code, { rack_id: row.rack_id, connections_removed: conns });
  res.json({ ok: true });
});

devicesRouter.get('/devices/:id', (req, res) => {
  const id = idParam(req);
  const dev = db.prepare(`SELECT d.*, dt.name AS type_name, dt.category, dt.height_u, dt.color, dt.passthrough, r.code AS rack_code, s.code AS site_code, s.id AS site_id
    FROM devices d JOIN device_types dt ON dt.id = d.device_type_id JOIN racks r ON r.id = d.rack_id
    JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id WHERE d.id = ?`).get(id);
  if (!dev) throw notFound('Device not found');
  res.json(dev);
});

// ---------- Ports ----------
devicesRouter.patch('/ports/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    name: z.string().trim().min(1).max(32).transform((s) => s.toUpperCase()).optional(),
    vlan_id: z.number().int().positive().nullable().optional(),
    notes: textSchema.optional(),
  }), req.body);
  const port = db.prepare(`SELECT p.*, d.code AS device_code, s.id AS site_id FROM ports p JOIN devices d ON d.id = p.device_id JOIN racks r ON r.id = d.rack_id
    JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id WHERE p.id = ?`).get(id) as
    | { name: string; device_code: string; site_id: number } | undefined;
  if (!port) throw notFound('Port not found');
  if (b.vlan_id) {
    const v = db.prepare('SELECT site_id FROM vlans WHERE id = ?').get(b.vlan_id) as { site_id: number } | undefined;
    if (!v) throw notFound('VLAN not found');
    if (v.site_id !== port.site_id) throw badRequest('VLAN belongs to a different site');
  }
  const fields: Record<string, unknown> = { ...b };
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE ports SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  logActivity(req, 'update', 'port', id, `${port.device_code}:${port.name}`, { fields: keys, vlan_id: b.vlan_id });
  res.json(db.prepare('SELECT * FROM ports WHERE id = ?').get(id));
});

devicesRouter.get('/ports/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toUpperCase();
  const rackId = req.query.rack_id ? Number(req.query.rack_id) : null;
  const rows = db.prepare(`SELECT p.id, p.name, p.kind, p.face, d.id AS device_id, d.code AS device_code, d.name AS device_name, dt.name AS type_name,
      r.id AS rack_id, r.code AS rack_code, s.id AS site_id, s.code AS site_code,
      EXISTS (SELECT 1 FROM connections c WHERE c.port_a_id = p.id OR c.port_b_id = p.id) AS connected
    FROM ports p JOIN devices d ON d.id = p.device_id JOIN device_types dt ON dt.id = d.device_type_id JOIN racks r ON r.id = d.rack_id
    JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    WHERE (? = '' OR UPPER(d.code || ':' || p.name) LIKE '%' || ? || '%' OR UPPER(s.code || '/' || r.code || '/' || d.code) LIKE '%' || ? || '%' OR UPPER(d.name) LIKE '%' || ? || '%')
      AND (? IS NULL OR r.id = ?)
    ORDER BY (r.id = ?) DESC, s.code, r.code, d.position_u DESC, p.face, p.sort LIMIT 200`).all(q, q, q, q, rackId, rackId, rackId);
  res.json(rows);
});

devicesRouter.get('/ports/:id/trace', (req, res) => {
  res.json(tracePort(idParam(req)));
});
