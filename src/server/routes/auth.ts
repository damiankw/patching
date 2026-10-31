import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, getMeta, setMeta } from '../db.js';
import { createSession, destroySession, requireRole } from '../auth.js';
import { HttpError, badRequest } from '../errors.js';
import { parse, codeSchema } from '../util.js';
import { logActivity } from '../activity.js';

export const authRouter = Router();
const userCount = () => db.prepare('SELECT COUNT(*) AS c FROM users').get<{ c: number }>()!.c;

authRouter.get('/setup/status', (_req, res) => res.json({ needsSetup: userCount() === 0 }));

authRouter.post('/setup', (req, res) => {
  if (userCount() > 0) throw new HttpError(409, 'Setup already completed');
  const body = parse(z.object({
    email: z.string().trim().email(), name: z.string().trim().min(1).max(100), password: z.string().min(8).max(200),
    account_code: codeSchema, account_name: z.string().trim().min(1).max(200),
  }), req.body);
  const r = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(body.email, body.name, bcrypt.hashSync(body.password, 10), 'admin');
  setMeta('account_code', body.account_code); setMeta('account_name', body.account_name);
  createSession(res, r.lastInsertRowid);
  req.user = { id: r.lastInsertRowid, email: body.email, name: body.name, role: 'admin' };
  logActivity(req, 'create', 'account', null, body.account_code, { name: body.account_name });
  res.json({ ok: true });
});

authRouter.post('/auth/login', (req, res) => {
  const body = parse(z.object({ email: z.string().trim(), password: z.string() }), req.body);
  const row = db.prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?').get<{ id: number; email: string; name: string; role: string; password_hash: string }>(body.email);
  if (!row || !bcrypt.compareSync(body.password, row.password_hash)) throw new HttpError(401, 'Invalid email or password');
  createSession(res, row.id);
  res.json({ id: row.id, email: row.email, name: row.name, role: row.role });
});
authRouter.post('/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });
authRouter.get('/auth/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  res.json({ ...req.user, account_code: getMeta('account_code', 'ACC'), account_name: getMeta('account_name', 'My organisation') });
});
authRouter.patch('/auth/password', requireRole('viewer'), (req, res) => {
  const body = parse(z.object({ current: z.string(), next: z.string().min(8).max(200) }), req.body);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get<{ password_hash: string }>(req.user!.id)!;
  if (!bcrypt.compareSync(body.current, row.password_hash)) throw badRequest('Current password is incorrect');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.next, 10), req.user!.id);
  res.json({ ok: true });
});
authRouter.get('/settings', requireRole('viewer'), (_req, res) => res.json({ account_code: getMeta('account_code', 'ACC'), account_name: getMeta('account_name', '') }));
authRouter.patch('/settings', requireRole('admin'), (req, res) => {
  const body = parse(z.object({ account_code: codeSchema.optional(), account_name: z.string().trim().min(1).max(200).optional() }), req.body);
  if (body.account_code) setMeta('account_code', body.account_code);
  if (body.account_name) setMeta('account_name', body.account_name);
  logActivity(req, 'update', 'account', null, getMeta('account_code'), { fields: Object.keys(body) });
  res.json({ account_code: getMeta('account_code'), account_name: getMeta('account_name') });
});
