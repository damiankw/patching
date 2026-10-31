import type { Request } from 'express';
import { db } from './db.js';

export function logActivity(req: Request, action: string, entityType: string, entityId: number | null, entityLabel: string, details: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO activity_log (user_id, user_name, action, entity_type, entity_id, entity_label, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user?.id ?? null, req.user?.name ?? 'system', action, entityType, entityId, entityLabel, JSON.stringify(details));
}
