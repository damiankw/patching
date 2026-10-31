import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse } from '../util.js';
import { logActivity } from '../activity.js';

export const usersRouter = Router();
usersRouter.use(requireRole('admin'));

const roleSchema = z.enum(['admin', 'editor', 'viewer']);

usersRouter.get('/', (_req, res) => {
  res.json(db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY name').all());
});

usersRouter.post('/', (req, res) => {
  const body = parse(z.object({
    email: z.string().trim().email(), name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(200), role: roleSchema,
  }), req.body);
  const r = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(body.email, body.name, bcrypt.hashSync(body.password, 10), body.role);
  logActivity(req, 'create', 'user', Number(r.lastInsertRowid), body.email, { role: body.role });
  res.status(201).json(db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(r.lastInsertRowid));
});

usersRouter.patch('/:id', (req, res) => {
  const id = idParam(req);
  const body = parse(z.object({
    email: z.string().trim().email().optional(), name: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(8).max(200).optional(), role: roleSchema.optional(),
  }), req.body);
  const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: string } | undefined;
  if (!existing) throw notFound('User not found');
  if (body.role && body.role !== 'admin' && existing.role === 'admin') {
    const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    if (admins <= 1) throw badRequest('Cannot demote the last admin');
  }
  const sets: string[] = []; const vals: unknown[] = [];
  if (body.email !== undefined) { sets.push('email = ?'); vals.push(body.email); }
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name); }
  if (body.role !== undefined) { sets.push('role = ?'); vals.push(body.role); }
  if (body.password !== undefined) { sets.push('password_hash = ?'); vals.push(bcrypt.hashSync(body.password, 10)); }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  if (body.password !== undefined) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  const row = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?').get(id) as { email: string };
  logActivity(req, 'update', 'user', id, row.email, { fields: Object.keys(body).filter((k) => k !== 'password'), passwordChanged: body.password !== undefined });
  res.json(row);
});

usersRouter.delete('/:id', (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw badRequest('You cannot delete your own account');
  const row = db.prepare('SELECT email, role FROM users WHERE id = ?').get(id) as { email: string; role: string } | undefined;
  if (!row) throw notFound('User not found');
  if (row.role === 'admin') {
    const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    if (admins <= 1) throw badRequest('Cannot delete the last admin');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logActivity(req, 'delete', 'user', id, row.email);
  res.json({ ok: true });
});
