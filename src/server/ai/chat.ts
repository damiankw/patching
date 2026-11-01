import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Response } from 'express';
import { db, getMeta } from '../db.js';
import { makeTools } from './tools.js';
import { OPENROUTER_MODEL, attachmentParts, openrouterEnabled, runOpenRouter } from './openrouter.js';

export type Provider = 'openrouter' | 'anthropic';
/** openrouter when OPENROUTER_API_KEY is set (or RACKDOCS_AI_PROVIDER says so); anthropic only when chosen explicitly or it is the only key present. */
export function aiProvider(): Provider {
  const p = process.env.RACKDOCS_AI_PROVIDER;
  if (p === 'anthropic' || p === 'openrouter') return p;
  if (openrouterEnabled()) return 'openrouter';
  return 'anthropic';
}
export const ANTHROPIC_MODEL = process.env.RACKDOCS_AI_MODEL ?? 'claude-opus-5-5';
export function aiModel() { return aiProvider() === 'openrouter' ? OPENROUTER_MODEL : ANTHROPIC_MODEL; }
export const AI_EFFORT = (process.env.RACKDOCS_AI_EFFORT ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export function aiEnabled() { return aiProvider() === 'openrouter' ? openrouterEnabled() : !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN); }
export const SYSTEM_PROMPT = () => SYSTEM;

const SYSTEM = `You are the documentation assistant inside Rackdocs, a self-hosted network and rack documentation tool. You help the user build and maintain their documentation from natural language and from documents they upload (spreadsheets exported as CSV, PDFs, photos of racks, notes).

## How Rackdocs is organised
- Hierarchy: Location → Floor → Room → Device. Racks are floor devices that contain rack devices. Every resource has a short uppercase ID unique within its parent; the full path reads LOCATION/FLOOR/ROOM/DEVICE or LOCATION/FLOOR/ROOM/RACK/DEVICE, and a port is .../DEVICE/PORT. Devices outside any room are in the implicit room DEFAULT.
- IDs are generated from the device type prefix (SW01, PP01, TO01, RK01, SRV01 …) unless the user has their own scheme. Put any existing label or asset tag from the user's documents into the device *name* or *notes* so it stays searchable.
- Floor devices (on the plan): Rack, Telecommunications Outlet (TO), Access Point, Camera, Printer, Phone, Desktop, Laptop, Screen, ISP Uplink, Access Control Panel, 3D Printer, plus custom types. Rack devices come from templates (Switch - 24 Ports - RJ45, Patch Panel - 24 Ports - RJ45, Server - 1U, Rack Tray - 1U, …). Create a template when none matches.
- Rack units count from 1 at the bottom. Narrow templates (width_pct < 100) can share a unit; a Rack Tray holds shelf-mounted gear without blocking the unit.
- Two connection types. **building** = permanent in-wall cabling; it must terminate at passive ports (patch panel or outlet). **user** = patch cable. A passive port needs its building connection before it can be patched (the keystone rule). A complete path looks like SW01/01 →(user)→ PP01/01 →(building)→ TO01/01 →(user)→ PR01/01.
- VLANs are global and assigned to switch ports by VLAN number. WLANs are assigned to wireless ports by SSID.

## How to work
- Start by calling get_overview so you know what already exists; never create duplicates. Resolve things by path (HQ/27/MDF/RK01/SW01/01), not by guessing ids.
- Work in order: locations → floors → rooms → racks and floor devices → rack devices → building connections → user connections → VLANs on ports. Rooms can be placed without coordinates; devices land inside their room automatically.
- When importing a document: read it fully, list what you found (locations, racks, devices, cabling, networks) and anything ambiguous, then build it. State assumptions plainly instead of asking many questions; for small ambiguities pick the sensible default and say so. Ask before proceeding only when a wrong guess would create a lot of wrong data.
- Tool errors come back as text starting with ERROR; read them and adapt (for example create the building connection first, create a missing template, or use another rack unit).
- Never delete anything unless the user explicitly asked for that deletion in this conversation; then pass confirmed_by_user. Everything you change is recorded in the Activity Log under the user's name.
- Reply briefly in plain language: what you created or changed (with paths), what you could not do, and what the user should check. Do not list every tool call.`;

export interface Attachment { name: string; mime: string; data: string }
type Msg = Anthropic.Beta.BetaMessageParam;

function attachmentBlocks(atts: Attachment[]): Anthropic.Beta.BetaContentBlockParam[] {
  const out: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of atts) {
    if (a.mime === 'application/pdf') out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name } as Anthropic.Beta.BetaContentBlockParam);
    else if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mime)) out.push({ type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: a.data } });
    else out.push({ type: 'text', text: `<attachment name="${a.name}" type="${a.mime}">\n${Buffer.from(a.data, 'base64').toString('utf8').slice(0, 400_000)}\n</attachment>` });
  }
  return out;
}

