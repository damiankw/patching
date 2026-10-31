export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  return data as T;
}
export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  async upload<T>(url: string, file: File, extraQuery = ''): Promise<T> {
    const res = await fetch(`/api${url}?name=${encodeURIComponent(file.name)}${extraQuery}`, { method: 'POST', headers: { 'Content-Type': file.type || 'image/png' }, body: file, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error || `Upload failed (${res.status})`);
    return data as T;
  },
};
export function fmtDate(s: string | null | undefined) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => { const url = URL.createObjectURL(file); const img = new Image(); img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); }; img.onerror = reject; img.src = url; });
}
