import { Router, raw } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { codeSchema, dateOpt, idParam, parse, textOpt, textSchema } from '../util.js';
import { logActivity } from '../activity.js';
import { DEVICE_COLS, DEVICE_JOIN, assertPlacement, findFreeSlot, codesInScope, connectionOfPort, getDevice, getPort, nextCode, peerOf, portState, portsOfDevice, roomForPoint, tracePort, updateRow, type DeviceRow } from '../model.js';
import { deleteFile } from './locations.js';

export const devicesRouter = Router();
devicesRouter.use(requireRole('viewer'));
const edit = requireRole('editor');
const userId = z.number().int().positive().nullable().optional();
const dateStr = z.string().trim().max(10).default('');

function portSummary(p: ReturnType<typeof portsOfDevice>[number]) {
  const st = portState(p.id);
  const peer = (type: 'building' | 'user') => {
    const c = connectionOfPort(p.id, type);
    if (!c) return null;
    const q = getPort(peerOf(c, p.id));
    return { connection_id: c.id, color: c.color, label: c.label, cable_type: c.cable_type, length_m: c.length_m, port_id: q.id, port_name: q.name, device_id: q.device_id, device_code: q.device_code, path: q.path, rack_id: q.rack_id, floor_id: q.floor_id };
  };
  const t = st.state === 'none' ? null : tracePort(p.id);
  return { ...p, ...st, building_peer: peer('building'), user_peer: peer('user'),
    chain: t ? { steps: t.steps.map((s) => ({ port_id: s.port.id, path: s.port.path, device_id: s.port.device_id, rack_id: s.port.rack_id, floor_id: s.port.floor_id, type_icon: s.port.type_icon, via: s.via?.type ?? null, connection_id: s.via?.connection.id ?? null })), complete: t.complete, color: t.color, start_index: t.start_index } : null };
}
function deviceDetail(id: number) {
  const d = getDevice(id);
  const ports = portsOfDevice(id).map(portSummary);
  const photos = db.prepare('SELECT df.id, f.uuid, f.name, f.size FROM device_files df JOIN files f ON f.id = df.file_id WHERE df.device_id = ? ORDER BY df.id').all(id);
  const rack_device_count = d.is_rack ? db.prepare('SELECT COUNT(*) AS c FROM devices WHERE rack_id = ?').get<{ c: number }>(id)!.c : 0;
  return { ...d, ports, photos, rack_device_count };
}
function createPortsFromTypeOrTemplate(deviceId: number, typeId: number, templateId: number | null) {
  const ins = db.prepare('INSERT INTO ports (device_id, name, kind, face, wireless_mode, sort) VALUES (?, ?, ?, ?, ?, ?)');
  if (templateId) {
    for (const p of db.prepare('SELECT name, kind, face, sort FROM template_ports WHERE template_id = ? ORDER BY sort').all<{ name: string; kind: string; face: string; sort: number }>(templateId)) ins.run(deviceId, p.name, p.kind, p.face, null, p.sort);
  } else {
    for (const p of db.prepare('SELECT name, kind, face, wireless_mode, sort FROM device_type_ports WHERE device_type_id = ? ORDER BY sort').all<{ name: string; kind: string; face: string; wireless_mode: string | null; sort: number }>(typeId)) ins.run(deviceId, p.name, p.kind, p.face, p.wireless_mode, p.sort);
  }
}

