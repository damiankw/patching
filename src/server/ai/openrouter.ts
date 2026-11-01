import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import { openaiTools, type ToolContext } from './tools.js';
import type { Attachment } from './chat.js';

export const OPENROUTER_MODEL = process.env.RACKDOCS_AI_MODEL ?? 'openai/gpt-4o';
export function openrouterEnabled() { return !!process.env.OPENROUTER_API_KEY; }

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function attachmentParts(atts: Attachment[]): Promise<OpenAI.Chat.Completions.ChatCompletionContentPart[]> {
  const out: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
  for (const a of atts) {
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.mime)) out.push({ type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } });
    else if (a.mime === 'application/pdf') {
      // Extract text server-side so it works with any model (scanned PDFs without a text layer come through empty).
      let text = '';
      try { const parser = new PDFParse({ data: Buffer.from(a.data, 'base64') }); const r = await parser.getText(); text = r.text; await parser.destroy?.(); } catch (e) { text = `(could not read PDF: ${e instanceof Error ? e.message : String(e)})`; }
      out.push({ type: 'text', text: `<attachment name="${a.name}" type="application/pdf">\n${(text || '(no text layer found; this PDF may be scanned images)').slice(0, 400_000)}\n</attachment>` });
    } else out.push({ type: 'text', text: `<attachment name="${a.name}" type="${a.mime}">\n${Buffer.from(a.data, 'base64').toString('utf8').slice(0, 400_000)}\n</attachment>` });
  }
  return out;
}

export interface RunResult { messages: Msg[]; usage: { input: number; output: number } | null; model: string }

/** Streams one assistant turn (with tool calls) over OpenRouter's OpenAI-compatible API. */
export async function runOpenRouter(opts: { system: string; messages: Msg[]; ctx: ToolContext; send: (ev: Record<string, unknown>) => void; record: (ev: Record<string, unknown>) => void }): Promise<RunResult> {
  const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1', defaultHeaders: { 'HTTP-Referer': 'https://github.com/damiankw/patching', 'X-Title': 'Rackdocs' } });
  const { defs, runners } = openaiTools(opts.ctx);
  const messages: Msg[] = [{ role: 'system', content: opts.system }, ...opts.messages];
  const acc = { input: 0, output: 0 }; let sawUsage = false; let model = OPENROUTER_MODEL;
  for (let iter = 0; iter < 80; iter++) {
    const stream = await client.chat.completions.create({ model: OPENROUTER_MODEL, messages, tools: defs, tool_choice: 'auto', stream: true, stream_options: { include_usage: true }, max_tokens: 16000 });
    let text = ''; const calls = new Map<number, { id: string; name: string; args: string }>(); let finish: string | null = null;
    for await (const chunk of stream) {
      if (chunk.usage) { sawUsage = true; acc.input += chunk.usage.prompt_tokens ?? 0; acc.output += chunk.usage.completion_tokens ?? 0; }
      if (chunk.model) model = chunk.model;
      const choice = chunk.choices?.[0]; if (!choice) continue;
      if (choice.delta?.content) { text += choice.delta.content; opts.send({ type: 'text', text: choice.delta.content }); }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id; if (tc.function?.name) cur.name += tc.function.name; if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(tc.index, cur);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (text.trim()) opts.record({ type: 'assistant', text });
    if (calls.size === 0) { messages.push({ role: 'assistant', content: text }); break; }
    const toolCalls = [...calls.values()].map((c) => ({ id: c.id || `call_${Math.random().toString(36).slice(2)}`, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } }));
    messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const spec = runners.get(tc.function.name);
      let result: string;
      if (!spec) result = `ERROR: unknown tool ${tc.function.name}`;
      else { let input: unknown; try { input = JSON.parse(tc.function.arguments || '{}'); } catch { input = null; } result = input === null ? 'ERROR: tool arguments were not valid JSON; try again' : await spec.run(input); }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
    if (finish === 'length') { opts.record({ type: 'error', message: 'The model ran out of output tokens. Ask it to continue.' }); break; }
  }
  return { messages: messages.slice(1), usage: sawUsage ? { ...acc } : null, model };
}
