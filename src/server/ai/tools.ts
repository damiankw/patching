/**
 * Tools the assistant can call. Each one goes through the app's own HTTP API as the
 * signed-in user, so validation, permissions and the activity log all apply exactly
 * as they do for manual edits.
 */
import { z } from 'zod';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { DeviceRow } from '../model.js';

export interface ToolContext { cookie: string; baseUrl: string; emit: (ev: Record<string, unknown>) => void }

async function call<T = unknown>(ctx: ToolContext, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}/api${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: ctx.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && (data as { error?: string }).error) || `HTTP ${res.status}`);
  return data as T;
}
const j = (v: unknown) => JSON.stringify(v);
const ref = z.string().describe('Resource path like HQ/27/MDF/RK01/PP01 or a numeric id');

/** Accepts a path or a numeric id and returns the id of the expected kind. */
async function idOf(ctx: ToolContext, input: string | number, kind: 'location' | 'floor' | 'room' | 'device' | 'port'): Promise<number> {
  if (typeof input === 'number' || /^\d+$/.test(String(input))) return Number(input);
  let r: { kind: string; id: number };
  try { r = await call(ctx, 'GET', `/resolve?path=${encodeURIComponent(String(input))}`); }
  catch { throw new Error(`Nothing found at path ${input}. Use get_overview or search to find the exact path.`); }
  if (r.kind !== kind) throw new Error(`${input} is a ${r.kind}, expected a ${kind}`);
  return r.id;
}
function compactDevice(d: DeviceRow & { ports?: { name: string; kind: string; face: string; state?: string; keystone?: boolean; user_peer?: { path: string } | null; building_peer?: { path: string } | null; vlan_vid?: number | null }[] }) {
  return { id: d.id, path: d.path, name: d.name || undefined, type: d.type_name, template: d.template_name || undefined, rack_unit: d.position_u ?? undefined, height_u: d.rack_id || d.is_rack ? d.height_u : undefined, width_pct: d.rack_id && d.width_pct < 100 ? d.width_pct : undefined, slot_x: d.rack_id && d.width_pct < 100 ? d.slot_x : undefined,
    manufacturer: d.manufacturer || undefined, model: d.model || undefined, serial: d.serial || undefined, notes: d.notes || undefined,
    ports: d.ports?.map((p) => ({ name: p.name, kind: p.kind, face: p.face, state: p.state, keystone: p.keystone || undefined, user: p.user_peer?.path, building: p.building_peer?.path, vlan: p.vlan_vid ?? undefined })) };
}

export interface ToolSpec { name: string; description: string; schema: z.ZodObject<z.ZodRawShape>; run: (input: unknown) => Promise<string> }

