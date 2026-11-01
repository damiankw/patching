import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse, patchOf, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { connectionOfPort, getDevice, getPort, peerOf, tracePort, updateRow, type ConnRow } from '../model.js';

export const connectionsRouter = Router();
connectionsRouter.use(requireRole('viewer'));
const edit = requireRole('editor');

export function validateConnection(aId: number, bId: number, type: 'building' | 'user') {
  if (aId === bId) throw badRequest('A port cannot connect to itself');
  const a = getPort(aId); const b = getPort(bId);
  if (a.device_id === b.device_id) throw badRequest('Both ports are on the same device');
  if ((a.kind === 'wireless') !== (b.kind === 'wireless')) throw badRequest('Wireless ports can only connect to wireless ports');
  for (const p of [a, b]) {
    if (connectionOfPort(p.id, type)) throw badRequest(`${p.path} already has a ${type} connection`);
    if (type === 'building' && !p.passive) throw badRequest(`${p.path} is not a patch panel or outlet port; building connections terminate at passive ports`);
    if (type === 'user' && p.passive && !connectionOfPort(p.id, 'building')) throw badRequest(`${p.path} has no building connection yet. Create the building connection first (think of it as inserting the keystone).`);
  }
  return { a, b };
}

const body = z.object({ port_a_id: z.number().int().positive(), port_b_id: z.number().int().positive(), type: z.enum(['building', 'user']).default('user'),
  color: textSchema, label: textSchema, cable_type: textSchema, length_m: z.number().nonnegative().nullable().default(null), notes: textSchema });

function connOut(c: ConnRow) {
  const a = getPort(c.port_a_id); const b = getPort(c.port_b_id);
  const t = tracePort(c.port_a_id);
  return { ...c, a: { port_id: a.id, path: a.path, device_id: a.device_id, device_code: a.device_code, port_name: a.name, rack_id: a.rack_id, floor_id: a.floor_id, location_id: a.location_id },
    b: { port_id: b.id, path: b.path, device_id: b.device_id, device_code: b.device_code, port_name: b.name, rack_id: b.rack_id, floor_id: b.floor_id, location_id: b.location_id },
    chain: { from: t.steps[0].port.path, to: t.steps[t.steps.length - 1].port.path, via: t.steps.slice(1, -1).map((s) => s.port.path), complete: t.complete, color: t.color } };
}

connectionsRouter.post('/connections', edit, (req, res) => {
  const b = parse(body, req.body);
  const { a, b: pb } = validateConnection(b.port_a_id, b.port_b_id, b.type);
  const id = db.prepare('INSERT INTO connections (port_a_id, port_b_id, type, color, label, cable_type, length_m, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(b.port_a_id, b.port_b_id, b.type, b.color, b.label, b.cable_type, b.length_m, b.notes).lastInsertRowid;
  logActivity(req, 'connect', 'connection', id, `${a.path} ⇄ ${pb.path}`, { type: b.type });
  res.status(201).json(connOut(db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnRow>(id)!));
});
connectionsRouter.patch('/connections/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchOf(body.omit({ port_a_id: true, port_b_id: true, type: true })), req.body);
  const c = db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnRow>(id);
  if (!c) throw notFound('Connection not found');
  db.transaction(() => {
    updateRow('connections', id, b, false);
    // A colour belongs to the whole chain: propagate it to every connection in the chain.
    if (b.color !== undefined) {
      const t = tracePort(c.port_a_id);
      for (const s of t.steps) if (s.via) db.prepare('UPDATE connections SET color = ? WHERE id = ?').run(b.color, s.via.connection.id);
    }
  })();
  logActivity(req, 'update', 'connection', id, `${getPort(c.port_a_id).path} ⇄ ${getPort(c.port_b_id).path}`, { fields: Object.keys(b) });
  res.json(connOut(db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnRow>(id)!));
});
connectionsRouter.delete('/connections/:id', edit, (req, res) => {
  const id = idParam(req);
  const c = db.prepare('SELECT * FROM connections WHERE id = ?').get<ConnRow>(id);
  if (!c) throw notFound('Connection not found');
  const label = `${getPort(c.port_a_id).path} ⇄ ${getPort(c.port_b_id).path}`;
  // Removing a building connection also removes user connections that depended on it (keystone pulled)
  const removedUser: string[] = [];
  db.transaction(() => {
    if (c.type === 'building') {
      for (const pid of [c.port_a_id, c.port_b_id]) {
        const p = getPort(pid);
        if (p.passive) { const u = connectionOfPort(pid, 'user'); if (u) { removedUser.push(`${getPort(u.port_a_id).path} ⇄ ${getPort(u.port_b_id).path}`); db.prepare('DELETE FROM connections WHERE id = ?').run(u.id); } }
      }
    }
    db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  })();
  logActivity(req, 'disconnect', 'connection', id, label, { type: c.type, dependent_user_connections_removed: removedUser });
  res.json({ ok: true, removed_user_connections: removedUser });
});

