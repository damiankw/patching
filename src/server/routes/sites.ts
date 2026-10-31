import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { notFound, badRequest } from '../errors.js';
import { codeSchema, idParam, nameSchema, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { getRackDetail } from '../rackDetail.js';

export const sitesRouter = Router();
sitesRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

// ---------- Sites ----------
sitesRouter.get('/sites', (_req, res) => {
  res.json(db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM floors f WHERE f.site_id = s.id) AS floor_count,
      (SELECT COUNT(*) FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id WHERE f.site_id = s.id) AS rack_count,
      (SELECT COUNT(*) FROM devices d JOIN racks r ON r.id = d.rack_id JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id WHERE f.site_id = s.id) AS device_count
    FROM sites s ORDER BY s.code`).all());
});

const siteBody = z.object({ code: codeSchema, name: nameSchema, address: textSchema, notes: textSchema });

sitesRouter.post('/sites', edit, (req, res) => {
  const b = parse(siteBody, req.body);
  const r = db.prepare('INSERT INTO sites (code, name, address, notes) VALUES (?, ?, ?, ?)').run(b.code, b.name, b.address, b.notes);
  logActivity(req, 'create', 'site', Number(r.lastInsertRowid), b.code);
  res.status(201).json(db.prepare('SELECT * FROM sites WHERE id = ?').get(r.lastInsertRowid));
});

sitesRouter.get('/sites/:id', (req, res) => {
  const id = idParam(req);
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!site) throw notFound('Site not found');
  const floors = db.prepare('SELECT * FROM floors WHERE site_id = ? ORDER BY sort, code').all(id) as { id: number }[];
  const rooms = db.prepare('SELECT ro.* FROM rooms ro JOIN floors f ON f.id = ro.floor_id WHERE f.site_id = ? ORDER BY ro.code').all(id) as { id: number; floor_id: number }[];
  const racks = db.prepare(`SELECT r.*,
      (SELECT COUNT(*) FROM devices d WHERE d.rack_id = r.id) AS device_count,
      (SELECT COALESCE(SUM(dt.height_u),0) FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = r.id) AS used_u
    FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id WHERE f.site_id = ? ORDER BY r.code`).all(id) as { room_id: number }[];
  res.json({
    ...site,
    floors: floors.map((f) => ({
      ...f,
      rooms: rooms.filter((r) => r.floor_id === f.id).map((r) => ({ ...r, racks: racks.filter((k) => k.room_id === r.id) })),
    })),
  });
});

sitesRouter.patch('/sites/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(siteBody.partial(), req.body);
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id)) throw notFound('Site not found');
  updateRow('sites', id, b);
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as { code: string };
  logActivity(req, 'update', 'site', id, row.code, { fields: Object.keys(b) });
  res.json(row);
});

sitesRouter.delete('/sites/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code FROM sites WHERE id = ?').get(id) as { code: string } | undefined;
  if (!row) throw notFound('Site not found');
  db.prepare('DELETE FROM sites WHERE id = ?').run(id);
  logActivity(req, 'delete', 'site', id, row.code);
  res.json({ ok: true });
});

// ---------- Floors ----------
const floorBody = z.object({ code: codeSchema, name: nameSchema, sort: z.number().int().default(0) });

sitesRouter.post('/sites/:id/floors', edit, (req, res) => {
  const siteId = idParam(req);
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) throw notFound('Site not found');
  const b = parse(floorBody, req.body);
  const r = db.prepare('INSERT INTO floors (site_id, code, name, sort) VALUES (?, ?, ?, ?)').run(siteId, b.code, b.name, b.sort);
  logActivity(req, 'create', 'floor', Number(r.lastInsertRowid), b.code, { site_id: siteId });
  res.status(201).json(db.prepare('SELECT * FROM floors WHERE id = ?').get(r.lastInsertRowid));
});

sitesRouter.patch('/floors/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(floorBody.partial(), req.body);
  if (!db.prepare('SELECT 1 FROM floors WHERE id = ?').get(id)) throw notFound('Floor not found');
  updateRow('floors', id, b);
  const row = db.prepare('SELECT * FROM floors WHERE id = ?').get(id) as { code: string };
  logActivity(req, 'update', 'floor', id, row.code, { fields: Object.keys(b) });
  res.json(row);
});

sitesRouter.delete('/floors/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code FROM floors WHERE id = ?').get(id) as { code: string } | undefined;
  if (!row) throw notFound('Floor not found');
  db.prepare('DELETE FROM floors WHERE id = ?').run(id);
  logActivity(req, 'delete', 'floor', id, row.code);
  res.json({ ok: true });
});

// ---------- Rooms ----------
const roomBody = z.object({ code: codeSchema, name: nameSchema, notes: textSchema });

sitesRouter.post('/floors/:id/rooms', edit, (req, res) => {
  const floorId = idParam(req);
  if (!db.prepare('SELECT 1 FROM floors WHERE id = ?').get(floorId)) throw notFound('Floor not found');
  const b = parse(roomBody, req.body);
  const r = db.prepare('INSERT INTO rooms (floor_id, code, name, notes) VALUES (?, ?, ?, ?)').run(floorId, b.code, b.name, b.notes);
  logActivity(req, 'create', 'room', Number(r.lastInsertRowid), b.code, { floor_id: floorId });
  res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(r.lastInsertRowid));
});

sitesRouter.patch('/rooms/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(roomBody.partial(), req.body);
  if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) throw notFound('Room not found');
  updateRow('rooms', id, b);
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as { code: string };
  logActivity(req, 'update', 'room', id, row.code, { fields: Object.keys(b) });
  res.json(row);
});

sitesRouter.delete('/rooms/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code FROM rooms WHERE id = ?').get(id) as { code: string } | undefined;
  if (!row) throw notFound('Room not found');
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  logActivity(req, 'delete', 'room', id, row.code);
  res.json({ ok: true });
});

// ---------- Racks ----------
const rackBody = z.object({ code: codeSchema, name: textSchema, height_u: z.number().int().min(1).max(60).default(42), notes: textSchema });

sitesRouter.get('/racks', (_req, res) => {
  res.json(db.prepare(`SELECT r.id, r.code, r.name, r.height_u, r.room_id,
      ro.code AS room_code, f.id AS floor_id, f.code AS floor_code, s.id AS site_id, s.code AS site_code, s.name AS site_name,
      (SELECT COUNT(*) FROM devices d WHERE d.rack_id = r.id) AS device_count,
      (SELECT COALESCE(SUM(dt.height_u),0) FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = r.id) AS used_u
    FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    ORDER BY s.code, f.sort, f.code, ro.code, r.code`).all());
});

sitesRouter.post('/rooms/:id/racks', edit, (req, res) => {
  const roomId = idParam(req);
  if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId)) throw notFound('Room not found');
  const b = parse(rackBody, req.body);
  const r = db.prepare('INSERT INTO racks (room_id, code, name, height_u, notes) VALUES (?, ?, ?, ?, ?)').run(roomId, b.code, b.name, b.height_u, b.notes);
  logActivity(req, 'create', 'rack', Number(r.lastInsertRowid), b.code, { room_id: roomId, height_u: b.height_u });
  res.status(201).json(db.prepare('SELECT * FROM racks WHERE id = ?').get(r.lastInsertRowid));
});

sitesRouter.get('/racks/:id', (req, res) => {
  res.json(getRackDetail(idParam(req)));
});

sitesRouter.patch('/racks/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(rackBody.partial().extend({ room_id: z.number().int().positive().optional() }), req.body);
  if (!db.prepare('SELECT 1 FROM racks WHERE id = ?').get(id)) throw notFound('Rack not found');
  if (b.height_u !== undefined) {
    const top = db.prepare(`SELECT MAX(d.position_u + dt.height_u - 1) AS top FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = ?`).get(id) as { top: number | null };
    if (top.top && top.top > b.height_u) throw badRequest(`A device occupies U${top.top}; rack cannot be shorter than that`);
  }
  if (b.room_id !== undefined && !db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(b.room_id)) throw notFound('Target room not found');
  updateRow('racks', id, b);
  const row = db.prepare('SELECT * FROM racks WHERE id = ?').get(id) as { code: string };
  logActivity(req, 'update', 'rack', id, row.code, { fields: Object.keys(b) });
  res.json(row);
});

sitesRouter.delete('/racks/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code FROM racks WHERE id = ?').get(id) as { code: string } | undefined;
  if (!row) throw notFound('Rack not found');
  db.prepare('DELETE FROM racks WHERE id = ?').run(id);
  logActivity(req, 'delete', 'rack', id, row.code);
  res.json({ ok: true });
});

function updateRow(table: string, id: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}
