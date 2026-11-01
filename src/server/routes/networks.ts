import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { notFound } from '../errors.js';
import { idParam, parse, patchOf, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { DEVICE_PATH, updateRow } from '../model.js';

export const networksRouter = Router();
networksRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

const PORTS_OF = (col: string) => `SELECT p.id, p.name, p.kind, ${DEVICE_PATH} || '/' || p.name AS path, d.id AS device_id, d.code AS device_code, d.rack_id, d.floor_id, dt.name AS type_name
  FROM ports p JOIN devices d ON d.id = p.device_id JOIN device_types dt ON dt.id = d.device_type_id LEFT JOIN rooms ro ON ro.id = d.room_id JOIN floors f ON f.id = d.floor_id JOIN locations l ON l.id = f.location_id LEFT JOIN devices rk ON rk.id = d.rack_id
  WHERE p.${col} = ? ORDER BY path`;

// VLANs
const vlanBody = z.object({ vid: z.number().int().min(1).max(4094), name: z.string().trim().min(1).max(100), description: textSchema });
networksRouter.get('/vlans', (_req, res) => res.json(db.prepare('SELECT v.*, (SELECT COUNT(*) FROM ports p WHERE p.vlan_id = v.id) AS port_count FROM vlans v ORDER BY v.vid').all()));
networksRouter.get('/vlans/:id/ports', (req, res) => res.json(db.prepare(PORTS_OF('vlan_id')).all(idParam(req))));
networksRouter.post('/vlans', edit, (req, res) => {
  const b = parse(vlanBody, req.body);
  const id = db.prepare('INSERT INTO vlans (vid, name, description) VALUES (?, ?, ?)').run(b.vid, b.name, b.description).lastInsertRowid;
  logActivity(req, 'create', 'vlan', id, `VLAN ${b.vid} ${b.name}`);
  res.status(201).json(db.prepare('SELECT * FROM vlans WHERE id = ?').get(id));
});
networksRouter.patch('/vlans/:id', edit, (req, res) => {
  const id = idParam(req); const b = parse(patchOf(vlanBody), req.body);
  if (!db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(id)) throw notFound('VLAN not found');
  updateRow('vlans', id, b);
  const v = db.prepare('SELECT * FROM vlans WHERE id = ?').get<{ vid: number; name: string }>(id)!;
  logActivity(req, 'update', 'vlan', id, `VLAN ${v.vid} ${v.name}`, { fields: Object.keys(b) });
  res.json(v);
});
networksRouter.delete('/vlans/:id', edit, (req, res) => {
  const id = idParam(req);
  const v = db.prepare('SELECT * FROM vlans WHERE id = ?').get<{ vid: number; name: string }>(id);
  if (!v) throw notFound('VLAN not found');
  db.prepare('DELETE FROM vlans WHERE id = ?').run(id);
  logActivity(req, 'delete', 'vlan', id, `VLAN ${v.vid} ${v.name}`);
  res.json({ ok: true });
});
// WLANs
const wlanBody = z.object({ ssid: z.string().trim().min(1).max(64), name: textSchema, security: textSchema, description: textSchema });
networksRouter.get('/wlans', (_req, res) => res.json(db.prepare('SELECT w.*, (SELECT COUNT(*) FROM ports p WHERE p.wlan_id = w.id) AS port_count FROM wlans w ORDER BY w.ssid').all()));
networksRouter.get('/wlans/:id/ports', (req, res) => res.json(db.prepare(PORTS_OF('wlan_id')).all(idParam(req))));
networksRouter.post('/wlans', edit, (req, res) => {
  const b = parse(wlanBody, req.body);
  const id = db.prepare('INSERT INTO wlans (ssid, name, security, description) VALUES (?, ?, ?, ?)').run(b.ssid, b.name, b.security, b.description).lastInsertRowid;
  logActivity(req, 'create', 'wlan', id, `WLAN ${b.ssid}`);
  res.status(201).json(db.prepare('SELECT * FROM wlans WHERE id = ?').get(id));
});
networksRouter.patch('/wlans/:id', edit, (req, res) => {
  const id = idParam(req); const b = parse(patchOf(wlanBody), req.body);
  if (!db.prepare('SELECT 1 FROM wlans WHERE id = ?').get(id)) throw notFound('WLAN not found');
  updateRow('wlans', id, b);
  const w = db.prepare('SELECT * FROM wlans WHERE id = ?').get<{ ssid: string }>(id)!;
  logActivity(req, 'update', 'wlan', id, `WLAN ${w.ssid}`, { fields: Object.keys(b) });
  res.json(w);
});
networksRouter.delete('/wlans/:id', edit, (req, res) => {
  const id = idParam(req);
  const w = db.prepare('SELECT * FROM wlans WHERE id = ?').get<{ ssid: string }>(id);
  if (!w) throw notFound('WLAN not found');
  db.prepare('DELETE FROM wlans WHERE id = ?').run(id);
  logActivity(req, 'delete', 'wlan', id, `WLAN ${w.ssid}`);
  res.json({ ok: true });
});
