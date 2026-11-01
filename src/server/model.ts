import { db } from './db.js';
import { notFound, badRequest } from './errors.js';

/** Join every device to its type, template, room, floor, location and (if rack-mounted) rack. */
export const DEVICE_JOIN = `
  FROM devices d
  JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN templates t ON t.id = d.template_id
  LEFT JOIN rooms ro ON ro.id = d.room_id
  JOIN floors f ON f.id = d.floor_id
  JOIN locations l ON l.id = f.location_id
  LEFT JOIN devices rk ON rk.id = d.rack_id
  LEFT JOIN users ru ON ru.id = d.responsible_user_id`;
export const DEVICE_PATH = `l.code || '/' || f.code || '/' || COALESCE(ro.code, 'DEFAULT') || '/' || CASE WHEN rk.id IS NOT NULL THEN rk.code || '/' ELSE '' END || d.code`;
export const DEVICE_COLS = `d.*, dt.name AS type_name, dt.prefix AS type_prefix, dt.kind AS type_kind, dt.icon AS type_icon, dt.passive AS passive, dt.is_rack AS is_rack, dt.is_tray AS is_tray,
  t.name AS template_name, ro.code AS room_code, f.code AS floor_code, f.location_id, l.code AS location_code, l.name AS location_name,
  rk.code AS rack_code, rk.x AS rack_x, rk.y AS rack_y, ru.name AS responsible_name, ${DEVICE_PATH} AS path`;

export interface DeviceRow {
  id: number; floor_id: number; room_id: number | null; rack_id: number | null; device_type_id: number; template_id: number | null;
  code: string; name: string; x: number; y: number; position_u: number | null; height_u: number; width_pct: number; slot_x: number;
  manufacturer: string; model: string; serial: string; purchase_date: string; operation_start: string; responsible_user_id: number | null; notes: string;
  created_at: string; updated_at: string;
  type_name: string; type_prefix: string; type_kind: 'floor' | 'rack'; type_icon: string; passive: number; is_rack: number; is_tray: number; template_name: string | null;
  room_code: string | null; floor_code: string; location_id: number; location_code: string; location_name: string;
  rack_code: string | null; rack_x: number | null; rack_y: number | null; responsible_name: string | null; path: string;
}
export function getDevice(id: number): DeviceRow {
  const row = db.prepare(`SELECT ${DEVICE_COLS} ${DEVICE_JOIN} WHERE d.id = ?`).get<DeviceRow>(id);
  if (!row) throw notFound('Device not found');
  return row;
}

export interface PortRow {
  id: number; device_id: number; name: string; kind: string; face: string; sort: number; wireless_mode: string | null;
  vlan_id: number | null; wlan_id: number | null; speed: number | null; notes: string;
  vlan_vid: number | null; vlan_name: string | null; wlan_ssid: string | null;
  device_code: string; device_name: string; device_path: string; path: string; type_name: string; type_icon: string; passive: number; is_rack: number;
  floor_id: number; room_id: number | null; rack_id: number | null; location_id: number; x: number; y: number; rack_x: number | null; rack_y: number | null; position_u: number | null;
}
const PORT_SQL = `SELECT p.*, v.vid AS vlan_vid, v.name AS vlan_name, w.ssid AS wlan_ssid,
    d.code AS device_code, d.name AS device_name, ${DEVICE_PATH} AS device_path, ${DEVICE_PATH} || '/' || p.name AS path,
    dt.name AS type_name, dt.icon AS type_icon, dt.passive AS passive, dt.is_rack AS is_rack,
    d.floor_id, d.room_id, d.rack_id, f.location_id, d.x, d.y, rk.x AS rack_x, rk.y AS rack_y, d.position_u
  FROM ports p LEFT JOIN vlans v ON v.id = p.vlan_id LEFT JOIN wlans w ON w.id = p.wlan_id
  JOIN devices d ON d.id = p.device_id JOIN device_types dt ON dt.id = d.device_type_id
  LEFT JOIN rooms ro ON ro.id = d.room_id JOIN floors f ON f.id = d.floor_id JOIN locations l ON l.id = f.location_id LEFT JOIN devices rk ON rk.id = d.rack_id`;
export function getPort(id: number): PortRow {
  const row = db.prepare(`${PORT_SQL} WHERE p.id = ?`).get<PortRow>(id);
  if (!row) throw notFound('Port not found');
  return row;
}
export function portsOfDevice(deviceId: number): PortRow[] {
  return db.prepare(`${PORT_SQL} WHERE p.device_id = ? ORDER BY p.face, p.sort, p.name`).all<PortRow>(deviceId);
}

