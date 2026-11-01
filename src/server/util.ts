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
/** Optional text WITHOUT a default: for PATCH bodies, where a missing key must mean "leave unchanged". */
export const textOpt = z.string().trim().max(2000).optional();
export const dateOpt = z.string().trim().max(10).optional();
/**
 * Like schema.partial(), but strips `.default()` from every field. In zod 4 a default is applied
 * even under `.partial()`, which would silently reset fields that a PATCH did not mention.
 */
type Undefaulted<S> = S extends z.ZodDefault<infer I> ? I : S;
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodObject<{ [K in keyof T]: z.ZodOptional<Undefaulted<T[K]>> }> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(schema.shape) as [string, z.ZodTypeAny][]) {
    const inner = v instanceof z.ZodDefault ? (v as z.ZodDefault<z.ZodTypeAny>).removeDefault() : v;
    shape[k] = inner.optional();
  }
  return z.object(shape) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<Undefaulted<T[K]>> }>;
}
export const nameSchema = z.string().trim().min(1).max(200);
