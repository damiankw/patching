import { Router, raw } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { codeSchema, idParam, nameSchema, parse, patchOf, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { DEVICE_COLS, DEVICE_JOIN, connectionOfPort, getPort, peerOf, portState, roomForPoint, tracePort, updateRow, type DeviceRow, type Pt } from '../model.js';

export const locationsRouter = Router();
locationsRouter.use(requireRole('viewer'));
const edit = requireRole('editor');
const userId = z.number().int().positive().nullable().optional();

const LOC_SQL = `SELECT l.*, u.name AS responsible_name,
    (SELECT COUNT(*) FROM floors f WHERE f.location_id = l.id) AS floor_count,
    (SELECT COUNT(*) FROM rooms r JOIN floors f ON f.id = r.floor_id WHERE f.location_id = l.id) AS room_count,
    (SELECT COUNT(*) FROM devices d JOIN floors f ON f.id = d.floor_id WHERE f.location_id = l.id) AS device_count,
    (SELECT COUNT(*) FROM devices d JOIN device_types dt ON dt.id = d.device_type_id JOIN floors f ON f.id = d.floor_id WHERE f.location_id = l.id AND dt.is_rack = 1) AS rack_count
  FROM locations l LEFT JOIN users u ON u.id = l.responsible_user_id`;

locationsRouter.get('/locations', (_req, res) => res.json(db.prepare(`${LOC_SQL} ORDER BY l.code`).all()));

const locBody = z.object({ code: codeSchema, name: nameSchema, address: textSchema, lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), responsible_user_id: userId, contact: textSchema, notes: textSchema });