connectionsRouter.get('/connections', (req, res) => {
  const rackId = Number(req.query.rack_id ?? 0), floorId = Number(req.query.floor_id ?? 0), locId = Number(req.query.location_id ?? 0), deviceId = Number(req.query.device_id ?? 0);
  const q = String(req.query.q ?? '').trim().toUpperCase();
  const rows = db.prepare(`SELECT c.* FROM connections c JOIN ports pa ON pa.id = c.port_a_id JOIN ports pb ON pb.id = c.port_b_id
      JOIN devices da ON da.id = pa.device_id JOIN devices db2 ON db2.id = pb.device_id JOIN floors fa ON fa.id = da.floor_id JOIN floors fb ON fb.id = db2.floor_id
    WHERE (? = 0 OR da.rack_id = ? OR db2.rack_id = ? OR da.id = ? OR db2.id = ?) AND (? = 0 OR da.floor_id = ? OR db2.floor_id = ?) AND (? = 0 OR fa.location_id = ? OR fb.location_id = ?) AND (? = 0 OR da.id = ? OR db2.id = ?)
    ORDER BY c.id DESC LIMIT 3000`).all<ConnRow>(rackId, rackId, rackId, rackId, rackId, floorId, floorId, floorId, locId, locId, locId, deviceId, deviceId, deviceId);
  let out = rows.map(connOut);
  if (q) out = out.filter((c) => `${c.a.path} ${c.b.path} ${c.label} ${c.cable_type} ${c.type}`.toUpperCase().includes(q));
  res.json(out);
});
connectionsRouter.get('/ports/:id/trace', (req, res) => {
  const t = tracePort(idParam(req));
  res.json({ ...t, steps: t.steps.map((s) => ({ port: { id: s.port.id, name: s.port.name, kind: s.port.kind, path: s.port.path, device_id: s.port.device_id, device_code: s.port.device_code, device_name: s.port.device_name, type_name: s.port.type_name, type_icon: s.port.type_icon, passive: s.port.passive, rack_id: s.port.rack_id, floor_id: s.port.floor_id, vlan_vid: s.port.vlan_vid, vlan_name: s.port.vlan_name }, via: s.via ? { type: s.via.type, connection: s.via.connection } : null })) });
});

/** Bulk save from the "Manage building connections" dialog: one row per port of the device. */
connectionsRouter.put('/devices/:id/building-connections', edit, (req, res) => {
  const id = idParam(req);
  const d = getDevice(id);
  if (!d.passive) throw badRequest('Building connections are managed on patch panels and outlets');
  const rows = parse(z.array(z.object({ port_id: z.number().int().positive(), target_port_id: z.number().int().positive().nullable() })), req.body);
  const changes: string[] = [];
  db.transaction(() => {
    for (const r of rows) {
      const p = getPort(r.port_id);
      if (p.device_id !== id) throw badRequest('Port does not belong to this device');
      const existing = connectionOfPort(p.id, 'building');
      const currentTarget = existing ? peerOf(existing, p.id) : null;
      if (currentTarget === r.target_port_id) continue;
      if (existing) {
        // keystone pulled: dependent user connections on both passive ends go too
        for (const pid of [existing.port_a_id, existing.port_b_id]) { const u = connectionOfPort(pid, 'user'); if (u) db.prepare('DELETE FROM connections WHERE id = ?').run(u.id); }
        db.prepare('DELETE FROM connections WHERE id = ?').run(existing.id); changes.push(`removed ${p.path}`);
      }
      if (r.target_port_id) {
        const { b } = validateConnection(p.id, r.target_port_id, 'building');
        db.prepare("INSERT INTO connections (port_a_id, port_b_id, type) VALUES (?, ?, 'building')").run(p.id, r.target_port_id);
        changes.push(`${p.path} ⇄ ${b.path}`);
      }
    }
  })();
  if (changes.length) logActivity(req, 'connect', 'connection', null, d.path, { building_connections: changes });
  res.json({ ok: true, changes });
});
