import { Router, json } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse } from '../util.js';
import { DEFAULT_MODEL, aiConfig, aiEnabled, aiModel, aiProvider, createConversation, getConversation, listConversations, runTurn, testAi } from '../ai/chat.js';
import { getMeta, setMeta } from '../db.js';
import { codeSchema } from '../util.js';

export const aiRouter = Router();
aiRouter.use(requireRole('viewer'));

aiRouter.get('/ai/status', (_req, res) => res.json({ enabled: aiEnabled(), model: aiModel(), provider: aiProvider() }));
const mask = (k: string) => (k ? `${'•'.repeat(8)}${k.slice(-4)}` : '');
aiRouter.get('/ai/settings', requireRole('admin'), (_req, res) => {
  const cfg = aiConfig();
  res.json({ provider: cfg.provider, effort: cfg.effort, keySource: cfg.keySource, defaults: DEFAULT_MODEL,
    openrouter: { model: getMeta('ai_model_openrouter') || DEFAULT_MODEL.openrouter, key_masked: mask(getMeta('ai_key_openrouter') || process.env.OPENROUTER_API_KEY || ''), key_saved: !!getMeta('ai_key_openrouter') },
    anthropic: { model: getMeta('ai_model_anthropic') || DEFAULT_MODEL.anthropic, key_masked: mask(getMeta('ai_key_anthropic') || process.env.ANTHROPIC_API_KEY || ''), key_saved: !!getMeta('ai_key_anthropic') } });
});
aiRouter.patch('/ai/settings', requireRole('admin'), (req, res) => {
  const b = parse(z.object({ provider: z.enum(['openrouter', 'anthropic']).optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    openrouter_model: z.string().trim().max(200).optional(), openrouter_key: z.string().trim().max(500).optional(),
    anthropic_model: z.string().trim().max(200).optional(), anthropic_key: z.string().trim().max(500).optional() }), req.body);
  if (b.provider) setMeta('ai_provider', b.provider); if (b.effort) setMeta('ai_effort', b.effort);
  if (b.openrouter_model !== undefined) setMeta('ai_model_openrouter', b.openrouter_model); if (b.anthropic_model !== undefined) setMeta('ai_model_anthropic', b.anthropic_model);
  if (b.openrouter_key !== undefined) setMeta('ai_key_openrouter', b.openrouter_key); if (b.anthropic_key !== undefined) setMeta('ai_key_anthropic', b.anthropic_key);
  res.json({ ok: true, enabled: aiEnabled(), provider: aiProvider(), model: aiModel() });
});
aiRouter.post('/ai/test', requireRole('admin'), async (_req, res) => res.json(await testAi()));
void codeSchema;
aiRouter.get('/ai/conversations', (req, res) => res.json(listConversations(req.user!.id)));
aiRouter.post('/ai/conversations', requireRole('editor'), (req, res) => res.status(201).json(createConversation(req.user!.id)));
aiRouter.get('/ai/conversations/:id', (req, res) => { const c = getConversation(req.user!.id, idParam(req)); if (!c) throw notFound('Conversation not found'); res.json({ id: c.id, title: c.title, transcript: c.transcript, created_at: c.created_at, updated_at: c.updated_at }); });
aiRouter.delete('/ai/conversations/:id', (req, res) => { db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(idParam(req), req.user!.id); res.json({ ok: true }); });

const msgBody = z.object({ text: z.string().max(50_000).default(''), attachments: z.array(z.object({ name: z.string().max(200), mime: z.string().max(100), data: z.string() })).max(10).default([]) });
aiRouter.post('/ai/conversations/:id/messages', requireRole('editor'), json({ limit: '40mb' }), async (req, res) => {
  if (!aiEnabled()) throw badRequest('The assistant is not configured. An admin can add a provider API key on the Settings page.');
  const b = parse(msgBody, req.body);
  if (!b.text.trim() && b.attachments.length === 0) throw badRequest('Say something or attach a file');
  for (const a of b.attachments) if (a.data.length > 30_000_000) throw badRequest(`${a.name} is too large (max ~20 MB)`);
  const port = Number(process.env.PORT ?? 3000);
  await runTurn({ userId: req.user!.id, conversationId: idParam(req), text: b.text, attachments: b.attachments, cookie: req.headers.cookie ?? '', baseUrl: `http://127.0.0.1:${port}`, res });
});
