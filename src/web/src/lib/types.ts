export type Role = 'admin' | 'editor' | 'viewer';
export interface User { id: number; email: string; name: string; role: Role; created_at?: string }
export interface Site { id: number; code: string; name: string; address: string; notes: string; floor_count?: number; rack_count?: number; device_count?: number }
export interface Floor { id: number; site_id: number; code: string; name: string; sort: number; rooms: Room[] }
export interface Room { id: number; floor_id: number; code: string; name: string; notes: string; racks: RackSummary[] }
export interface RackSummary { id: number; room_id: number; code: string; name: string; height_u: number; notes: string; device_count: number; used_u: number }
export interface SiteDetail extends Site { floors: Floor[] }
export interface RackRow { id: number; code: string; name: string; height_u: number; room_id: number; room_code: string; floor_id: number; floor_code: string; site_id: number; site_code: string; site_name: string; device_count: number; used_u: number }
export interface Vlan { id: number; site_id: number; vid: number; name: string; description: string; port_count?: number }
export interface DeviceTypePort { id?: number; name: string; kind: string; face: 'front' | 'rear'; sort?: number }
export interface DeviceType { id: number; name: string; manufacturer: string; model: string; category: string; height_u: number; passthrough: number; color: string; is_builtin: number; port_count?: number; device_count?: number; ports?: DeviceTypePort[] }
export interface Peer { connection_id: number; cable_type: string; color: string; label: string; length_m: number | null; port_id: number; port_name: string; port_face: string; port_kind: string; device_id: number; device_code: string; device_name: string; rack_id: number; rack_code: string; site_id: number; site_code: string }
export interface Port { id: number; device_id: number; name: string; kind: string; face: 'front' | 'rear'; sort: number; passthrough_port_id: number | null; vlan_id: number | null; vlan_vid: number | null; vlan_name: string | null; notes: string; connection: Peer | null }
export interface Device { id: number; rack_id: number; device_type_id: number; code: string; name: string; position_u: number; serial: string; ip_address: string; notes: string; type_name: string; category: string; height_u: number; color: string; passthrough: number; manufacturer: string; model: string; ports: Port[] }
export interface RackDetail { id: number; code: string; name: string; height_u: number; notes: string; room_id: number; room_code: string; room_name: string; floor_id: number; floor_code: string; floor_name: string; site_id: number; site_code: string; site_name: string; devices: Device[]; vlans: Vlan[] }
export interface PortSearchRow { id: number; name: string; kind: string; face: string; device_id: number; device_code: string; device_name: string; type_name: string; rack_id: number; rack_code: string; site_id: number; site_code: string; connected: number }
export interface TracePort { id: number; name: string; kind: string; face: string; device_id: number; device_code: string; device_name: string; type_name: string; category: string; rack_id: number; rack_code: string; site_id: number; site_code: string; vlan_vid: number | null; vlan_name: string | null }
export type TraceStep = { kind: 'port'; port: TracePort } | { kind: 'cable'; connection: { id: number; cable_type: string; color: string; label: string; length_m: number | null } } | { kind: 'through'; device_code: string };
export interface Trace { start_port_id: number; steps: TraceStep[]; endpoints: { a: TracePort; b: TracePort }; cable_count: number }
export interface ConnectionRow { id: number; port_a_id: number; port_b_id: number; cable_type: string; color: string; label: string; length_m: number | null; notes: string; created_at: string;
  a_port: string; a_face: string; a_kind: string; a_device_id: number; a_device: string; a_rack_id: number; a_rack: string; a_site_id: number; a_site: string;
  b_port: string; b_face: string; b_kind: string; b_device_id: number; b_device: string; b_rack_id: number; b_rack: string; b_site_id: number; b_site: string }
export interface ActivityRow { id: number; user_id: number | null; user_name: string; action: string; entity_type: string; entity_id: number | null; entity_label: string; details: Record<string, unknown>; created_at: string }
