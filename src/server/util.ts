import type { Request } from 'express';
import { z, type ZodType } from 'zod';
import { badRequest } from './errors.js';

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw badRequest(`${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  }
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const v = Number(req.params[name]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Invalid ${name}`);
  return v;
}

export const codeSchema = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_.\-\/]+$/, 'letters, digits, _ . - / only')
  .transform((s) => s.toUpperCase());
export const textSchema = z.string().trim().max(2000).default('');
export const nameSchema = z.string().trim().min(1).max(200);
