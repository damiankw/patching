import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';

export const deviceTypesRouter = Router();
deviceTypesRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

export const CATEGORIES = ['switch', 'router', 'firewall', 'patch_panel', 'server', 'storage', 'pdu', 'ups', 'other'] as const;
export const PORT_KINDS = ['rj45', 'sfp', 'sfp+', 'qsfp', 'lc', 'sc', 'mpo', 'console', 'usb', 'power_in', 'power_out', 'other'] as const;

const portSchema = z.object({
  name: z.string().trim().min(1).max(32).transform((s) => s.toUpperCase()),
  kind: z.enum(PORT_KINDS),
  face: z.enum(['front', 'rear']),
});
const typeBody = z.object({
  name: z.string().trim().min(1).max(100),
  manufacturer: textSchema, model: textSchema,
  category: z.enum(CATEGORIES),
  height_u: z.number().int().min(1).max(50),
  passthrough: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4b5563'),
  ports: z.array(portSchema).max(500).default([]),
});

function withPorts(id: number) {
  const t = db.prepare(`SELECT dt.*, (SELECT COUNT(*) FROM devices d WHERE d.device_type_id = dt.id) AS device_count FROM device_types dt WHERE dt.id = ?`).get(id);
  if (!t) throw notFound('Device type not found');
  const ports = db.prepare('SELECT id, name, kind, face, sort FROM device_type_ports WHERE device_type_id = ? ORDER BY sort').all(id);
  return { ...t, ports };
}

deviceTypesRouter.get('/', (_req, res) => {
  const types = db.prepare(`SELECT dt.*, (SELECT COUNT(*) FROM device_type_ports p WHERE p.device_type_id = dt.id) AS port_count,
    (SELECT COUNT(*) FROM devices d WHERE d.device_type_id = dt.id) AS device_count FROM device_types dt ORDER BY dt.category, dt.name`).all();
  res.json(types);
});

deviceTypesRouter.get('/meta', (_req, res) => res.json({ categories: CATEGORIES, portKinds: PORT_KINDS }));
deviceTypesRouter.get('/:id', (req, res) => res.json(withPorts(idParam(req))));

function checkPorts(ports: z.infer<typeof portSchema>[]) {
  const seen = new Set<string>();
  for (const p of ports) {
    const k = `${p.face}:${p.name}`;
    if (seen.has(k)) throw badRequest(`Duplicate ${p.face} port name ${p.name}`);
    seen.add(k);
  }
}

deviceTypesRouter.post('/', edit, (req, res) => {
  const b = parse(typeBody, req.body);
  checkPorts(b.ports);
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO device_types (name, manufacturer, model, category, height_u, passthrough, color, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
      .run(b.name, b.manufacturer, b.model, b.category, b.height_u, b.passthrough ? 1 : 0, b.color);
    const ins = db.prepare('INSERT INTO device_type_ports (device_type_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)');
    b.ports.forEach((p, i) => ins.run(r.lastInsertRowid, p.name, p.kind, p.face, i));
    return Number(r.lastInsertRowid);
  });
  const id = tx();
  logActivity(req, 'create', 'device_type', id, b.name, { ports: b.ports.length });
  res.status(201).json(withPorts(id));
});

deviceTypesRouter.put('/:id', edit, (req, res) => {
  const id = idParam(req);
  const existing = db.prepare('SELECT * FROM device_types WHERE id = ?').get(id) as { name: string } | undefined;
  if (!existing) throw notFound('Device type not found');
  const b = parse(typeBody, req.body);
  checkPorts(b.ports);
  const inUse = (db.prepare('SELECT COUNT(*) AS c FROM devices WHERE device_type_id = ?').get(id) as { c: number }).c;
  if (inUse > 0) {
    const top = db.prepare(`SELECT d.code, r.code AS rack_code, d.position_u, r.height_u FROM devices d JOIN racks r ON r.id = d.rack_id WHERE d.device_type_id = ? AND d.position_u + ? - 1 > r.height_u LIMIT 1`).get(id, b.height_u) as { code: string; rack_code: string } | undefined;
    if (top) throw badRequest(`Height change would push ${top.code} in rack ${top.rack_code} past the top`);
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE device_types SET name = ?, manufacturer = ?, model = ?, category = ?, height_u = ?, passthrough = ?, color = ? WHERE id = ?`)
      .run(b.name, b.manufacturer, b.model, b.category, b.height_u, b.passthrough ? 1 : 0, b.color, id);
    db.prepare('DELETE FROM device_type_ports WHERE device_type_id = ?').run(id);
    const ins = db.prepare('INSERT INTO device_type_ports (device_type_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)');
    b.ports.forEach((p, i) => ins.run(id, p.name, p.kind, p.face, i));
    if (inUse > 0 && b.height_u !== undefined) {
      // Verify no overlaps were introduced by a height change
      const overlap = db.prepare(`SELECT d1.code, r.code AS rack_code FROM devices d1
        JOIN device_types t1 ON t1.id = d1.device_type_id JOIN racks r ON r.id = d1.rack_id
        JOIN devices d2 ON d2.rack_id = d1.rack_id AND d2.id <> d1.id JOIN device_types t2 ON t2.id = d2.device_type_id
        WHERE d1.device_type_id = ? AND d1.position_u <= d2.position_u + t2.height_u - 1 AND d2.position_u <= d1.position_u + t1.height_u - 1 LIMIT 1`).get(id) as { code: string; rack_code: string } | undefined;
      if (overlap) throw badRequest(`Height change would make ${overlap.code} overlap another device in rack ${overlap.rack_code}`);
    }
  });
  tx();
  logActivity(req, 'update', 'device_type', id, b.name, { ports: b.ports.length, devices_in_use: inUse });
  res.json(withPorts(id));
});

deviceTypesRouter.delete('/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT name FROM device_types WHERE id = ?').get(id) as { name: string } | undefined;
  if (!row) throw notFound('Device type not found');
  const inUse = (db.prepare('SELECT COUNT(*) AS c FROM devices WHERE device_type_id = ?').get(id) as { c: number }).c;
  if (inUse > 0) throw badRequest(`Device type is used by ${inUse} device(s)`);
  db.prepare('DELETE FROM device_types WHERE id = ?').run(id);
  logActivity(req, 'delete', 'device_type', id, row.name);
  res.json({ ok: true });
});