locationsRouter.post('/locations', edit, (req, res) => {
  const b = parse(locBody, req.body);
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO locations (code, name, address, lat, lng, responsible_user_id, contact, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(b.code, b.name, b.address, b.lat ?? null, b.lng ?? null, b.responsible_user_id ?? null, b.contact, b.notes).lastInsertRowid;
    db.prepare("INSERT INTO floors (location_id, code, name, level) VALUES (?, '0', 'Ground Floor', 0)").run(r);
    return r;
  })();
  logActivity(req, 'create', 'location', id, b.code);
  res.status(201).json(db.prepare(`${LOC_SQL} WHERE l.id = ?`).get(id));
});
locationsRouter.get('/locations/:id', (req, res) => {
  const id = idParam(req);
  const loc = db.prepare(`${LOC_SQL} WHERE l.id = ?`).get(id);
  if (!loc) throw notFound('Location not found');
  const floors = db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM rooms r WHERE r.floor_id = f.id) AS room_count, (SELECT COUNT(*) FROM devices d WHERE d.floor_id = f.id) AS device_count FROM floors f WHERE f.location_id = ? ORDER BY f.level, f.code`).all(id);
  res.json({ ...loc, floors });
});
locationsRouter.patch('/locations/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchOf(locBody), req.body);
  const row = db.prepare('SELECT code FROM locations WHERE id = ?').get<{ code: string }>(id);
  if (!row) throw notFound('Location not found');
  updateRow('locations', id, b);
  logActivity(req, 'update', 'location', id, b.code ?? row.code, { fields: Object.keys(b) });
  res.json(db.prepare(`${LOC_SQL} WHERE l.id = ?`).get(id));
});
locationsRouter.delete('/locations/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT code FROM locations WHERE id = ?').get<{ code: string }>(id);
  if (!row) throw notFound('Location not found');
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  logActivity(req, 'delete', 'location', id, row.code);
  res.json({ ok: true });
});

/** Address lookup through OpenStreetMap Nominatim. Fails soft when offline. */
locationsRouter.get('/geocode', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'rackdocs/1.0 (self-hosted network documentation)' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return res.json([]);
    const rows = (await r.json()) as { display_name: string; lat: string; lon: string }[];
    res.json(rows.map((x) => ({ address: x.display_name, lat: Number(x.lat), lng: Number(x.lon) })));
  } catch { res.json([]); }
});

// ---------- Floors ----------
const floorBody = z.object({ code: codeSchema, name: textSchema, level: z.number().int().default(0), responsible_user_id: userId, notes: textSchema,
  plan_opacity: z.number().int().min(0).max(100).optional(), plan_contrast: z.number().int().min(0).max(200).optional(), plan_scale: z.number().positive().nullable().optional(),
  plan_w: z.number().int().positive().optional(), plan_h: z.number().int().positive().optional() });

locationsRouter.post('/locations/:id/floors', edit, (req, res) => {
  const locId = idParam(req);
  const loc = db.prepare('SELECT code FROM locations WHERE id = ?').get<{ code: string }>(locId);
  if (!loc) throw notFound('Location not found');
  const b = parse(floorBody, req.body);
  const id = db.prepare('INSERT INTO floors (location_id, code, name, level, responsible_user_id, notes) VALUES (?, ?, ?, ?, ?, ?)').run(locId, b.code, b.name, b.level, b.responsible_user_id ?? null, b.notes).lastInsertRowid;
  logActivity(req, 'create', 'floor', id, `${loc.code}/${b.code}`);
  res.status(201).json(db.prepare('SELECT * FROM floors WHERE id = ?').get(id));
});
function floorLabel(id: number) {
  const r = db.prepare('SELECT l.code AS lc, f.code AS fc FROM floors f JOIN locations l ON l.id = f.location_id WHERE f.id = ?').get<{ lc: string; fc: string }>(id);
  if (!r) throw notFound('Floor not found');
  return `${r.lc}/${r.fc}`;
}
locationsRouter.patch('/floors/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchOf(floorBody), req.body);
  const label = floorLabel(id);
  updateRow('floors', id, b);
  logActivity(req, 'update', 'floor', id, label, { fields: Object.keys(b) });
  res.json(db.prepare('SELECT * FROM floors WHERE id = ?').get(id));
});
locationsRouter.delete('/floors/:id', edit, (req, res) => {
  const id = idParam(req);
  const label = floorLabel(id);
  db.prepare('DELETE FROM floors WHERE id = ?').run(id);
  logActivity(req, 'delete', 'floor', id, label);
  res.json({ ok: true });
});

/** Upload a floor plan image (raw body). Query: w, h (pixel size measured by the browser), name. */
locationsRouter.post('/floors/:id/plan', edit, raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '30mb' }), (req, res) => {
  const id = idParam(req);
  const label = floorLabel(id);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Send the image as the request body with an image/* content type');
  const w = Number(req.query.w), h = Number(req.query.h);
  if (!(w > 0 && h > 0)) throw badRequest('Image dimensions required');
  const mime = req.headers['content-type'] as string;
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const uuid = crypto.randomUUID();
  fs.writeFileSync(path.join(UPLOAD_DIR, `${uuid}.${ext}`), body);
  const fileId = db.prepare('INSERT INTO files (uuid, name, mime, size) VALUES (?, ?, ?, ?)').run(`${uuid}.${ext}`, String(req.query.name ?? 'floor-plan'), mime, body.length).lastInsertRowid;
  const old = db.prepare('SELECT plan_file_id FROM floors WHERE id = ?').get<{ plan_file_id: number | null }>(id)!;
  db.prepare("UPDATE floors SET plan_file_id = ?, plan_w = ?, plan_h = ?, plan_scale = NULL, updated_at = datetime('now') WHERE id = ?").run(fileId, Math.round(w), Math.round(h), id);
  if (old.plan_file_id) deleteFile(old.plan_file_id);
  logActivity(req, 'update', 'floor', id, label, { floor_plan: 'uploaded', w, h });
  res.json(db.prepare('SELECT * FROM floors WHERE id = ?').get(id));
});
locationsRouter.delete('/floors/:id/plan', edit, (req, res) => {
  const id = idParam(req);
  const label = floorLabel(id);
  const old = db.prepare('SELECT plan_file_id FROM floors WHERE id = ?').get<{ plan_file_id: number | null }>(id)!;
  db.prepare("UPDATE floors SET plan_file_id = NULL, plan_scale = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
  if (old.plan_file_id) deleteFile(old.plan_file_id);
  logActivity(req, 'update', 'floor', id, label, { floor_plan: 'removed' });
  res.json({ ok: true });
});
export function deleteFile(fileId: number) {
  const f = db.prepare('SELECT uuid FROM files WHERE id = ?').get<{ uuid: string }>(fileId);
  if (f) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.uuid)); } catch { /* ignore */ } db.prepare('DELETE FROM files WHERE id = ?').run(fileId); }
}

/** Everything the Location View needs for one floor. */
locationsRouter.get('/floors/:id/view', (req, res) => {
  const id = idParam(req);
  const floor = db.prepare(`SELECT f.*, fi.uuid AS plan_uuid, u.name AS responsible_name, l.code AS location_code, l.name AS location_name
    FROM floors f LEFT JOIN files fi ON fi.id = f.plan_file_id LEFT JOIN users u ON u.id = f.responsible_user_id JOIN locations l ON l.id = f.location_id WHERE f.id = ?`).get<Record<string, unknown>>(id);
  if (!floor) throw notFound('Floor not found');
  const floors = db.prepare('SELECT id, code, name, level FROM floors WHERE location_id = ? ORDER BY level, code').all(floor.location_id as number);
  const rooms = db.prepare('SELECT r.*, u.name AS responsible_name, (SELECT COUNT(*) FROM devices d WHERE d.room_id = r.id AND d.rack_id IS NULL) AS device_count FROM rooms r LEFT JOIN users u ON u.id = r.responsible_user_id WHERE r.floor_id = ? ORDER BY r.code').all<{ id: number; points: string }>(id)
    .map((r) => ({ ...r, points: JSON.parse(r.points) as Pt[] }));
  const devices = db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_JOIN} WHERE d.floor_id = ? AND d.rack_id IS NULL ORDER BY d.code`).all<DeviceRow>(id);
  const devOut = devices.map((d) => {
    const ports = db.prepare('SELECT id, name, kind, face, wireless_mode FROM ports WHERE device_id = ? ORDER BY sort, name').all<{ id: number; name: string; kind: string; face: string; wireless_mode: string | null }>(d.id);
    const states = ports.map((p) => portState(p.id));
    const rackChildren = d.is_rack ? db.prepare('SELECT COUNT(*) AS c FROM devices WHERE rack_id = ?').get<{ c: number }>(d.id)!.c : 0;
    return { ...d, port_count: ports.length, connected_ports: states.filter((s) => s.state !== 'none').length, ports: ports.map((p, i) => ({ ...p, ...states[i] })), rack_device_count: rackChildren };
  });
  // Connections touching this floor (including those of rack-mounted devices, drawn at the rack's position)
  const conns = db.prepare(`SELECT c.* FROM connections c JOIN ports pa ON pa.id = c.port_a_id JOIN ports pb ON pb.id = c.port_b_id
    JOIN devices da ON da.id = pa.device_id JOIN devices db2 ON db2.id = pb.device_id WHERE da.floor_id = ? OR db2.floor_id = ? ORDER BY c.id`).all<{ id: number; port_a_id: number; port_b_id: number; type: string; color: string; label: string }>(id, id);
  const seenChains = new Set<string>();
  const connOut = conns.map((c) => {
    const a = getPort(c.port_a_id); const b = getPort(c.port_b_id);
    const pos = (p: typeof a) => p.rack_id ? { x: p.rack_x ?? 0, y: p.rack_y ?? 0, anchor_id: p.rack_id } : { x: p.x, y: p.y, anchor_id: p.device_id };
    const t = tracePort(c.port_a_id);
    const chainKey = t.steps.map((s) => s.port.id).sort((x, y) => x - y).join('-');
    const first = !seenChains.has(chainKey); seenChains.add(chainKey);
    return {
      id: c.id, type: c.type, color: c.color, label: c.label,
      a: { port_id: a.id, path: a.path, device_id: a.device_id, floor_id: a.floor_id, ...pos(a) },
      b: { port_id: b.id, path: b.path, device_id: b.device_id, floor_id: b.floor_id, ...pos(b) },
      on_floor: a.floor_id === id && b.floor_id === id,
      chain: first ? { from: t.steps[0].port.path, to: t.steps[t.steps.length - 1].port.path, via: t.steps.slice(1, -1).map((s) => s.port.path), complete: t.complete, color: t.color } : null,
    };
  });
  res.json({ floor, floors, rooms, devices: devOut, connections: connOut });
});

