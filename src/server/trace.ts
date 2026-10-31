import { db } from './db.js';
import { notFound } from './errors.js';

export interface TracePort {
  id: number; name: string; kind: string; face: string; passthrough_port_id: number | null;
  device_id: number; device_code: string; device_name: string; type_name: string; category: string; passthrough: number;
  rack_id: number; rack_code: string; site_id: number; site_code: string; vlan_vid: number | null; vlan_name: string | null;
}
export type TraceStep =
  | { kind: 'port'; port: TracePort }
  | { kind: 'cable'; connection: { id: number; cable_type: string; color: string; label: string; length_m: number | null } }
  | { kind: 'through'; device_code: string };

const portQ = db.prepare(`SELECT p.id, p.name, p.kind, p.face, p.passthrough_port_id, d.id AS device_id, d.code AS device_code, d.name AS device_name,
    dt.name AS type_name, dt.category, dt.passthrough, r.id AS rack_id, r.code AS rack_code, s.id AS site_id, s.code AS site_code, v.vid AS vlan_vid, v.name AS vlan_name
  FROM ports p JOIN devices d ON d.id = p.device_id JOIN device_types dt ON dt.id = d.device_type_id JOIN racks r ON r.id = d.rack_id
  JOIN rooms ro ON ro.id = r.room_id JOIN floors f ON f.id = ro.floor_id JOIN sites s ON s.id = f.site_id LEFT JOIN vlans v ON v.id = p.vlan_id WHERE p.id = ?`);
const connQ = db.prepare(`SELECT id, port_a_id, port_b_id, cable_type, color, label, length_m FROM connections WHERE port_a_id = ? OR port_b_id = ?`);

export function getPort(id: number): TracePort | undefined {
  return portQ.get(id) as TracePort | undefined;
}

/** Walk outward from a port: cable -> peer port -> (passthrough) -> next port -> cable ... */
function walk(start: TracePort, visited: Set<number>, firstHopIsPassthrough: boolean): TraceStep[] {
  const steps: TraceStep[] = [];
  let current = start;
  let expectPassthrough = firstHopIsPassthrough;
  for (let guard = 0; guard < 500; guard++) {
    if (expectPassthrough) {
      if (!current.passthrough_port_id) break;
      const next = getPort(current.passthrough_port_id);
      if (!next || visited.has(next.id)) break;
      visited.add(next.id);
      steps.push({ kind: 'through', device_code: current.device_code });
      steps.push({ kind: 'port', port: next });
      current = next;
      expectPassthrough = false;
    } else {
      const c = connQ.get(current.id, current.id) as { id: number; port_a_id: number; port_b_id: number; cable_type: string; color: string; label: string; length_m: number | null } | undefined;
      if (!c) break;
      const peerId = c.port_a_id === current.id ? c.port_b_id : c.port_a_id;
      const peer = getPort(peerId);
      if (!peer || visited.has(peer.id)) break;
      visited.add(peer.id);
      steps.push({ kind: 'cable', connection: { id: c.id, cable_type: c.cable_type, color: c.color, label: c.label, length_m: c.length_m } });
      steps.push({ kind: 'port', port: peer });
      current = peer;
      expectPassthrough = true;
    }
  }
  return steps;
}

export function tracePort(id: number) {
  const start = getPort(id);
  if (!start) throw notFound('Port not found');
  const visited = new Set<number>([start.id]);
  const forward = walk(start, visited, false);
  const backward = walk(start, visited, true);
  const steps: TraceStep[] = [...backward.reverse(), { kind: 'port', port: start }, ...forward];
  const ends = steps.filter((s) => s.kind === 'port') as { kind: 'port'; port: TracePort }[];
  return {
    start_port_id: id,
    steps,
    endpoints: { a: ends[0]?.port ?? start, b: ends[ends.length - 1]?.port ?? start },
    cable_count: steps.filter((s) => s.kind === 'cable').length,
  };
}