// ---------- Floor devices ----------
const floorDeviceBody = z.object({
  device_type_id: z.number().int().positive(), code: codeSchema.optional(), name: textSchema,
  room_id: z.number().int().positive().nullable().optional(), x: z.number().default(0), y: z.number().default(0), height_u: z.number().int().min(1).max(60).optional(),
});
devicesRouter.post('/floors/:id/devices', edit, (req, res) => {
  const floorId = idParam(req);
  if (!db.prepare('SELECT 1 FROM floors WHERE id = ?').get(floorId)) throw notFound('Floor not found');
  const b = parse(floorDeviceBody, req.body);
  const type = db.prepare('SELECT * FROM device_types WHERE id = ?').get<{ id: number; prefix: string; kind: string; is_rack: number; name: string }>(b.device_type_id);
  if (!type) throw notFound('Device type not found');
  if (type.kind !== 'floor') throw badRequest(`${type.name} is a rack device type; add it inside a rack`);
  const roomId = b.room_id === undefined ? roomForPoint(floorId, b.x, b.y) : b.room_id;
  if (roomId && !db.prepare('SELECT 1 FROM rooms WHERE id = ? AND floor_id = ?').get(roomId, floorId)) throw badRequest('Room is not on this floor');
  const code = b.code ?? nextCode(type.prefix, codesInScope(floorId, roomId, null));
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO devices (floor_id, room_id, device_type_id, code, name, x, y, height_u) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(floorId, roomId, type.id, code, b.name, b.x, b.y, type.is_rack ? (b.height_u ?? 42) : 1).lastInsertRowid;
    createPortsFromTypeOrTemplate(r, type.id, null);
    return r;
  })();
  const d = getDevice(id);
  logActivity(req, 'create', type.is_rack ? 'rack' : 'device', id, d.path, { type: type.name });
  res.status(201).json(deviceDetail(id));
});

// ---------- Rack devices ----------
devicesRouter.post('/racks/:id/devices', edit, (req, res) => {
  const rackId = idParam(req);
  const rack = getDevice(rackId);
  if (!rack.is_rack) throw badRequest('Target is not a rack');
  const b = parse(z.object({ template_id: z.number().int().positive(), code: codeSchema.optional(), name: textSchema, position_u: z.number().int().min(1), slot_x: z.number().int().min(0).max(100).optional() }), req.body);
  const tpl = db.prepare('SELECT t.*, dt.prefix, dt.name AS type_name, dt.is_tray FROM templates t JOIN device_types dt ON dt.id = t.device_type_id WHERE t.id = ?').get<{ id: number; device_type_id: number; height_u: number; width_pct: number; prefix: string; name: string; type_name: string; is_tray: number }>(b.template_id);
  if (!tpl) throw notFound('Template not found');
  const slotX = b.slot_x ?? findFreeSlot(rackId, b.position_u, tpl.height_u, tpl.width_pct, null, !!tpl.is_tray);
  if (slotX === null) throw badRequest(`No room for a ${tpl.width_pct}% wide device at U${b.position_u}`);
  assertPlacement(rackId, b.position_u, tpl.height_u, null, tpl.width_pct, slotX, !!tpl.is_tray);
  const code = b.code ?? nextCode(tpl.prefix, codesInScope(rack.floor_id, rack.room_id, rackId));
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO devices (floor_id, room_id, rack_id, device_type_id, template_id, code, name, x, y, position_u, height_u, width_pct, slot_x) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rack.floor_id, rack.room_id, rackId, tpl.device_type_id, tpl.id, code, b.name, rack.x, rack.y, b.position_u, tpl.height_u, tpl.width_pct, slotX).lastInsertRowid;
    createPortsFromTypeOrTemplate(r, tpl.device_type_id, tpl.id);
    return r;
  })();
  const d = getDevice(id);
  logActivity(req, 'create', 'rack_device', id, d.path, { template: tpl.name, position_u: b.position_u, slot_x: slotX });
  res.status(201).json(deviceDetail(id));
});

devicesRouter.get('/devices/:id', (req, res) => res.json(deviceDetail(idParam(req))));

