import { db } from './db.js';
import { notFound } from './errors.js';

export interface PortRow {
  id: number; device_id: number; name: string; kind: string; face: 'front' | 'rear'; sort: number;
  passthrough_port_id: number | null; vlan_id: number | null; notes: string;
}

export function peerSummary(portId: number) {
  return db.prepare(`
    SELECT c.id AS connection_id, c.cable_type, c.color, c.label, c.length_m,
      p.id AS port_id, p.name AS port_name, p.face AS port_face, p.kind AS port_kind,
      d.id AS device_id, d.code AS device_code, d.name AS device_name,
      r.id AS rack_id, r.code AS rack_code, s.id AS site_id, s.code AS site_code
    FROM connections c
    JOIN ports p ON p.id = CASE WHEN c.port_a_id = @id THEN c.port_b_id ELSE c.port_a_id END
    JOIN devices d ON d.id = p.device_id
    JOIN racks r ON r.id = d.rack_id
    JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    WHERE c.port_a_id = @id OR c.port_b_id = @id`).get({ id: portId }) as Record<string, unknown> | undefined;
}

export function getRackDetail(id: number) {
  const rack = db.prepare(`SELECT r.*, ro.id AS room_id, ro.code AS room_code, ro.name AS room_name,
      f.id AS floor_id, f.code AS floor_code, f.name AS floor_name,
      s.id AS site_id, s.code AS site_code, s.name AS site_name
    FROM racks r JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id
    WHERE r.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!rack) throw notFound('Rack not found');
  const devices = db.prepare(`SELECT d.*, dt.name AS type_name, dt.category, dt.height_u, dt.color, dt.passthrough, dt.manufacturer, dt.model
    FROM devices d JOIN device_types dt ON dt.id = d.device_type_id WHERE d.rack_id = ? ORDER BY d.position_u DESC`).all(id) as { id: number }[];
  const ports = db.prepare(`SELECT p.*, v.vid AS vlan_vid, v.name AS vlan_name FROM ports p
    JOIN devices d ON d.id = p.device_id LEFT JOIN vlans v ON v.id = p.vlan_id
    WHERE d.rack_id = ? ORDER BY p.face, p.sort`).all(id) as (PortRow & { vlan_vid: number | null })[];
  const connMap = new Map<number, Record<string, unknown>>();
  const conns = db.prepare(`SELECT c.*, pa.device_id AS a_device, pb.device_id AS b_device FROM connections c
    JOIN ports pa ON pa.id = c.port_a_id JOIN ports pb ON pb.id = c.port_b_id
    JOIN devices da ON da.id = pa.device_id JOIN devices db2 ON db2.id = pb.device_id
    WHERE da.rack_id = ? OR db2.rack_id = ?`).all(id, id) as { port_a_id: number; port_b_id: number }[];
  for (const c of conns) { connMap.set(c.port_a_id, c); connMap.set(c.port_b_id, c); }
  const portsOut = ports.map((p) => ({ ...p, connection: connMap.has(p.id) ? peerSummary(p.id) : null }));
  const vlans = db.prepare('SELECT * FROM vlans WHERE site_id = ? ORDER BY vid').all(rack.site_id as number);
  return {
    ...rack,
    devices: devices.map((d) => ({ ...d, ports: portsOut.filter((p) => p.device_id === d.id) })),
    vlans,
  };
}
