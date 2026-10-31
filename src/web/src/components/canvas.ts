/** Shared pan/zoom maths for the SVG editors. The SVG has viewBox 0 0 W H (meet) and a <g transform="translate(tx,ty) scale(k)">. */
export interface View { k: number; tx: number; ty: number }
export function fitScale(rect: { width: number; height: number }, W: number, H: number) { return Math.min(rect.width / W, rect.height / H) || 1; }
export function clientToPlan(e: { clientX: number; clientY: number }, svg: SVGSVGElement, W: number, H: number, v: View) {
  const r = svg.getBoundingClientRect(); const s = fitScale(r, W, H); const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
  const vx = (e.clientX - r.left - ox) / s, vy = (e.clientY - r.top - oy) / s;
  return { x: (vx - v.tx) / v.k, y: (vy - v.ty) / v.k, s };
}
export function planToClient(x: number, y: number, svg: SVGSVGElement, W: number, H: number, v: View) {
  const r = svg.getBoundingClientRect(); const s = fitScale(r, W, H); const ox = (r.width - W * s) / 2, oy = (r.height - H * s) / 2;
  return { x: (x * v.k + v.tx) * s + ox, y: (y * v.k + v.ty) * s + oy };
}
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = Math.min(12, Math.max(0.2, v.k * factor)); const f = k / v.k;
  return { k, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
}
export function centroid(pts: [number, number][]) { const n = pts.length || 1; return [pts.reduce((a, p) => a + p[0], 0) / n, pts.reduce((a, p) => a + p[1], 0) / n] as [number, number]; }