const patchBody = z.object({
  code: codeSchema.optional(), name: textOpt, room_id: z.number().int().positive().nullable().optional(),
  x: z.number().optional(), y: z.number().optional(), position_u: z.number().int().min(1).optional(), rack_id: z.number().int().positive().optional(), slot_x: z.number().int().min(0).max(100).optional(),
  height_u: z.number().int().min(1).max(60).optional(), device_type_id: z.number().int().positive().optional(),
  manufacturer: textOpt, model: textOpt, serial: textOpt, purchase_date: dateOpt, operation_start: dateOpt,
  responsible_user_id: userId, notes: textOpt,
});
devicesRouter.patch('/devices/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(patchBody, req.body);
  const d = getDevice(id);
  const fields: Record<string, unknown> = { ...b };
  let action = 'update';
  if (d.rack_id) {
    // rack-mounted device
    const rackId = b.rack_id ?? d.rack_id;
    const pos = b.position_u ?? d.position_u ?? 1;
    const slotX = b.slot_x ?? d.slot_x;
    if (b.rack_id !== undefined || b.position_u !== undefined || b.slot_x !== undefined) {
      assertPlacement(rackId, pos, d.height_u, id, d.width_pct, slotX, !!d.is_tray);
      if (b.rack_id !== undefined && b.rack_id !== d.rack_id) {
        const target = getDevice(b.rack_id); if (!target.is_rack) throw badRequest('Target is not a rack');
        Object.assign(fields, { floor_id: target.floor_id, room_id: target.room_id, x: target.x, y: target.y }); action = 'move';
      }
    }
    delete fields.height_u; delete fields.device_type_id;
  } else {
    delete fields.rack_id; delete fields.position_u; delete fields.slot_x;
    if (b.x !== undefined || b.y !== undefined) {
      const x = b.x ?? d.x, y = b.y ?? d.y;
      if (b.room_id === undefined) fields.room_id = roomForPoint(d.floor_id, x, y);
    }
    if (b.room_id !== undefined && b.room_id !== null && !db.prepare('SELECT 1 FROM rooms WHERE id = ? AND floor_id = ?').get(b.room_id, d.floor_id)) throw badRequest('Room is not on this floor');
    if (fields.room_id !== undefined && fields.room_id !== d.room_id) action = 'move';
    if (d.is_rack && b.height_u !== undefined) {
      const top = db.prepare('SELECT MAX(position_u + height_u - 1) AS top FROM devices WHERE rack_id = ?').get<{ top: number | null }>(id)!;
      if (top.top && top.top > b.height_u) throw badRequest(`A device occupies U${top.top}; the rack cannot be shorter than that`);
    } else delete fields.height_u;
    if (b.device_type_id !== undefined) {
      const t = db.prepare('SELECT kind, is_rack FROM device_types WHERE id = ?').get<{ kind: string; is_rack: number }>(b.device_type_id);
      if (!t || t.kind !== 'floor' || !!t.is_rack !== !!d.is_rack) throw badRequest('Device type cannot be changed to that type');
    }
  }
  db.transaction(() => {
    updateRow('devices', id, fields);
    if (d.is_rack && (fields.room_id !== undefined || fields.x !== undefined || fields.y !== undefined)) {
      const nd = db.prepare('SELECT room_id, x, y FROM devices WHERE id = ?').get<{ room_id: number | null; x: number; y: number }>(id)!;
      db.prepare('UPDATE devices SET room_id = ?, x = ?, y = ? WHERE rack_id = ?').run(nd.room_id, nd.x, nd.y, id);
    }
  })();
  const nd = getDevice(id);
  logActivity(req, action, d.rack_id ? 'rack_device' : d.is_rack ? 'rack' : 'device', id, nd.path, { fields: Object.keys(b), from: d.path !== nd.path ? d.path : undefined });
  res.json(deviceDetail(id));
});
devicesRouter.delete('/devices/:id', edit, (req, res) => {
  const id = idParam(req);
  const d = getDevice(id);
  db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  logActivity(req, 'delete', d.rack_id ? 'rack_device' : d.is_rack ? 'rack' : 'device', id, d.path);
  res.json({ ok: true });
});

