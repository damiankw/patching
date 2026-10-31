import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { getPort } from '../trace.js';

export const connectionsRouter = Router();
connectionsRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

const LIST_SQL = `SELECT c.*,
    pa.name AS a_port, pa.face AS a_face, pa.kind AS a_kind, da.id AS a_device_id, da.code AS a_device, ra.id AS a_rack_id, ra.code AS a_rack, sa.id AS a_site_id, sa.code AS a_site,
    pb.name AS b_port, pb.face AS b_face, pb.kind AS b_kind, db2.id AS b_device_id, db2.code AS b_device, rb.id AS b_rack_id, rb.code AS b_rack, sb.id AS b_site_id, sb.code AS b_site
  FROM connections c
  JOIN ports pa ON pa.id = c.port_a_id JOIN devices da ON da.id = pa.device_id JOIN racks ra ON ra.id = da.rack_id JOIN rooms roa ON roa.id = ra.room_id JOIN floors fa ON fa.id = roa.floor_id JOIN sites sa ON sa.id = fa.site_id
  JOIN ports pb ON pb.id = c.port_b_id JOIN devices db2 ON db2.id = pb.device_id JOIN racks rb ON rb.id = db2.rack_id JOIN rooms rob ON rob.id = rb.room_id JOIN floors fb ON fb.id = rob.floor_id JOIN sites sb ON sb.id = fb.site_id`;

connectionsRouter.get('/', (req, res) => {
  const rackId = req.query.rack_id ? Number(req.query.rack_id) : null;
  const siteId = req.query.site_id ? Number(req.query.site_id) : null;
  const q = String(req.query.q ?? '').trim().toUpperCase();
  const rows = db.prepare(`${LIST_SQL}
    WHERE (? IS NULL OR ra.id = ? OR rb.id = ?) AND (? IS NULL OR sa.id = ? OR sb.id = ?)
      AND (? = '' OR UPPER(da.code || ' ' || db2.code || ' ' || c.label || ' ' || ra.code || ' ' || rb.code || ' ' || c.cable_type) LIKE '%' || ? || '%')
    ORDER BY sa.code, ra.code, da.position_u DESC, pa.face, pa.sort LIMIT 2000`).all(rackId, rackId, rackId, siteId, siteId, siteId, q, q);
  res.json(rows);
});

const body = z.object({
  port_a_id: z.number().int().positive(),
  port_b_id: z.number().int().positive(),
  cable_type: textSchema, color: textSchema, label: textSchema, notes: textSchema,
  length_m: z.number().nonnegative().nullable().default(null),
});

function labelFor(portId: number) {
  const p = getPort(portId);
  return p ? `${p.site_code}/${p.rack_code}/${p.device_code}:${p.name}` : String(portId);
}

connectionsRouter.post('/', edit, (req, res) => {
  const b = parse(body, req.body);
  if (b.port_a_id === b.port_b_id) throw badRequest('A port cannot connect to itself');
  for (const pid of [b.port_a_id, b.port_b_id]) {
    if (!getPort(pid)) throw notFound(`Port ${pid} not found`);
    const used = db.prepare('SELECT id FROM connections WHERE port_a_id = ? OR port_b_id = ?').get(pid, pid);
    if (used) throw badRequest(`${labelFor(pid)} is already connected`);
  }
  const r = db.prepare(`INSERT INTO connections (port_a_id, port_b_id, cable_type, color, label, length_m, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(b.port_a_id, b.port_b_id, b.cable_type, b.color, b.label, b.length_m, b.notes);
  const id = Number(r.lastInsertRowid);
  logActivity(req, 'connect', 'connection', id, `${labelFor(b.port_a_id)} <-> ${labelFor(b.port_b_id)}`, { cable_type: b.cable_type, color: b.color, label: b.label });
  res.status(201).json(db.prepare(`${LIST_SQL} WHERE c.id = ?`).get(id));
});

connectionsRouter.patch('/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(body.omit({ port_a_id: true, port_b_id: true }).partial(), req.body);
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as { port_a_id: number; port_b_id: number } | undefined;
  if (!row) throw notFound('Connection not found');
  const fields: Record<string, unknown> = { ...b };
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE connections SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  logActivity(req, 'update', 'connection', id, `${labelFor(row.port_a_id)} <-> ${labelFor(row.port_b_id)}`, { fields: keys });
  res.json(db.prepare(`${LIST_SQL} WHERE c.id = ?`).get(id));
});

connectionsRouter.delete('/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as { port_a_id: number; port_b_id: number } | undefined;
  if (!row) throw notFound('Connection not found');
  const label = `${labelFor(row.port_a_id)} <-> ${labelFor(row.port_b_id)}`;
  db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  logActivity(req, 'disconnect', 'connection', id, label);
  res.json({ ok: true });
});