export interface ConnRow { id: number; port_a_id: number; port_b_id: number; type: 'building' | 'user'; color: string; label: string; cable_type: string; length_m: number | null; notes: string; created_at: string }
export function connectionOfPort(portId: number, type: 'building' | 'user'): ConnRow | undefined {
  return db.prepare('SELECT * FROM connections WHERE type = ? AND (port_a_id = ? OR port_b_id = ?)').get<ConnRow>(type, portId, portId);
}
export function peerOf(c: ConnRow, portId: number) { return c.port_a_id === portId ? c.port_b_id : c.port_a_id; }

// ---------- Trace ----------
export interface TraceStep { port: PortRow; via: null | { type: 'building' | 'user'; connection: ConnRow } }
export interface TraceResult { steps: TraceStep[]; complete: boolean; start_index: number; color: string }

/** Walk from a port, alternating connection types, passing only through passive devices (patch panels, outlets). */
function walk(start: PortRow, firstType: 'building' | 'user', visited: Set<number>): TraceStep[] {
  const out: TraceStep[] = [];
  let cur = start; let type = firstType;
  for (let i = 0; i < 200; i++) {
    const c = connectionOfPort(cur.id, type);
    if (!c) break;
    const peer = getPort(peerOf(c, cur.id));
    if (visited.has(peer.id)) break;
    visited.add(peer.id);
    out.push({ port: peer, via: { type, connection: c } });
    if (!peer.passive) break;
    cur = peer; type = type === 'building' ? 'user' : 'building';
  }
  return out;
}
export function tracePort(portId: number): TraceResult {
  const start = getPort(portId);
  const visited = new Set<number>([start.id]);
  // A passive port continues in both directions; an active port only has one connection anyway.
  const fwd = walk(start, 'user', visited);
  const back = walk(start, 'building', visited);
  // Reading order: furthest "building" hop first ... start ... furthest "user" hop last.
  // back[i].via is the link between back[i-1] (or start) and back[i].
  const steps: TraceStep[] = [];
  for (let i = back.length - 1; i >= 0; i--) steps.push({ port: back[i].port, via: i === back.length - 1 ? null : back[i + 1].via });
  steps.push({ port: start, via: back.length ? back[0].via : null });
  for (const s of fwd) steps.push(s);
  const ends = [steps[0].port, steps[steps.length - 1].port];
  const complete = steps.length > 1 && ends.every((p) => !p.passive);
  const color = steps.map((s) => s.via?.connection.color ?? '').find((c) => c) ?? '';
  return { steps, complete, start_index: back.length, color };
}
export type PortState = 'none' | 'incomplete' | 'complete';
export function portState(portId: number): { state: PortState; keystone: boolean; building: boolean; user: boolean } {
  const b = !!connectionOfPort(portId, 'building'); const u = !!connectionOfPort(portId, 'user');
  if (!b && !u) return { state: 'none', keystone: false, building: false, user: false };
  const t = tracePort(portId);
  return { state: t.complete ? 'complete' : 'incomplete', keystone: b, building: b, user: u };
}

// ---------- IDs ----------
export function nextCode(prefix: string, existing: Set<string>) {
  let n = 1;
  while (existing.has(`${prefix}${String(n).padStart(2, '0')}`)) n++;
  return `${prefix}${String(n).padStart(2, '0')}`;
}
export function codesInScope(floorId: number, roomId: number | null, rackId: number | null): Set<string> {
  const rows = rackId
    ? db.prepare('SELECT code FROM devices WHERE rack_id = ?').all<{ code: string }>(rackId)
    : db.prepare('SELECT code FROM devices WHERE floor_id = ? AND rack_id IS NULL AND COALESCE(room_id, 0) = COALESCE(?, 0)').all<{ code: string }>(floorId, roomId);
  return new Set(rows.map((r) => r.code));
}

