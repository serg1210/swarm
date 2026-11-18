// Runs the official OpenAI Codex CLI headlessly, under the volunteer's own login.
// Codex applies its own OS sandbox: `workspace-write` confines writes to the work directory
// and disables network access.
//
// Unlike the Claude runner, which gets file tools only, Codex reads and edits through a shell
// inside that sandbox. The prompt tells it not to run the project's code; nothing but Codex's
// sandbox enforces that. Rate-limit windows are not read yet, so there is no quota reserve.
import { run } from '../util.mjs';

export const name = 'codex';
/** Tells the prompt builder this agent works through a shell rather than file tools. */
export const hasShell = true;

export function buildArgs({ cwd, model, readOnly = false }) {
  const args = ['exec', '--json', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '--skip-git-repo-check', '--ignore-user-config', '-C', cwd];
  // No web search and no ChatGPT apps: the task is done from the repository alone.
  args.push('-c', 'web_search="disabled"', '--disable', 'apps');
  if (model) args.push('--model', model);
  args.push('-'); // read the prompt from stdin
  return args;
}

export function parseStream(stdout) {
  const out = { ok: false, model: null, version: null, summary: '', rateLimit: null, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, durationMs: 0 } };
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const type = ev.type || ev.msg?.type;
    if (type === 'turn.completed' && ev.usage) {
      out.ok = true;
      out.usage.turns += 1;
      out.usage.inputTokens += (ev.usage.input_tokens || 0) + (ev.usage.cached_input_tokens || 0);
      out.usage.outputTokens += ev.usage.output_tokens || 0;
    } else if (type === 'item.completed' && ev.item?.type === 'agent_message') {
      out.summary = ev.item.text || out.summary;
    } else if (type === 'turn.failed' || type === 'error') {
      out.ok = false;
      out.error = ev.error?.message || ev.message || 'codex reported an error';
    }
  }
  return out;
}

export async function runAgent({ cwd, prompt, model, timeoutMs, readOnly }) {
  const started = Date.now();
  const res = await run('codex', buildArgs({ cwd, model, readOnly }), { cwd, input: prompt, timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const parsed = parseStream(res.stdout);
  parsed.usage.durationMs = Date.now() - started;
  if (res.timedOut) return { ...parsed, ok: false, error: 'agent timed out', runner: name };
  if (res.code !== 0 && !parsed.error) {
    parsed.ok = false;
    parsed.error = res.stderr.trim().split('\n').slice(-3).join(' ') || `codex exited ${res.code}`;
  }
  return { ...parsed, model: model || 'codex-default', runner: name };
}

export async function probeQuota() {
  return null; // Not implemented: Codex rate-limit windows are not parsed yet.
}