/** Provider-neutral tool table. `run` always returns a string; failures come back as "ERROR: …" so any model can react. */
export function defineTools(ctx: ToolContext): ToolSpec[] {
  const T = <S extends z.ZodObject<z.ZodRawShape>>(name: string, description: string, schema: S, run: (input: z.infer<S>) => Promise<unknown>): ToolSpec =>
    ({ name, description, schema, run: async (raw: unknown) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) { const msg = `ERROR: invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`; ctx.emit({ type: 'tool_result', name, ok: false, result: msg }); return msg; }
      const input = parsed.data as z.infer<S>;
      ctx.emit({ type: 'tool_start', name, input });
      try { const out = await run(input); const text = typeof out === 'string' ? out : j(out); ctx.emit({ type: 'tool_result', name, ok: true, result: text.length > 400 ? text.slice(0, 400) + '…' : text }); return text; }
      catch (e) { const msg = `ERROR: ${e instanceof Error ? e.message : String(e)}`; ctx.emit({ type: 'tool_result', name, ok: false, result: msg }); return msg; }
    } });

  return [
    T('get_overview', 'Counts plus the full hierarchy of locations, floors, rooms and racks with their ids and paths. Call this first to learn what exists.', z.object({}), async () => {
      const stats = await call(ctx, 'GET', '/stats'); const tree = await call<{ locations: { id: number; code: string; name: string }[]; floors: { id: number; location_id: number; code: string; name: string; level: number }[]; rooms: { id: number; floor_id: number; code: string; name: string }[]; racks: { id: number; floor_id: number; room_id: number | null; code: string; name: string }[] }>(ctx, 'GET', '/tree');
      return { stats, locations: tree.locations.map((l) => ({ id: l.id, path: l.code, name: l.name, floors: tree.floors.filter((f) => f.location_id === l.id).map((f) => ({ id: f.id, path: `${l.code}/${f.code}`, name: f.name, level: f.level, rooms: tree.rooms.filter((r) => r.floor_id === f.id).map((r) => ({ id: r.id, path: `${l.code}/${f.code}/${r.code}`, name: r.name })), racks: tree.racks.filter((k) => k.floor_id === f.id).map((k) => ({ id: k.id, path: `${l.code}/${f.code}/${tree.rooms.find((r) => r.id === k.room_id)?.code ?? 'DEFAULT'}/${k.code}`, name: k.name })) })) })) };
    }),
    T('search', 'Search locations, floors, rooms, devices (by ID, name, serial, model) and networks.', z.object({ query: z.string() }), (i) => call(ctx, 'GET', `/search?q=${encodeURIComponent(i.query)}`)),
    T('list_devices', 'List devices, optionally within one location, floor or rack. Returns compact rows with path, type, rack unit and port counts.', z.object({ location: ref.optional(), floor: ref.optional(), rack: ref.optional(), contains: z.string().optional().describe('Filter: text contained in path or name') }), async (i) => {
      const rows = await call<Record<string, unknown>[]>(ctx, 'GET', '/resources/devices');
      const locId = i.location ? await idOf(ctx, i.location, 'location') : null; const floorId = i.floor ? await idOf(ctx, i.floor, 'floor') : null; const rackId = i.rack ? await idOf(ctx, i.rack, 'device') : null; const c = i.contains?.toUpperCase();
      return rows.filter((r) => (!locId || r.location_id === locId) && (!floorId || r.floor_id === floorId) && (!rackId || r.rack_id === rackId) && (!c || `${r.path} ${r.name ?? ''}`.toUpperCase().includes(c)))
        .map((r) => ({ id: r.id, path: r.path, name: r.name || undefined, type: r.device_type, rack_unit: undefined, ports: r.ports, connected_ports: r.connected_ports, serial: r.serial || undefined })).slice(0, 300);
    }),
    T('get_floor', 'Rooms, devices and connections on one floor, including the floor plan size (x/y coordinates run 0..plan_w and 0..plan_h).', z.object({ floor: ref }), async (i) => {
      const v = await call<{ floor: { id: number; code: string; plan_w: number; plan_h: number; plan_scale: number | null; location_code: string }; rooms: { id: number; code: string; name: string; points: number[][] }[]; devices: DeviceRow[]; connections: { type: string; chain: { from: string; to: string; via: string[]; complete: boolean } | null }[] }>(ctx, 'GET', `/floors/${await idOf(ctx, i.floor, 'floor')}/view`);
      return { floor: { id: v.floor.id, path: `${v.floor.location_code}/${v.floor.code}`, plan_w: v.floor.plan_w, plan_h: v.floor.plan_h, has_scale: !!v.floor.plan_scale }, rooms: v.rooms.map((r) => ({ id: r.id, code: r.code, name: r.name, points: r.points })), devices: v.devices.map((d) => ({ id: d.id, path: d.path, name: d.name || undefined, type: d.type_name, x: d.x, y: d.y, is_rack: !!d.is_rack })), connections: v.connections.filter((c) => c.chain).map((c) => ({ type: c.type, from: c.chain!.from, via: c.chain!.via, to: c.chain!.to, complete: c.chain!.complete })) };
    }),
    T('get_rack', 'A rack with every mounted device, their rack units and ports with connection state (none, incomplete, complete) and peers.', z.object({ rack: ref }), async (i) => {
      const r = await call<DeviceRow & { devices: (DeviceRow & { ports: never[] })[] }>(ctx, 'GET', `/racks/${await idOf(ctx, i.rack, 'device')}`);
      const used = new Set<number>(); for (const d of r.devices) for (let u = d.position_u ?? 0; u < (d.position_u ?? 0) + d.height_u; u++) if (d.width_pct >= 100) used.add(u);
      return { id: r.id, path: r.path, name: r.name, rack_units: r.height_u, free_units: Array.from({ length: r.height_u }, (_, k) => k + 1).filter((u) => !used.has(u)), devices: r.devices.map((d) => compactDevice(d as never)) };
    }),
    T('get_device', 'Full detail of one device including every port, its VLAN and the end-to-end connection chain.', z.object({ device: ref }), async (i) => compactDevice(await call(ctx, 'GET', `/devices/${await idOf(ctx, i.device, 'device')}`) as never)),
    T('list_device_types', 'Floor and rack device types with their ID prefixes and default ports. Floor types are placed on floors; rack types are placed inside racks via templates.', z.object({}), async () => (await call<{ id: number; name: string; prefix: string; kind: string; passive: number; is_rack: number; is_tray: number; ports: { name: string; kind: string }[] }[]>(ctx, 'GET', '/device-types')).map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, kind: t.kind, passive: !!t.passive || undefined, is_rack: !!t.is_rack || undefined, is_tray: !!t.is_tray || undefined, default_ports: t.ports.map((p) => `${p.name}:${p.kind}`).join(',') || undefined }))),
    T('list_templates', 'Rack device templates (what you can mount in a rack): name, type, height, width and port layout.', z.object({}), async () => (await call<{ id: number; name: string; type_name: string; height_u: number; width_pct: number; ports: { name: string; kind: string; face: string }[] }[]>(ctx, 'GET', '/templates')).map((t) => ({ id: t.id, name: t.name, type: t.type_name, height_u: t.height_u, width_pct: t.width_pct, ports: `${t.ports.length}: ${t.ports.slice(0, 6).map((p) => `${p.name}(${p.kind}${p.face === 'rear' ? ',back' : ''})`).join(' ')}${t.ports.length > 6 ? ' …' : ''}` }))),
    T('list_networks', 'All VLANs and WLANs.', z.object({}), async () => ({ vlans: await call(ctx, 'GET', '/vlans'), wlans: await call(ctx, 'GET', '/wlans') })),
    T('get_activity', 'Recent entries from the activity log (what changed, by whom).', z.object({ limit: z.number().int().min(1).max(100).default(20) }), async (i) => (await call<{ rows: { created_at: string; user_name: string; action: string; entity_type: string; entity_label: string }[] }>(ctx, 'GET', `/activity?limit=${i.limit}`)).rows.map((r) => `${r.created_at} ${r.user_name} ${r.action} ${r.entity_type} ${r.entity_label}`)),

    T('create_location', 'Create a location (building or site). A Ground Floor is created with it.', z.object({ code: z.string().describe('Short uppercase ID, e.g. HQ'), name: z.string(), address: z.string().optional(), contact: z.string().optional(), notes: z.string().optional() }), (i) => call(ctx, 'POST', '/locations', i)),
    T('update_location', 'Change a location.', z.object({ location: ref, code: z.string().optional(), name: z.string().optional(), address: z.string().optional(), contact: z.string().optional(), notes: z.string().optional() }), async ({ location, ...b }) => call(ctx, 'PATCH', `/locations/${await idOf(ctx, location, 'location')}`, b)),
    T('create_floor', 'Add a floor to a location.', z.object({ location: ref, code: z.string().describe('Short ID, e.g. 1, 27, B1'), name: z.string().optional(), level: z.number().int().optional() }), async ({ location, ...b }) => call(ctx, 'POST', `/locations/${await idOf(ctx, location, 'location')}/floors`, b)),
    T('update_floor', 'Change a floor (code, name, level, notes).', z.object({ floor: ref, code: z.string().optional(), name: z.string().optional(), level: z.number().int().optional(), notes: z.string().optional() }), async ({ floor, ...b }) => call(ctx, 'PATCH', `/floors/${await idOf(ctx, floor, 'floor')}`, b)),
    T('create_room', 'Draw a room on a floor. Give polygon points in floor-plan pixels, or omit them to place a default rectangle in the next free grid slot.', z.object({ floor: ref, code: z.string(), name: z.string().optional(), points: z.array(z.tuple([z.number(), z.number()])).min(3).optional() }), async ({ floor, ...b }) => {
      const fid = await idOf(ctx, floor, 'floor');
      let points = b.points;
      if (!points) { const v = await call<{ rooms: unknown[]; floor: { plan_w: number; plan_h: number } }>(ctx, 'GET', `/floors/${fid}/view`); const n = v.rooms.length; const w = Math.min(420, v.floor.plan_w / 3.5), h = Math.min(300, v.floor.plan_h / 3.5); const cols = Math.max(1, Math.floor(v.floor.plan_w / (w + 40))); const x = 60 + (n % cols) * (w + 40), y = 60 + Math.floor(n / cols) * (h + 40); points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
      return call(ctx, 'POST', `/floors/${fid}/rooms`, { ...b, points });
    }),
    T('create_floor_device', 'Place a device on a floor: rack, outlet, access point, printer, camera and so on. The ID is auto-generated from the type prefix unless given. Position defaults to inside the room.', z.object({ floor: ref, type: z.string().describe('Device type name or prefix, e.g. "Rack" or "TO"'), room: z.string().optional().describe('Room code on that floor; omit for DEFAULT'), code: z.string().optional(), name: z.string().optional(), x: z.number().optional(), y: z.number().optional(), rack_units: z.number().int().optional().describe('For racks only, default 42'), manufacturer: z.string().optional(), model: z.string().optional(), serial: z.string().optional(), notes: z.string().optional() }), async (i) => {
      const fid = await idOf(ctx, i.floor, 'floor');
      const types = await call<{ id: number; name: string; prefix: string; kind: string }[]>(ctx, 'GET', '/device-types');
      const t = types.find((x) => x.kind === 'floor' && (x.name.toLowerCase() === i.type.toLowerCase() || x.prefix.toUpperCase() === i.type.toUpperCase()));
      if (!t) throw new Error(`Unknown floor device type "${i.type}". Known: ${types.filter((x) => x.kind === 'floor').map((x) => `${x.name} (${x.prefix})`).join(', ')}`);
      const v = await call<{ rooms: { id: number; code: string; points: number[][] }[]; devices: { room_id: number | null }[]; floor: { plan_w: number; plan_h: number } }>(ctx, 'GET', `/floors/${fid}/view`);
      const room = i.room ? v.rooms.find((r) => r.code.toUpperCase() === i.room!.toUpperCase()) : undefined;
      if (i.room && i.room.toUpperCase() !== 'DEFAULT' && !room) throw new Error(`No room ${i.room} on that floor. Rooms: ${v.rooms.map((r) => r.code).join(', ') || 'none'}`);
      let x = i.x, y = i.y;
      if (x === undefined || y === undefined) { const n = v.devices.filter((d) => (d.room_id ?? null) === (room?.id ?? null)).length; const c = room ? [room.points.reduce((a, p) => a + p[0], 0) / room.points.length, room.points.reduce((a, p) => a + p[1], 0) / room.points.length] : [v.floor.plan_w / 2, v.floor.plan_h / 2]; x = Math.round(c[0] + (n % 5) * 60 - 120); y = Math.round(c[1] + 40 + Math.floor(n / 5) * 60); }
      const d = await call<DeviceRow>(ctx, 'POST', `/floors/${fid}/devices`, { device_type_id: t.id, code: i.code, name: i.name ?? '', room_id: room?.id ?? null, x, y, height_u: i.rack_units });
      if (i.manufacturer || i.model || i.serial || i.notes) await call(ctx, 'PATCH', `/devices/${d.id}`, { manufacturer: i.manufacturer, model: i.model, serial: i.serial, notes: i.notes });
      return { id: d.id, path: d.path };
    }),
    T('create_rack_device', 'Mount a device in a rack from a template (switch, patch panel, server, tray …). Rack unit defaults to the highest free unit that fits.', z.object({ rack: ref, template: z.string().describe('Template name, e.g. "Switch - 24 Ports - RJ45"'), code: z.string().optional(), name: z.string().optional(), position_u: z.number().int().optional().describe('Bottom rack unit'), slot_x: z.number().int().optional().describe('Horizontal start 0-100 for narrow devices'), manufacturer: z.string().optional(), model: z.string().optional(), serial: z.string().optional(), notes: z.string().optional() }), async (i) => {
      const rid = await idOf(ctx, i.rack, 'device');
      const tpls = await call<{ id: number; name: string; height_u: number; width_pct: number }[]>(ctx, 'GET', '/templates');
      const tpl = tpls.find((t) => t.name.toLowerCase() === i.template.toLowerCase()) ?? tpls.find((t) => t.name.toLowerCase().includes(i.template.toLowerCase()));
      if (!tpl) throw new Error(`Unknown template "${i.template}". Use list_templates or create_template.`);
      let pos = i.position_u;
      if (pos === undefined) {
        const r = await call<{ height_u: number; devices: { position_u: number; height_u: number; width_pct: number; is_tray: number }[] }>(ctx, 'GET', `/racks/${rid}`);
        const used = new Set<number>(); for (const d of r.devices) if (d.width_pct >= 100 && !d.is_tray) for (let u = d.position_u; u < d.position_u + d.height_u; u++) used.add(u);
        for (let u = r.height_u - tpl.height_u + 1; u >= 1; u--) { let ok = true; for (let k = 0; k < tpl.height_u; k++) if (used.has(u + k)) { ok = false; break; } if (ok) { pos = u; break; } }
        if (pos === undefined) throw new Error('No free rack units for this device');
      }
      const d = await call<DeviceRow>(ctx, 'POST', `/racks/${rid}/devices`, { template_id: tpl.id, code: i.code, name: i.name ?? '', position_u: pos, slot_x: i.slot_x });
      if (i.manufacturer || i.model || i.serial || i.notes) await call(ctx, 'PATCH', `/devices/${d.id}`, { manufacturer: i.manufacturer, model: i.model, serial: i.serial, notes: i.notes });
      return { id: d.id, path: d.path, position_u: pos };
    }),
    T('update_device', 'Change a device: ID, name, inventory fields, notes, rack unit, room, or rack units for a rack.', z.object({ device: ref, code: z.string().optional(), name: z.string().optional(), position_u: z.number().int().optional(), slot_x: z.number().int().optional(), room: z.string().optional().describe('Room code, or DEFAULT'), rack_units: z.number().int().optional(), manufacturer: z.string().optional(), model: z.string().optional(), serial: z.string().optional(), purchase_date: z.string().optional(), operation_start: z.string().optional(), notes: z.string().optional() }), async ({ device, room, rack_units, ...b }) => {
      const id = await idOf(ctx, device, 'device'); const body: Record<string, unknown> = { ...b, height_u: rack_units };
      if (room !== undefined) { const d = await call<{ floor_id: number }>(ctx, 'GET', `/devices/${id}`); const rooms = (await call<{ rooms: { id: number; code: string }[] }>(ctx, 'GET', `/floors/${d.floor_id}/view`)).rooms; const r = room.toUpperCase() === 'DEFAULT' ? null : rooms.find((x) => x.code.toUpperCase() === room.toUpperCase()); if (room.toUpperCase() !== 'DEFAULT' && !r) throw new Error(`No room ${room} on that floor. Rooms: ${rooms.map((x) => x.code).join(', ')}`); body.room_id = r ? r.id : null; }
      return compactDevice(await call(ctx, 'PATCH', `/devices/${id}`, body) as never);
    }),
    T('delete_device', 'Delete a device and its connections. Only call this after the user has explicitly confirmed the deletion in this conversation.', z.object({ device: ref, confirmed_by_user: z.literal(true) }), async (i) => { if (i.confirmed_by_user !== true) throw new Error('Deletion requires explicit confirmation from the user in this conversation'); return call(ctx, 'DELETE', `/devices/${await idOf(ctx, i.device, 'device')}`); }),
    T('add_port', 'Add a port to a device.', z.object({ device: ref, name: z.string().optional(), kind: z.string().default('rj45').describe('rj45, sfp, sfp+, lc, sc, power, wireless, other …'), face: z.enum(['front', 'rear']).default('front'), wireless_mode: z.enum(['client', 'broadcast']).optional() }), async ({ device, ...b }) => call(ctx, 'POST', `/devices/${await idOf(ctx, device, 'device')}/ports`, b)),
    T('update_port', 'Rename a port or assign its VLAN (by number), WLAN (by SSID), speed or notes.', z.object({ port: ref.describe('Port path like HQ/27/MDF/RK01/SW01/01'), name: z.string().optional(), vlan: z.number().int().nullable().optional(), wlan: z.string().nullable().optional(), speed: z.number().int().nullable().optional(), notes: z.string().optional() }), async ({ port, vlan, wlan, ...b }) => {
      const body: Record<string, unknown> = { ...b };
      if (vlan !== undefined) { if (vlan === null) body.vlan_id = null; else { const v = (await call<{ id: number; vid: number }[]>(ctx, 'GET', '/vlans')).find((x) => x.vid === vlan); if (!v) throw new Error(`VLAN ${vlan} does not exist; create it first with create_vlan`); body.vlan_id = v.id; } }
      if (wlan !== undefined) { if (wlan === null) body.wlan_id = null; else { const w = (await call<{ id: number; ssid: string }[]>(ctx, 'GET', '/wlans')).find((x) => x.ssid.toUpperCase() === wlan.toUpperCase()); if (!w) throw new Error(`WLAN ${wlan} does not exist; create it first with create_wlan`); body.wlan_id = w.id; } }
      return call(ctx, 'PATCH', `/ports/${await idOf(ctx, port, 'port')}`, body);
    }),
    T('connect', 'Connect two ports. type "building" is permanent cabling and must terminate at passive ports (patch panel or outlet). type "user" is a patch cable; a passive port needs its building connection first (the keystone rule). Use full port paths.', z.object({ from: ref, to: ref, type: z.enum(['building', 'user']).default('user'), color: z.string().optional(), label: z.string().optional(), cable_type: z.string().optional(), length_m: z.number().optional() }), async ({ from, to, ...b }) => call(ctx, 'POST', '/connections', { port_a_id: await idOf(ctx, from, 'port'), port_b_id: await idOf(ctx, to, 'port'), ...b })),
    T('disconnect', 'Remove the building or user connection on a port.', z.object({ port: ref, type: z.enum(['building', 'user']) }), async (i) => {
      const pid = await idOf(ctx, i.port, 'port'); const p = await call<{ user_peer: { connection_id: number } | null; building_peer: { connection_id: number } | null }>(ctx, 'GET', `/ports/${pid}`);
      const c = i.type === 'user' ? p.user_peer : p.building_peer;
      if (!c) throw new Error(`No ${i.type} connection on that port`); return call(ctx, 'DELETE', `/connections/${c.connection_id}`);
    }),
    T('create_vlan', 'Create a VLAN.', z.object({ vid: z.number().int(), name: z.string(), description: z.string().optional() }), (i) => call(ctx, 'POST', '/vlans', i)),
    T('create_wlan', 'Create a WLAN.', z.object({ ssid: z.string(), name: z.string().optional(), security: z.string().optional(), description: z.string().optional() }), (i) => call(ctx, 'POST', '/wlans', i)),
    T('create_template', 'Create a rack device template when no existing one matches the hardware. Ports: list them explicitly, or use ranges like "1-24:rj45" and "25-28:sfp+" (add ":rear" for back-side ports).', z.object({ name: z.string(), type: z.string().describe('Rack device type name, e.g. Switch, Patch Panel, Server'), brand: z.string().optional(), model: z.string().optional(), height_u: z.number().int().min(1).max(50).default(1), width_pct: z.number().int().default(100).describe('100 full, 50 half, 33 third …'), ports: z.array(z.string()).default([]).describe('e.g. ["1-24:rj45", "25-28:sfp+", "MGMT:rj45:rear", "PSU1:power:rear"]') }), async (i) => {
      const types = await call<{ id: number; name: string; kind: string }[]>(ctx, 'GET', '/device-types');
      const t = types.find((x) => x.kind === 'rack' && x.name.toLowerCase() === i.type.toLowerCase()); if (!t) throw new Error(`Unknown rack device type "${i.type}". Known: ${types.filter((x) => x.kind === 'rack').map((x) => x.name).join(', ')}`);
      const ports: { name: string; kind: string; face: string }[] = [];
      for (const spec of i.ports) { const [names, kind = 'rj45', face = 'front'] = spec.split(':'); const m = names.match(/^(\D*)(\d+)-(\d+)$/); if (m) { for (let n = Number(m[2]); n <= Number(m[3]); n++) ports.push({ name: `${m[1]}${String(n).padStart(2, '0')}`, kind, face }); } else ports.push({ name: names, kind, face }); }
      return call(ctx, 'POST', '/templates', { name: i.name, device_type_id: t.id, brand: i.brand ?? '', model: i.model ?? '', height_u: i.height_u, width_pct: i.width_pct, color: '', ports });
    }),
    T('create_device_type', 'Create a custom floor device type (e.g. PLC, Sensor) with a prefix and default ports.', z.object({ name: z.string(), prefix: z.string(), kind: z.enum(['floor', 'rack']).default('floor'), ports: z.array(z.string()).default(['01:rj45']).describe('e.g. ["01:rj45", "W01:wireless"]') }), (i) => call(ctx, 'POST', '/device-types', { name: i.name, prefix: i.prefix, kind: i.kind, icon: 'box', passive: false, ports: i.ports.map((s) => { const [name, kind = 'rj45'] = s.split(':'); return { name, kind, face: 'front', wireless_mode: kind === 'wireless' ? 'client' : null }; }) })),
  ];
}

/** Anthropic SDK tool-runner tools. */
export function makeTools(ctx: ToolContext) {
  return defineTools(ctx).map((t) => betaZodTool({ name: t.name, description: t.description, inputSchema: t.schema, eager_input_streaming: true, run: (input) => t.run(input) }));
}
/** OpenAI-compatible (OpenRouter) function definitions plus a runner map. */
export function openaiTools(ctx: ToolContext) {
  const specs = defineTools(ctx);
  const defs = specs.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) as Record<string, unknown> } }));
  return { defs, runners: new Map(specs.map((t) => [t.name, t])) };
}