// ---------- Rooms ----------
export type Pt = [number, number];
export function pointInPolygon(pt: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function polygonArea(poly: Pt[]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}
/** Most specific (smallest) room containing the point, or null for the implicit DEFAULT room. */
export function roomForPoint(floorId: number, x: number, y: number): number | null {
  const rooms = db.prepare('SELECT id, points FROM rooms WHERE floor_id = ?').all<{ id: number; points: string }>(floorId);
  let best: { id: number; area: number } | null = null;
  for (const r of rooms) {
    const poly = JSON.parse(r.points) as Pt[];
    if (poly.length >= 3 && pointInPolygon([x, y], poly)) {
      const area = polygonArea(poly);
      if (!best || area < best.area) best = { id: r.id, area };
    }
  }
  return best?.id ?? null;
}

export function touch(table: string, id: number) {
  db.prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(id);
}
export function updateRow(table: string, id: number, fields: Record<string, unknown>, withUpdated = true) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`);
  if (withUpdated) sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}
export function assertPlacement(rackId: number, positionU: number, heightU: number, excludeId: number | null, widthPct = 100, slotX = 0, isTray = false) {
  const rack = db.prepare('SELECT height_u, code FROM devices WHERE id = ?').get<{ height_u: number; code: string }>(rackId);
  if (!rack) throw notFound('Rack not found');
  const top = positionU + heightU - 1;
  if (positionU < 1 || top > rack.height_u) throw badRequest(`Device would occupy U${positionU}-U${top}; rack ${rack.code} has ${rack.height_u} units`);
  if (slotX < 0 || slotX + widthPct > 100) throw badRequest('Device does not fit within the rack width at that position');
  // A tray only clashes with other trays; devices never clash with trays (they sit on them).
  const clash = db.prepare(`SELECT d.code FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = ? AND (? IS NULL OR d.id <> ?)
      AND d.position_u <= ? AND ? <= d.position_u + d.height_u - 1 AND d.slot_x < ? AND ? < d.slot_x + d.width_pct AND dt.is_tray = ? LIMIT 1`)
    .get<{ code: string }>(rackId, excludeId, excludeId, top, positionU, slotX + widthPct, slotX, isTray ? 1 : 0);
  if (clash) throw badRequest(`Overlaps ${clash.code} in rack ${rack.code}`);
}
/** Leftmost horizontal slot (in 1/12 steps) where a device of this size fits across the U range, or null. */
export function findFreeSlot(rackId: number, positionU: number, heightU: number, widthPct: number, excludeId: number | null, isTray = false): number | null {
  for (let step = 0; step <= 12; step++) {
    const x = Math.round((step * 100) / 12);
    if (x + widthPct > 100) break;
    try { assertPlacement(rackId, positionU, heightU, excludeId, widthPct, x, isTray); return x; } catch { /* try next */ }
  }
  return null;
}

/** Resolve a resource path like HQ/27/MDF/RK01/PP01/01 (or a prefix of it) to a row. */
export function resolvePath(input: string): { kind: 'location' | 'floor' | 'room' | 'device' | 'port'; id: number; path: string } | null {
  const parts = input.trim().toUpperCase().split('/').filter(Boolean);
  if (!parts.length) return null;
  const loc = db.prepare('SELECT id FROM locations WHERE UPPER(code) = ?').get<{ id: number }>(parts[0]);
  if (!loc) return null;
  if (parts.length === 1) return { kind: 'location', id: loc.id, path: parts[0] };
  const floor = db.prepare('SELECT id FROM floors WHERE location_id = ? AND UPPER(code) = ?').get<{ id: number }>(loc.id, parts[1]);
  if (!floor) return null;
  if (parts.length === 2) return { kind: 'floor', id: floor.id, path: parts.slice(0, 2).join('/') };
  const roomCode = parts[2];
  const room = roomCode === 'DEFAULT' ? { id: null as number | null } : db.prepare('SELECT id FROM rooms WHERE floor_id = ? AND UPPER(code) = ?').get<{ id: number }>(floor.id, roomCode);
  if (!room) return null;
  if (parts.length === 3) return room.id === null ? { kind: 'floor', id: floor.id, path: parts.slice(0, 2).join('/') } : { kind: 'room', id: room.id, path: parts.slice(0, 3).join('/') };
  // parts[3] is a floor device (possibly a rack)
  const dev = db.prepare('SELECT id FROM devices WHERE floor_id = ? AND rack_id IS NULL AND COALESCE(room_id, 0) = COALESCE(?, 0) AND UPPER(code) = ?').get<{ id: number }>(floor.id, room.id, parts[3]);
  if (!dev) return null;
  if (parts.length === 4) return { kind: 'device', id: dev.id, path: parts.slice(0, 4).join('/') };
  // parts[4]: either a port of the floor device, or a device inside the rack
  const inRack = db.prepare('SELECT id FROM devices WHERE rack_id = ? AND UPPER(code) = ?').get<{ id: number }>(dev.id, parts[4]);
  if (inRack) {
    if (parts.length === 5) return { kind: 'device', id: inRack.id, path: parts.slice(0, 5).join('/') };
    const port = db.prepare('SELECT id FROM ports WHERE device_id = ? AND UPPER(name) = ?').get<{ id: number }>(inRack.id, parts[5]);
    return port ? { kind: 'port', id: port.id, path: parts.slice(0, 6).join('/') } : null;
  }
  const port = db.prepare('SELECT id FROM ports WHERE device_id = ? AND UPPER(name) = ?').get<{ id: number }>(dev.id, parts[4]);
  return port && parts.length === 5 ? { kind: 'port', id: port.id, path: parts.slice(0, 5).join('/') } : null;
}