// ---------- Rooms ----------
const pointsSchema = z.array(z.tuple([z.number(), z.number()])).min(3).max(200);
const roomBody = z.object({ code: codeSchema, name: textSchema, points: pointsSchema, responsible_user_id: userId, notes: textSchema });
locationsRouter.post('/floors/:id/rooms', edit, (req, res) => {
  const floorId = idParam(req);
  const label = floorLabel(floorId);
  const b = parse(roomBody, req.body);
  const id = db.prepare('INSERT INTO rooms (floor_id, code, name, points, responsible_user_id, notes) VALUES (?, ?, ?, ?, ?, ?)').run(floorId, b.code, b.name, JSON.stringify(b.points), b.responsible_user_id ?? null, b.notes).lastInsertRowid;
  // Adopt devices that sit inside the new room and were in DEFAULT
  const adopted = db.prepare('SELECT id, x, y FROM devices WHERE floor_id = ? AND rack_id IS NULL AND room_id IS NULL').all<{ id: number; x: number; y: number }>(floorId)
    .filter((d) => roomForPoint(floorId, d.x, d.y) === id);
  for (const d of adopted) db.prepare('UPDATE devices SET room_id = ? WHERE id = ? OR rack_id = ?').run(id, d.id, d.id);
  logActivity(req, 'create', 'room', id, `${label}/${b.code}`, { adopted_devices: adopted.length });
  res.status(201).json({ ...db.prepare('SELECT * FROM rooms WHERE id = ?').get<{ points: string }>(id)!, points: b.points, adopted: adopted.length });
});
locationsRouter.patch('/rooms/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchOf(roomBody), req.body);
  const room = db.prepare('SELECT r.*, l.code AS lc, f.code AS fc FROM rooms r JOIN floors f ON f.id = r.floor_id JOIN locations l ON l.id = f.location_id WHERE r.id = ?').get<{ floor_id: number; code: string; lc: string; fc: string }>(id);
  if (!room) throw notFound('Room not found');
  updateRow('rooms', id, { ...b, points: b.points ? JSON.stringify(b.points) : undefined });
  logActivity(req, 'update', 'room', id, `${room.lc}/${room.fc}/${b.code ?? room.code}`, { fields: Object.keys(b) });
  const out = db.prepare('SELECT * FROM rooms WHERE id = ?').get<{ points: string }>(id)!;
  res.json({ ...out, points: JSON.parse(out.points) });
});
locationsRouter.delete('/rooms/:id', edit, (req, res) => {
  const id = idParam(req);
  const room = db.prepare('SELECT r.code, l.code AS lc, f.code AS fc FROM rooms r JOIN floors f ON f.id = r.floor_id JOIN locations l ON l.id = f.location_id WHERE r.id = ?').get<{ code: string; lc: string; fc: string }>(id);
  if (!room) throw notFound('Room not found');
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id); // devices fall back to DEFAULT via ON DELETE SET NULL
  logActivity(req, 'delete', 'room', id, `${room.lc}/${room.fc}/${room.code}`);
  res.json({ ok: true });
});
/** Which room a point belongs to (used when dropping devices). */
locationsRouter.get('/floors/:id/room-at', (req, res) => {
  const id = idParam(req);
  const x = Number(req.query.x), y = Number(req.query.y);
  res.json({ room_id: roomForPoint(id, x, y) });
});
void connectionOfPort; void peerOf;