// ---------- Ports ----------
export const PORT_KINDS = ['rj45', 'sfp', 'sfp+', 'qsfp', 'lc', 'sc', 'e2000', 'mpo', 'console', 'usb', 'hdmi', 'dp', 'power', 'wireless', 'other'] as const;
devicesRouter.post('/devices/:id/ports', edit, (req, res) => {
  const id = idParam(req);
  const d = getDevice(id);
  const b = parse(z.object({ name: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()).optional(), kind: z.enum(PORT_KINDS).default('rj45'), face: z.enum(['front', 'rear']).default('front'), wireless_mode: z.enum(['client', 'broadcast']).nullable().optional() }), req.body);
  const existing = new Set(db.prepare('SELECT name FROM ports WHERE device_id = ?').all<{ name: string }>(id).map((p) => p.name));
  let name = b.name;
  if (!name) { let n = 1; const prefix = b.kind === 'wireless' ? 'W' : ''; while (existing.has(`${prefix}${String(n).padStart(2, '0')}`)) n++; name = `${prefix}${String(n).padStart(2, '0')}`; }
  const sort = (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM ports WHERE device_id = ?').get<{ s: number }>(id)!).s;
  const pid = db.prepare('INSERT INTO ports (device_id, name, kind, face, wireless_mode, sort) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, b.kind, b.face, b.kind === 'wireless' ? (b.wireless_mode ?? 'client') : null, sort).lastInsertRowid;
  logActivity(req, 'create', 'port', pid, `${d.path}/${name}`);
  res.status(201).json(portSummary(getPort(pid)));
});
devicesRouter.patch('/ports/:id', edit, (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ name: z.string().trim().min(1).max(16).transform((s) => s.toUpperCase()).optional(), kind: z.enum(PORT_KINDS).optional(), face: z.enum(['front', 'rear']).optional(),
    wireless_mode: z.enum(['client', 'broadcast']).nullable().optional(), vlan_id: z.number().int().positive().nullable().optional(), wlan_id: z.number().int().positive().nullable().optional(),
    speed: z.number().int().positive().nullable().optional(), notes: textOpt }), req.body);
  const p = getPort(id);
  if (b.vlan_id && !db.prepare('SELECT 1 FROM vlans WHERE id = ?').get(b.vlan_id)) throw notFound('VLAN not found');
  if (b.wlan_id && !db.prepare('SELECT 1 FROM wlans WHERE id = ?').get(b.wlan_id)) throw notFound('WLAN not found');
  updateRow('ports', id, b, false);
  logActivity(req, 'update', 'port', id, p.path, { fields: Object.keys(b) });
  res.json(portSummary(getPort(id)));
});
devicesRouter.delete('/ports/:id', edit, (req, res) => {
  const id = idParam(req);
  const p = getPort(id);
  db.prepare('DELETE FROM ports WHERE id = ?').run(id);
  logActivity(req, 'delete', 'port', id, p.path);
  res.json({ ok: true });
});
devicesRouter.get('/ports/:id', (req, res) => res.json(portSummary(getPort(idParam(req)))));

// ---------- Photos ----------
devicesRouter.post('/devices/:id/photos', edit, raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '15mb' }), (req, res) => {
  const id = idParam(req);
  const d = getDevice(id);
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Send the image as the request body');
  const mime = req.headers['content-type'] as string;
  const uuid = `${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, uuid), body);
  const fileId = db.prepare('INSERT INTO files (uuid, name, mime, size) VALUES (?, ?, ?, ?)').run(uuid, String(req.query.name ?? 'photo'), mime, body.length).lastInsertRowid;
  const pid = db.prepare('INSERT INTO device_files (device_id, file_id) VALUES (?, ?)').run(id, fileId).lastInsertRowid;
  logActivity(req, 'update', d.is_rack ? 'rack' : 'device', id, d.path, { photo: 'added' });
  res.status(201).json({ id: pid, uuid, name: req.query.name ?? 'photo', size: body.length });
});
devicesRouter.delete('/photos/:id', edit, (req, res) => {
  const id = idParam(req);
  const row = db.prepare('SELECT device_id, file_id FROM device_files WHERE id = ?').get<{ device_id: number; file_id: number }>(id);
  if (!row) throw notFound('Photo not found');
  db.prepare('DELETE FROM device_files WHERE id = ?').run(id);
  deleteFile(row.file_id);
  const d = getDevice(row.device_id);
  logActivity(req, 'update', d.is_rack ? 'rack' : 'device', d.id, d.path, { photo: 'removed' });
  res.json({ ok: true });
});

// ---------- Racks ----------
devicesRouter.get('/racks', (_req, res) => {
  res.json(db.prepare(`SELECT ${DEVICE_COLS}, (SELECT COUNT(*) FROM devices c WHERE c.rack_id = d.id) AS device_count,
      (SELECT COALESCE(SUM(c.height_u), 0) FROM devices c WHERE c.rack_id = d.id) AS used_u ${DEVICE_JOIN} WHERE dt.is_rack = 1 ORDER BY l.code, f.level, ro.code, d.code`).all());
});
devicesRouter.get('/racks/:id', (req, res) => {
  const id = idParam(req);
  const rack = getDevice(id);
  if (!rack.is_rack) throw notFound('Rack not found');
  const children = db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_JOIN} WHERE d.rack_id = ? ORDER BY d.position_u DESC`).all<DeviceRow>(id)
    .map((c) => ({ ...c, ports: portsOfDevice(c.id).map(portSummary) }));
  const photos = db.prepare('SELECT df.id, f.uuid, f.name, f.size FROM device_files df JOIN files f ON f.id = df.file_id WHERE df.device_id = ?').all(id);
  const vlans = db.prepare(`SELECT v.*, COUNT(p.id) AS port_count FROM vlans v JOIN ports p ON p.vlan_id = v.id JOIN devices d ON d.id = p.device_id WHERE d.rack_id = ? GROUP BY v.id ORDER BY v.vid`).all(id);
  res.json({ ...rack, devices: children, photos, vlans, floors: db.prepare('SELECT id, code FROM floors WHERE location_id = ?').all(rack.location_id) });
});

