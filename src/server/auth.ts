import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError } from './errors.js';

export type Role = 'admin' | 'editor' | 'viewer';
export interface SessionUser { id: number; email: string; name: string; role: Role }

declare global {
  namespace Express {
    interface Request { user?: SessionUser }
  }
}

const COOKIE = 'rd_session';
const SESSION_DAYS = 30;

export function createSession(res: Response, userId: number) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expires.toISOString());
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', expires, secure: process.env.COOKIE_SECURE === '1' });
}

export function destroySession(req: Request, res: Response) {
  const id = req.cookies?.[COOKIE];
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  res.clearCookie(COOKIE);
}

export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const id = req.cookies?.[COOKIE];
  if (id) {
    const row = db.prepare(`SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > datetime('now')`).get(id) as SessionUser | undefined;
    if (row) req.user = row;
  }
  next();
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Not signed in'));
    if (RANK[req.user.role] < RANK[min]) return next(new HttpError(403, `Requires ${min} role`));
    next();
  };
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
