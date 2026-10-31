import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { updateRow } from '../model.js';
import { PORT_KINDS } from './devices.js';

export const libraryRouter = Router();
libraryRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

export const ICONS = ['box', 'radio', 'cctv', 'monitor', 'square-dot', 'globe', 'laptop', 'phone', 'printer', 'server', 'tv', 'scan-face', 'cable', 'shield', 'ellipsis', 'route', 'hard-drive', 'usb', 'network', 'battery-charging', 'cpu', 'router', 'wifi', 'speaker', 'projector', 'gamepad-2', 'thermometer', 'lightbulb', 'lock', 'door-open', 'zap', 'satellite-dish', 'smartphone', 'tablet', 'video', 'mic', 'headphones', 'clock', 'bell', 'siren'] as const;
const portSchema = z.object({ name: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()), kind: z.enum(PORT_KINDS), face: z.enum(['front', 'rear']).default('front'), wireless_mode: z.enum(['client', 'broadcast']).nullable().optional() });

function typesOut() {
  const types = db.prepare(`SELECT dt.*, (SELECT COUNT(*) FROM devices d WHERE d.device_type_id = dt.id) AS device_count FROM device_types dt ORDER BY dt.kind, dt.is_builtin DESC, dt.sort, dt.name`).all<{ id: number }>();
  const ports = db.prepare('SELECT * FROM device_type_ports ORDER BY sort').all<{ device_type_id: number }>();
  return types.map((t) => ({ ...t, ports: ports.filter((p) => p.device_type_id === t.id) }));
}
libraryRouter.get('/device-types', (_req, res) => res.json(typesOut()));
libraryRouter.get('/library/meta', (_req, res) => res.json({ icons: ICONS, portKinds: PORT_KINDS }));

const typeBody = z.object({ name: z.string().trim().min(1).max(80), prefix: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()),
  kind: z.enum(['floor', 'rack']), icon: z.enum(ICONS).default('box'), passive: z.boolean().default(false), ports: z.array(portSchema).max(64).default([]) });
libraryRouter.post('/device-types', edit, (req, res) => {
  const b = parse(typeBody, req.body);
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO device_types (name, prefix, kind, icon, passive, is_rack, is_builtin, sort) VALUES (?, ?, ?, ?, ?, 0, 0, 100)').run(b.name, b.prefix, b.kind, b.icon, b.passive ? 1 : 0).lastInsertRowid;
    b.ports.forEach((p, i) => db.prepare('INSERT INTO device_type_ports (device_type_id, name, kind, face, wireless_mode, sort) VALUES (?, ?, ?, ?, ?, ?)').run(r, p.name, p.kind, p.face, p.wireless_mode ?? null, i));
    return r;
  })();
  logActivity(req, 'create', 'device_type', id, b.name, { prefix: b.prefix, kind: b.kind });
  res.status(201).json(typesOut().find((t) => t.id === id));
});
libraryRouter.patch('/device-types/:id', edit, (req, res) => {
  const id = idParam(req);
  const t = db.prepare('SELECT * FROM device_types WHERE id = ?').get<{ is_builtin: number; name: string }>(id);
  if (!t) throw notFound('Device type not found');
  const b = parse(typeBody.partial(), req.body);
  if (t.is_builtin) { delete b.kind; delete b.passive; }
  db.transaction(() => {
    updateRow('device_types', id, { name: b.name, prefix: b.prefix, icon: b.icon, kind: b.kind, passive: b.passive === undefined ? undefined : b.passive ? 1 : 0 }, false);
    if (b.ports) {
      db.prepare('DELETE FROM device_type_ports WHERE device_type_id = ?').run(id);
      b.ports.forEach((p, i) => db.prepare('INSERT INTO device_type_ports (device_type_id, name, kind, face, wireless_mode, sort) VALUES (?, ?, ?, ?, ?, ?)').run(id, p.name, p.kind, p.face, p.wireless_mode ?? null, i));
    }
  })();
  logActivity(req, 'update', 'device_type', id, b.name ?? t.name, { fields: Object.keys(b) });
  res.json(typesOut().find((x) => x.id === id));
});
/** Save prefixes for many types at once (the "Save changes" button). */
libraryRouter.put('/device-types/prefixes', edit, (req, res) => {
  const rows = parse(z.array(z.object({ id: z.number().int().positive(), prefix: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/).transform((s) => s.toUpperCase()) })), req.body);
  db.transaction(() => { for (const r of rows) db.prepare('UPDATE device_types SET prefix = ? WHERE id = ?').run(r.prefix, r.id); })();
  logActivity(req, 'update', 'device_type', null, 'prefixes', { count: rows.length });
  res.json(typesOut());
});
libraryRouter.delete('/device-types/:id', edit, (req, res) => {
  const id = idParam(req);
  const t = db.prepare('SELECT is_builtin, name, (SELECT COUNT(*) FROM devices d WHERE d.device_type_id = device_types.id) AS c FROM device_types WHERE id = ?').get<{ is_builtin: number; name: string; c: number }>(id);
  if (!t) throw notFound('Device type not found');
  if (t.is_builtin) throw badRequest('Built-in device types cannot be deleted');
  if (t.c > 0) throw badRequest(`${t.c} device(s) use this type`);
  db.prepare('DELETE FROM device_types WHERE id = ?').run(id);
  logActivity(req, 'delete', 'device_type', id, t.name);
  res.json({ ok: true });
});