// ---------- Connection candidates ----------
/** Devices (with ports) a connection could be made to, within a scope. */
devicesRouter.get('/candidates', (req, res) => {
  const type = req.query.type === 'building' ? 'building' : 'user';
  const scope = String(req.query.scope ?? 'room'); const scopeId = Number(req.query.id);
  const forPort = req.query.port_id ? getPort(Number(req.query.port_id)) : null;
  const excludeDevice = forPort?.device_id ?? Number(req.query.exclude_device ?? 0);
  let where = '';
  if (scope === 'room') where = scopeId ? 'd.room_id = ?' : 'd.room_id IS NULL AND d.floor_id = ?';
  else if (scope === 'floor') where = 'd.floor_id = ?';
  else if (scope === 'location') where = 'f.location_id = ?';
  else if (scope === 'rack') where = 'd.rack_id = ?';
  else where = '1 = 1';
  const param = scope === 'room' && !scopeId ? Number(req.query.floor_id) : scopeId;
  const rows = db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_JOIN} WHERE ${where} ${scope === 'all' ? '' : ''} ${type === 'building' ? 'AND dt.passive = 1' : 'AND dt.is_rack = 0'} ORDER BY rk.code, d.position_u DESC, d.code`).all<DeviceRow>(...(scope === 'all' ? [] : [param]));
  const out = rows.filter((d) => d.id !== excludeDevice).map((d) => {
    const ports = db.prepare('SELECT id, name, kind, face, wireless_mode FROM ports WHERE device_id = ? ORDER BY sort, name').all<{ id: number; name: string; kind: string; face: string; wireless_mode: string | null }>(d.id).map((p) => {
      const b = !!connectionOfPort(p.id, 'building'); const u = !!connectionOfPort(p.id, 'user');
      let available = true; let reason = '';
      if (forPort && p.kind === 'wireless' !== (forPort.kind === 'wireless')) { available = false; reason = 'wireless/wired mismatch'; }
      if (type === 'building') { if (b) { available = false; reason = 'has building connection'; } }
      else { if (u) { available = false; reason = 'in use'; } else if (d.passive && !b) { available = false; reason = 'no building connection yet'; } }
      return { ...p, available, reason, building: b, user: u };
    });
    return { id: d.id, code: d.code, name: d.name, path: d.path, type_name: d.type_name, type_icon: d.type_icon, passive: d.passive, rack_id: d.rack_id, rack_code: d.rack_code, position_u: d.position_u, ports };
  });
  res.json(out);
});
/** Lightweight hierarchy for cascading selects. */
devicesRouter.get('/tree', (_req, res) => {
  const locations = db.prepare('SELECT id, code, name FROM locations ORDER BY code').all<{ id: number }>();
  const floors = db.prepare('SELECT id, location_id, code, name, level FROM floors ORDER BY level, code').all<{ id: number; location_id: number }>();
  const rooms = db.prepare('SELECT id, floor_id, code, name FROM rooms ORDER BY code').all<{ floor_id: number }>();
  const racks = db.prepare('SELECT d.id, d.floor_id, d.room_id, d.code, d.name FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE dt.is_rack = 1 ORDER BY d.code').all<{ floor_id: number }>();
  res.json({ locations, floors, rooms, racks });
});
