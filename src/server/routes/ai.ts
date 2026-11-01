import { Router, json } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { idParam, parse } from '../util.js';
import { AI_MODEL, aiEnabled, createConversation, getConversation, listConversations, runTurn } from '../ai/chat.js';

export const aiRouter = Router();
aiRouter.use(requireRole('viewer'));

aiRouter.get('/ai/status', (_req, res) => res.json({ enabled: aiEnabled(), model: AI_MODEL }));
aiRouter.get('/ai/conversations', (req, res) => res.json(listConversations(req.user!.id)));
aiRouter.post('/ai/conversations', requireRole('editor'), (req, res) => res.status(201).json(createConversation(req.user!.id)));
aiRouter.get('/ai/conversations/:id', (req, res) => { const c = getConversation(req.user!.id, idParam(req)); if (!c) throw notFound('Conversation not found'); res.json({ id: c.id, title: c.title, transcript: c.transcript, created_at: c.created_at, updated_at: c.updated_at }); });
aiRouter.delete('/ai/conversations/:id', (req, res) => { db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(idParam(req), req.user!.id); res.json({ ok: true }); });

const msgBody = z.object({ text: z.string().max(50_000).default(''), attachments: z.array(z.object({ name: z.string().max(200), mime: z.string().max(100), data: z.string() })).max(10).default([]) });
aiRouter.post('/ai/conversations/:id/messages', requireRole('editor'), json({ limit: '40mb' }), async (req, res) => {
  if (!aiEnabled()) throw badRequest('The assistant is not configured. Set ANTHROPIC_API_KEY on the server and restart.');
  const b = parse(msgBody, req.body);
  if (!b.text.trim() && b.attachments.length === 0) throw badRequest('Say something or attach a file');
  for (const a of b.attachments) if (a.data.length > 30_000_000) throw badRequest(`${a.name} is too large (max ~20 MB)`);
  const port = Number(process.env.PORT ?? 3000);
  await runTurn({ userId: req.user!.id, conversationId: idParam(req), text: b.text, attachments: b.attachments, cookie: req.headers.cookie ?? '', baseUrl: `http://127.0.0.1:${port}`, res });
});