// ---------- Rack device templates ----------
function templatesOut(id?: number) {
  const tpls = db.prepare(`SELECT t.*, dt.name AS type_name, dt.prefix, (SELECT COUNT(*) FROM devices d WHERE d.template_id = t.id) AS device_count FROM templates t JOIN device_types dt ON dt.id = t.device_type_id ${id ? 'WHERE t.id = ?' : ''} ORDER BY dt.sort, t.name`).all<{ id: number }>(...(id ? [id] : []));
  const ports = db.prepare('SELECT * FROM template_ports ORDER BY sort').all<{ template_id: number }>();
  return tpls.map((t) => ({ ...t, ports: ports.filter((p) => p.template_id === t.id) }));
}
libraryRouter.get('/templates', (_req, res) => res.json(templatesOut()));
const tplBody = z.object({ name: z.string().trim().min(1).max(100), device_type_id: z.number().int().positive(), brand: textSchema, model: textSchema, height_u: z.number().int().min(1).max(50), color: textSchema, ports: z.array(portSchema).max(500).default([]) });
function checkPorts(ports: z.infer<typeof portSchema>[]) { const s = new Set<string>(); for (const p of ports) { if (s.has(p.name)) throw badRequest(`Duplicate port name ${p.name}`); s.add(p.name); } }
libraryRouter.post('/templates', edit, (req, res) => {
  const b = parse(tplBody, req.body); checkPorts(b.ports);
  const t = db.prepare("SELECT kind FROM device_types WHERE id = ?").get<{ kind: string }>(b.device_type_id);
  if (!t || t.kind !== 'rack') throw badRequest('Choose a rack device type');
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO templates (device_type_id, name, brand, model, height_u, color, is_builtin) VALUES (?, ?, ?, ?, ?, ?, 0)').run(b.device_type_id, b.name, b.brand, b.model, b.height_u, b.color).lastInsertRowid;
    b.ports.forEach((p, i) => db.prepare('INSERT INTO template_ports (template_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)').run(r, p.name, p.kind, p.face, i));
    return r;
  })();
  logActivity(req, 'create', 'template', id, b.name);
  res.status(201).json(templatesOut(id)[0]);
});
libraryRouter.put('/templates/:id', edit, (req, res) => {
  const id = idParam(req);
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get<{ height_u: number }>(id);
  if (!existing) throw notFound('Template not found');
  const b = parse(tplBody, req.body); checkPorts(b.ports);
  db.transaction(() => {
    db.prepare("UPDATE templates SET name = ?, device_type_id = ?, brand = ?, model = ?, height_u = ?, color = ?, updated_at = datetime('now') WHERE id = ?").run(b.name, b.device_type_id, b.brand, b.model, b.height_u, b.color, id);
    db.prepare('DELETE FROM template_ports WHERE template_id = ?').run(id);
    b.ports.forEach((p, i) => db.prepare('INSERT INTO template_ports (template_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)').run(id, p.name, p.kind, p.face, i));
  })();
  logActivity(req, 'update', 'template', id, b.name);
  res.json(templatesOut(id)[0]);
});
libraryRouter.post('/templates/:id/duplicate', edit, (req, res) => {
  const id = idParam(req);
  const src = templatesOut(id)[0] as unknown as { name: string; device_type_id: number; brand: string; model: string; height_u: number; color: string; ports: { name: string; kind: string; face: string }[] } | undefined;
  if (!src) throw notFound('Template not found');
  let name = `${src.name} (copy)`; let n = 2;
  while (db.prepare('SELECT 1 FROM templates WHERE name = ?').get(name)) name = `${src.name} (copy ${n++})`;
  const nid = db.transaction(() => {
    const r = db.prepare('INSERT INTO templates (device_type_id, name, brand, model, height_u, color, is_builtin) VALUES (?, ?, ?, ?, ?, ?, 0)').run(src.device_type_id, name, src.brand, src.model, src.height_u, src.color).lastInsertRowid;
    src.ports.forEach((p, i) => db.prepare('INSERT INTO template_ports (template_id, name, kind, face, sort) VALUES (?, ?, ?, ?, ?)').run(r, p.name, p.kind, p.face, i));
    return r;
  })();
  logActivity(req, 'create', 'template', nid, name, { copied_from: src.name });
  res.status(201).json(templatesOut(nid)[0]);
});
libraryRouter.delete('/templates/:id', edit, (req, res) => {
  const id = idParam(req);
  const t = db.prepare('SELECT name, is_builtin, (SELECT COUNT(*) FROM devices d WHERE d.template_id = templates.id) AS c FROM templates WHERE id = ?').get<{ name: string; is_builtin: number; c: number }>(id);
  if (!t) throw notFound('Template not found');
  if (t.c > 0) throw badRequest(`${t.c} device(s) use this template`);
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  logActivity(req, 'delete', 'template', id, t.name);
  res.json({ ok: true });
});
