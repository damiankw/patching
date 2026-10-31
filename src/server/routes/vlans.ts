import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { notFound } from '../errors.js';
import { idParam, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';

export const vlansRouter = Router();
vlansRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

const body = z.object({ vid: z.number().int().min(1).max(4094), name: z.string().trim().min(1).max(100), description: textSchema });

vlansRouter.get('/sites/:id/vlans', (req, res) => {
  const siteId = idParam(req);
  res.json(db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM ports p WHERE p.vlan_id = v.id) AS port_count FROM vlans v WHERE v.site_id = ? ORDER BY v.vid`).all(siteId));
});

vlansRouter.get('/vlans/:id/ports', (req, res) => {
  const id = idParam(req);
  res.json(db.prepare(`SELECT p.id, p.name, p.face, p.kind, d.id AS device_id, d.code AS device_code, r.id AS rack_id, r.code AS rack_code
    FROM ports p JOIN devices d ON d.id = p.device_id JOIN racks r ON r.id = d.rack_id WHERE p.vlan_id = ? ORDER BY r.code, d.code, p.sort`).all(id));
});

vlansRouter.post('/sites/:id/vlans', edit, (req, res) => {
  const siteId = idParam(req);
  if (!db.prepare('SELECT 1 FROM sites WHERE id = ?').get(siteId)) throw notFound('Site not found');
  const b = parse(body, req.body);
  const r = db.prepare('INSERT INTO vlans (site_id, vid, name, description) VALUES (?, ?, ?, ?)').run(siteId, b.vid, b.name, b.description);
  logActivity(req, 'create', 'vlan', Number(r.lastInsertRowid), `VLAN ${b.vid} ${b.name}`, { site_id: siteId });
  res.status(201).json(db.prepare('SELECT * FROM vlans WHERE id = ?').get(r.lastInsertRowid));
});

vlansRouter.patch('/vlans/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(body.partial(), req.body);
  if (!db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(id)) throw notFound('VLAN not found');
  const fields: Record<string, unknown> = { ...b };
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE vlans SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
  const row = db.prepare('SELECT * FROM vlans WHERE id = ?').get(id) as { vid: number; name: string };
  logActivity(req, 'update', 'vlan', id, `VLAN ${row.vid} ${row.name}`, { fields: keys });
  res.json(row);
});

vlansRouter.delete('/vlans/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT vid, name FROM vlans WHERE id = ?').get(id) as { vid: number; name: string } | undefined;
  if (!row) throw notFound('VLAN not found');
  db.prepare('DELETE FROM vlans WHERE id = ?').run(id);
  logActivity(req, 'delete', 'vlan', id, `VLAN ${row.vid} ${row.name}`);
  res.json({ ok: true });
});