export function listConversations(userId: number) {
  return db.prepare('SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
}
export function getConversation(userId: number, id: number) {
  const row = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?').get<{ id: number; title: string; messages: string; transcript: string; provider: string; created_at: string; updated_at: string }>(id, userId);
  return row ? { ...row, messages: JSON.parse(row.messages) as unknown[], transcript: JSON.parse(row.transcript) as Record<string, unknown>[] } : null;
}
export function createConversation(userId: number) {
  const id = db.prepare('INSERT INTO ai_conversations (user_id) VALUES (?)').run(userId).lastInsertRowid;
  return getConversation(userId, id)!;
}

/** Run one user turn and stream progress to the browser as server-sent events. */
export async function runTurn(opts: { userId: number; conversationId: number; text: string; attachments: Attachment[]; cookie: string; baseUrl: string; res: Response }) {
  const { res } = opts;
  const convo = getConversation(opts.userId, opts.conversationId);
  if (!convo) { res.status(404).json({ error: 'Conversation not found' }); return; }
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  const transcript = convo.transcript;
  const send = (ev: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const record = (ev: Record<string, unknown>) => { transcript.push(ev); send(ev); };
  const provider = aiProvider();
  const persist = (messages: unknown[]) => db.prepare("UPDATE ai_conversations SET messages = ?, transcript = ?, title = ?, provider = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(messages), JSON.stringify(transcript), convo.title === 'New conversation' ? opts.text.slice(0, 60) || convo.title : convo.title, provider, convo.id);
  // Message history is provider-specific; switching providers starts the model with a fresh context (the visible transcript is kept).
  const history = convo.provider === provider ? convo.messages : [];
  if (convo.provider && convo.provider !== provider && convo.messages.length) record({ type: 'error', message: `Provider changed from ${convo.provider} to ${provider}; the model does not see the earlier turns of this conversation.` });
  record({ type: 'user', text: opts.text, attachments: opts.attachments.map((a) => ({ name: a.name, mime: a.mime, size: Math.round(a.data.length * 0.75) })) });
  const account = `${getMeta('account_code', 'ACC')} (${getMeta('account_name', '')})`;
  const systemText = `${SYSTEM}\n\nThe account ID is ${account}.`;
  const ctx = { cookie: opts.cookie, baseUrl: opts.baseUrl, emit: record };

  if (provider === 'openrouter') {
    const parts = [...(await attachmentParts(opts.attachments)), { type: 'text' as const, text: opts.text || '(see attachments)' }];
    const msgs = [...(history as OpenAI.Chat.Completions.ChatCompletionMessageParam[]), { role: 'user' as const, content: parts }];
    persist(msgs);
    try {
      const r = await runOpenRouter({ system: systemText, messages: msgs, ctx, send, record });
      persist(r.messages);
      record({ type: 'done', usage: r.usage ? { input: r.usage.input, output: r.usage.output, cached: 0 } : null, model: r.model });
    } catch (err) {
      let message: string;
      if (err instanceof OpenAI.AuthenticationError) message = 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY on the server.';
      else if (err instanceof OpenAI.RateLimitError) message = 'Rate limited by OpenRouter. Try again in a moment.';
      else if (err instanceof OpenAI.NotFoundError) message = `OpenRouter does not know the model "${OPENROUTER_MODEL}". Set RACKDOCS_AI_MODEL to a model id from openrouter.ai/models that supports tool calling.`;
      else if (err instanceof OpenAI.BadRequestError) message = `OpenRouter rejected the request: ${err.message}`;
      else if (err instanceof OpenAI.APIConnectionError) message = 'Could not reach OpenRouter from the server. Check outbound network access.';
      else if (err instanceof OpenAI.APIError) message = `OpenRouter error ${err.status}: ${err.message}`;
      else message = err instanceof Error ? err.message : String(err);
      record({ type: 'error', message }); persist(msgs);
    } finally { res.end(); }
    return;
  }

  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [...attachmentBlocks(opts.attachments), { type: 'text', text: opts.text || '(see attachments)' }];
  const messages: Msg[] = [...(history as Msg[]), { role: 'user', content: userContent }];
  persist(messages);

  const client = new Anthropic();
  const tools = makeTools(ctx);
  let runner = client.beta.messages.toolRunner({
    model: ANTHROPIC_MODEL, max_tokens: 16000, stream: true, max_iterations: 80,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: AI_EFFORT },
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    tools, messages,
  });
  let finalText = ''; let final: Anthropic.Beta.BetaMessage | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const messageStream of runner) {
          let turnText = '';
          for await (const event of messageStream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') { turnText += event.delta.text; send({ type: 'text', text: event.delta.text }); }
          }
          const message = await messageStream.finalMessage();
          attempt = 0;
          if (turnText.trim()) record({ type: 'assistant', text: turnText });
          finalText = turnText || finalText; final = message;
          const hasToolUse = message.content.some((b) => b.type === 'tool_use');
          if (message.stop_reason === 'max_tokens' && hasToolUse) { record({ type: 'error', message: 'The model ran out of output tokens mid tool call. Ask it to continue.' }); break; }
          if (message.stop_reason === 'refusal') { record({ type: 'error', message: `The model declined this request${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : ''}.` }); break; }
        }
        break;
      } catch (err) {
        if (err instanceof Anthropic.APIError || attempt >= 2) throw err;
        runner = client.beta.messages.toolRunner({ ...runner.params });
      }
    }
    const msgs = [...runner.params.messages] as Msg[];
    if (final && (msgs.length === 0 || msgs[msgs.length - 1].role !== 'assistant')) msgs.push({ role: 'assistant', content: final.content });
    persist(msgs);
    record({ type: 'done', usage: final ? { input: final.usage.input_tokens, output: final.usage.output_tokens, cached: final.usage.cache_read_input_tokens ?? 0 } : null, model: final?.model ?? ANTHROPIC_MODEL });
  } catch (err) {
    let message: string;
    if (err instanceof Anthropic.AuthenticationError) message = 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.';
    else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited by the Anthropic API. Try again in a moment.';
    else if (err instanceof Anthropic.BadRequestError) message = `The API rejected the request: ${err.message}`;
    else if (err instanceof Anthropic.APIConnectionError) message = 'Could not reach the Anthropic API from the server. Check outbound network access.';
    else if (err instanceof Anthropic.APIError) message = `Anthropic API error ${err.status}: ${err.message}`;
    else message = err instanceof Error ? err.message : String(err);
    record({ type: 'error', message });
    persist([...runner.params.messages] as Msg[]);
  } finally {
    res.end();
  }
  void finalText;
}
