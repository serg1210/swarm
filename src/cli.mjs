import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWARM_HOME, readJson, writeJson, run, which, log, step, ok, warn, fail, c, fmtUsd, fmtDuration, setLogSink, setProgressSink } from './util.mjs';
import { createIdentity, loadIdentity, exportIdentity } from './identity.mjs';
import { loadProjects, findTask, completedTasks } from './project.mjs';
import { resolveRepo, syncMirror, loadProjectsAt } from './repo.mjs';
import { pickSandbox, runSandboxed } from './sandbox.mjs';
import { getRunner, detectRunners } from './runners/index.mjs';
import { GitBoard } from './board/git.mjs';
import { GitHubBoard } from './board/github.mjs';
import { workOn, openTasks } from './worker.mjs';
import { reviewSubmission, alreadyReviewed } from './review.mjs';
import { mergeIfReady, withdrawIfRejected } from './merge.mjs';
import { checkSubmission, readLedger } from './receipt.mjs';
import { git, runVerify, describeFailure } from './verify.mjs';
import { leaderboard, renderLeaderboard } from './ledger.mjs';
import { lintRepo } from './lint.mjs';
import { readHistory, summarizeHistory } from './history.mjs';
import { buildBriefing } from './briefing.mjs';
import { openRepo } from './open.mjs';
import { flushOutbox, held } from './outbox.mjs';

const PKG = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
const BOOLEANS = new Set(['dry-run', 'json', 'force', 'unsafe-no-sandbox', 'help', 'include-mine', 'no-verify', 'all', 'remove', 'no-quota']);

const HELP = `${c.bold('swarm')} ${PKG.version}: put spare Claude Code / Codex quota to work on verified open-source tasks

${c.bold('Volunteer')}
  swarm init [--handle <name>] [--repo <repo>]   create your local identity
  swarm doctor                                   check tools, login, sandbox and that a finished task can be submitted
  swarm quota                                    show your current rate-limit windows
  swarm brief [--json]                           quota left, what the next run will do, and other projects you could choose
  swarm projects                                 list projects that opted in to Swarm
  swarm choose <repo>[#project]                  pick a project to donate to (--remove to drop it)
  swarm tasks [--repo <repo>]                    list tasks and their state
  swarm run [--task <project/task>] [options]    review one waiting submission, then work on a task and submit it
  swarm review [--task <project/task>]           independently verify someone else's submission
  swarm history [--json]                         show what you have donated so far
  swarm mcp                                    run as an MCP connector (Claude Code, Cowork, Codex, Hermes)

${c.bold('For an agent that does the task itself')} (cloud sessions, any host with a shell; prints JSON)
  swarm task begin [--task <project/task>] [--agent <name>]   claim a task, get a clone and instructions
  swarm task finish --session <id> --summary <text>            verify, sign, open the pull request
  swarm task abandon --session <id> [--reason <text>]          give the task back

${c.bold('Maintainer')}
  swarm verify [--project <id>] [--task <id>]    run a project's verify steps on the current checkout
  swarm lint                                     check .swarm/projects manifests and task files
  swarm sync                                     open a log issue for each new task, close finished ones
  swarm maintain                                 for an agent on a schedule: re-test, review and merge open submissions,
                                                 and close rejected ones so their tasks open again
  swarm reopen <project/task>                    offer a task again after too many rejected submissions parked it
  swarm merge <submission>                       re-verify, check review quorum, merge
  swarm ledger [--json]                          leaderboard from merged receipts
  swarm ci --base <sha>                          verification entry point for CI

${c.bold('Options for run / review')}
  --repo <owner/name | url | path>   project repository (default: the projects you chose, else ${PKG.swarm.defaultRepo})
  --project <id>                     only tasks from this project
  --runner <claude|codex|mock>       agent CLI to use (default: first one installed)
  --model <name>                     model passed to the agent CLI
  --max-tasks <n>                    stop after n tasks (default 1)
  --budget-usd <n>                   API-equivalent spend cap per agent run (default 3)
  --attempts <n>                     agent attempts per task, with verifier feedback (default 2)
  --timeout-minutes <n>              wall-clock cap per agent run (default 30)
  --reserve <0..1>                   share of your weekly quota never touched (default 0.2)
  --only-if-expiring <hours>         run only if your weekly window resets within this many hours
  --sandbox <auto|seatbelt|bwrap|docker>
  --dry-run                          do everything locally, push nothing
  --force                            skip the quota check
`;

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (BOOLEANS.has(key)) out[key] = true;
    else if (inline !== undefined) out[key] = inline;
    else if (i + 1 < argv.length) out[key] = argv[++i];
    else throw new Error(`--${key} needs a value`);
  }
  return out;
}

/** A handle that is already public: the GitHub login when gh is logged in, else "anon". */
export async function defaultHandle() {
  if (/^[A-Za-z0-9-]{1,39}$/.test(process.env.SWARM_HANDLE || '')) return process.env.SWARM_HANDLE;
  const res = await run('gh', ['api', 'user', '-q', '.login']).catch(() => ({ code: 1, stdout: '' }));
  const login = res.code === 0 ? res.stdout.trim() : '';
  return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : 'anon';
}

const configFile = () => path.join(SWARM_HOME, 'config.json');
export const loadConfig = () => readJson(configFile(), {});
export const saveConfig = (config) => writeJson(configFile(), config);

function needIdentity() {
  const id = loadIdentity();
  if (!id) throw new Error('No identity yet. Run `swarm init` first.');
  return id;
}

/**
 * The projects this volunteer donates to, as [{ repo, project }]. An explicit --repo wins;
 * otherwise the list built with `swarm choose`; otherwise the default repository.
 */
export function targets(args, config) {
  if (args.repo || process.env.SWARM_REPO) return [{ repo: args.repo || process.env.SWARM_REPO, project: args.project }];
  const chosen = (config.chosen || []).map((c) => {
    const [repo, project] = c.split('#');
    return { repo, project: args.project || project };
  });
  return chosen.length ? chosen : [{ repo: config.repo || PKG.swarm.defaultRepo, project: args.project }];
}

async function context(args, { needsIdentity = true, repoSpec } = {}) {
  const config = loadConfig();
  // First use on a machine makes the key; nobody should need a separate init step to donate.
  const identity = needsIdentity ? loadIdentity() || createIdentity({ handle: await defaultHandle() }) : loadIdentity();
  const repo = resolveRepo(repoSpec || targets(args, config)[0].repo);
  if (repo.kind === 'github' && !(await which('gh'))) throw new Error('GitHub repositories need the `gh` CLI (https://cli.github.com), logged in.');
  step(`Syncing ${repo.github || repo.url}`);
  const mirror = await syncMirror(repo);
  if (!mirror.projects.length) throw new Error('This repository has no Swarm projects (.swarm/projects/*/project.json).');
  const board = repo.kind === 'github' ? new GitHubBoard({ repo: repo.github, mirror, identity }) : new GitBoard({ mirror, identity });
  return { config, identity, repo, mirror, board };
}

async function runOptions(args, config, project) {
  const requested = args['unsafe-no-sandbox'] ? 'none' : args.sandbox || config.sandbox || 'auto';
  return {
    sandbox: await pickSandbox({ requested, project }),
    model: args.model || config.model,
    effort: args.effort,
    budgetUsd: Number(args['budget-usd'] ?? config.budgetUsd ?? 3),
    attempts: Number(args.attempts ?? 2),
    timeoutMinutes: Number(args['timeout-minutes'] ?? 30),
    dryRun: Boolean(args['dry-run']),
  };
}

async function pickRunner(args, config) {
  const name = args.runner || config.runner || (await detectRunners())[0];
  if (!name) throw new Error('No agent CLI found. Install Claude Code (`claude`) or Codex (`codex`) and log in.');
  return getRunner(name);
}

function describeWindow(label, w) {
  if (!w) return `${label}: unknown`;
  const used = w.utilization == null ? 'unknown' : `${Math.round(w.utilization * 100)}% used`;
  const reset = w.resetsAt ? `, resets in ${fmtDuration(new Date(w.resetsAt) - Date.now())}` : '';
  return `${label}: ${used}${reset}`;
}

/** Decide whether donating now would eat into quota the volunteer needs. */
export function quotaDecision(rateLimit, { reserve = 0.2, onlyIfExpiringHours } = {}) {
  if (!rateLimit) return { go: true, reason: 'quota windows unknown for this runner' };
  if (rateLimit.status === 'rejected') return { go: false, reason: 'you are currently rate limited' };
  const cap = 1 - reserve;
  const { weekly, fiveHour } = rateLimit;
  if (weekly?.utilization != null && weekly.utilization >= cap) return { go: false, reason: `weekly quota is ${Math.round(weekly.utilization * 100)}% used; your reserve starts at ${Math.round(cap * 100)}%` };
  if (fiveHour?.utilization != null && fiveHour.utilization >= cap) return { go: false, reason: `5-hour window is ${Math.round(fiveHour.utilization * 100)}% used; your reserve starts at ${Math.round(cap * 100)}%` };
  if (onlyIfExpiringHours != null) {
    if (!weekly?.resetsAt) return { go: false, reason: 'weekly reset time unknown, and --only-if-expiring was set' };
    const hours = (new Date(weekly.resetsAt) - Date.now()) / 3_600_000;
    if (hours > onlyIfExpiringHours) return { go: false, reason: `weekly window resets in ${Math.round(hours)}h, more than ${onlyIfExpiringHours}h away` };
  }
  return { go: true, reason: 'within your limits' };
}

/**
 * Gathers what the briefing shows: the quota windows, the projects that opted in, the ones the
 * user chose, and what is open in each. Reaching a repository can fail; that project is then
 * listed as unreachable instead of failing the whole briefing.
 */
export async function gatherBriefing({ args = {}, probeQuota = true, identity } = {}) {
  const config = loadConfig();
  const cloud = process.env.CLAUDE_CODE_REMOTE === 'true';
  const reserve = Number(args.reserve ?? config.reserve ?? 0.2);
  let rateLimit = null;
  // A cloud session has no quota windows to read, and asking would itself spend quota there.
  if (probeQuota && !cloud && (await detectRunners()).includes('claude')) {
    rateLimit = await getRunner('claude').probeQuota().catch(() => null);
  }
  const decision = rateLimit ? quotaDecision(rateLimit, { reserve }) : null;
  const { projects: registry } = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.json'));
  const list = targets(args, config);
  const chosen = list.map((t) => (t.project ? `${t.repo}#${t.project}` : t.repo));
  const usingDefault = !(args.repo || process.env.SWARM_REPO) && !(config.chosen || []).length;
  const tasksByRepo = {};
  const activity = {};
  const access = {};
  for (const spec of new Set([...list.map((t) => t.repo), ...registry.map((p) => p.repo)])) {
    try {
      const { mirror, board } = await openRepo(spec, identity);
      // Could a finished task be submitted from here? Asked first, so a run that could not is
      // never started, and so the reason given is this one rather than whatever fails next.
      access[spec] = await board.access();
      const claims = await board.claims(mirror.projects);
      tasksByRepo[spec] = openTasks(mirror.projects, mirror.dir, claims, { unpublished: board.unpublished, rejected: board.rejected }).map((r) => ({
        project: r.project.id,
        projectName: r.project.name,
        projectDescription: r.project.description,
        ref: r.task.ref,
        title: r.task.title,
        size: r.task.size,
        state: r.state,
      }));
      // Agents on each project now: submitted and waiting for review, or holding a live claim.
      const submitted = await board.submissions();
      const has = (taskRef, worker) => submitted.some((x) => x.taskRef === taskRef && String(worker).startsWith(String(x.worker).slice(0, 8)));
      for (const p of mirror.projects) {
        const finishing = submitted.filter((x) => x.taskRef.startsWith(`${p.id}/`)).length;
        let working = 0;
        for (const [taskRef, list] of claims) if (taskRef.startsWith(`${p.id}/`)) working += list.filter((c) => !c.submitted && !has(taskRef, c.worker)).length;
        activity[`${spec}#${p.id}`] = { finishing, working };
      }
    } catch (err) {
      tasksByRepo[spec] = { error: String(err.message).split('\n')[0] };
    }
  }
  return buildBriefing({ rateLimit, decision, reserve, cloud, registry, chosen, usingDefault, tasksByRepo, activity, access, waiting: held().length });
}

/** Options for the protected merge step, from the command line. */
async function mergeOptions(ctx, sub, args) {
  const project = ctx.mirror.projects.find((p) => p.id === sub.taskRef.split('/')[0]);
  const opts = await runOptions(args, ctx.config, project);
  return { sandbox: opts.sandbox, force: Boolean(args.force), dryRun: Boolean(args['dry-run']) };
}

const commands = {
  async init(args) {
    // The handle is published in every receipt, so never default it to the OS account name.
    const identity = createIdentity({ handle: args.handle || (await defaultHandle()) });
    const config = { ...loadConfig() };
    if (args.repo) config.repo = args.repo;
    if (args.runner) config.runner = args.runner;
    writeJson(configFile(), config);
    ok(`Worker ${c.bold(identity.id)} (${identity.handle})`);
    log(c.dim(`  Key stored in ${path.join(SWARM_HOME, 'identity.json')}. It signs your receipts and never leaves this machine.`));
    log(`\nNext: ${c.bold('swarm doctor')}, then ${c.bold('swarm tasks')} and ${c.bold('swarm run')}.`);
  },

  async doctor(args = {}) {
    const line = (good, label, detail = '') => log(`${good ? c.green('✓') : c.red('✗')} ${label}${detail ? c.dim('  ' + detail) : ''}`);
    let problems = 0;
    const check = (good, label, detail) => {
      if (!good) problems++;
      line(good, label, detail);
    };
    check(Number(process.versions.node.split('.')[0]) >= 20, `node ${process.versions.node}`, 'need 20 or newer');
    check(Boolean(await which('git')), 'git');
    const gh = await which('gh');
    if (process.env.CLAUDE_CODE_REMOTE === 'true') {
      // A cloud session has no gh login of its own: its GitHub connection is injected outside the VM.
      check(Boolean(gh), 'gh installed', "GitHub access comes from this cloud session's connection, for the repositories attached to it");
    } else {
      const auth = gh ? await run('gh', ['auth', 'status']) : { code: 1 };
      check(gh && auth.code === 0, 'gh logged in', 'needed for GitHub-hosted projects');
    }
    const found = await detectRunners();
    check(found.length > 0, `agent CLI: ${found.join(', ') || 'none'}`, 'claude or codex, logged in with your own plan');
    try {
      const mode = await pickSandbox({});
      // A cloud session's VM is the sandbox: there is nothing inside it to isolate from, so the
      // self-test below (which expects the home directory to be out of reach) does not apply.
      if (mode === 'cloud-vm') throw Object.assign(new Error('cloud-vm'), { cloudVm: true });
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-doctor-'));
      // Judged from outside: some sandboxes show an empty, writable stand-in for the home
      // directory, so a write "succeeding" inside proves nothing either way.
      const home = os.homedir();
      const escape = path.join(home, '.swarm-escape-test');
      const secret = fs.readdirSync(home).map((n) => path.join(home, n)).find((p) => {
        try {
          return fs.statSync(p).isFile() && fs.statSync(p).size > 0;
        } catch {
          return false;
        }
      });
      const probe = `echo ok > inside.txt || exit 3; echo x > ${JSON.stringify(escape)} 2>/dev/null; ${secret ? `cat ${JSON.stringify(secret)} >/dev/null 2>&1 && exit 4; ` : ''}exit 0`;
      const res = await runSandboxed(probe, { workDir: tmp, mode, timeoutMs: 20_000 });
      const wroteInside = fs.existsSync(path.join(tmp, 'inside.txt'));
      const escaped = fs.existsSync(escape);
      if (escaped) fs.rmSync(escape, { force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
      const why = escaped
        ? 'a write to the home directory got out'
        : res.code === 4
          ? 'a file in the home directory was readable'
          : !wroteInside || res.code !== 0
            ? `could not run in the work directory: ${(res.stderr || '').trim().split('\n').pop() || `exit ${res.code}`}`
            : '';
      check(!why, `sandbox: ${mode}`, why ? `self-test failed: ${why}` : 'home directory hidden, writes confined');
    } catch (err) {
      if (err.cloudVm) check(true, 'sandbox: cloud-vm', "this session's disposable VM is the sandbox; checks run in it directly");
      else check(false, 'sandbox', err.message);
    }
    // The one question that decides whether a run is worth starting: could its result be submitted?
    const spec = targets(args, loadConfig())[0].repo;
    try {
      const { board } = await openRepo(spec, loadIdentity());
      const access = await board.access();
      check(access.ok, `can submit to ${spec}`, access.ok ? (access.route === 'fork' ? 'through your fork' : '') : access.reason);
    } catch (err) {
      check(false, `can submit to ${spec}`, String(err.message).split('\n')[0]);
    }
    const waiting = held().length;
    if (waiting) line(true, `${waiting} finished task${waiting === 1 ? '' : 's'} waiting to be submitted`, 'goes out at the start of the next run');
    // Not a failure: a fresh machine or cloud VM gets its key on first use.
    const id = loadIdentity();
    line(true, id ? `identity ${id.id} (${id.handle})` : 'identity: none yet', id ? '' : 'created automatically on the first run');
    if (problems) process.exitCode = 1;
  },

  async quota(args) {
    const runner = await pickRunner(args, loadConfig());
    step(`Asking ${runner.name} for your rate-limit windows (one tiny request)`);
    const rl = await runner.probeQuota();
    if (!rl) return warn(`${runner.name} does not report quota windows here.`);
    if (args.json) return log(JSON.stringify({ ...rl, decision: quotaDecision(rl, { reserve: Number(args.reserve ?? 0.2) }) }, null, 2));
    log(describeWindow('5-hour window', rl.fiveHour));
    log(describeWindow('weekly window', rl.weekly));
    const d = quotaDecision(rl, { reserve: Number(args.reserve ?? 0.2) });
    log(d.go ? c.green('→ Room to donate.') : c.yellow(`→ Not donating now: ${d.reason}.`));
  },

  /** Before a run: how much quota is left, what the next run will do, and what else could be chosen. */
  async brief(args) {
    const identity = loadIdentity() || createIdentity({ handle: await defaultHandle() });
    const briefing = await gatherBriefing({ args, probeQuota: !args['no-quota'], identity });
    if (args.json) return log(JSON.stringify(briefing, null, 2));
    for (const line of briefing.text) log(line);
    log('');
    for (const p of briefing.projects) {
      const count = p.openTasks == null ? 'unreachable' : `${p.openTasks} open`;
      log(`${p.chosen ? c.green('●') : c.dim('○')} ${c.bold(p.name)} ${c.dim(p.id)}  ${count}`);
      if (p.description) log(c.dim(`    ${p.description}`));
    }
    log(c.dim('\nChange project with: swarm choose <owner/name>#<project>'));
  },

  /** Projects that opted in, from the registry shipped with this release. */
  async projects(args) {
    const { projects } = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.json'));
    if (args.json) return log(JSON.stringify(projects, null, 2));
    log(c.bold('Projects that opted in to Swarm') + c.dim('  (choose one with: swarm choose <repo>#<project>)\n'));
    for (const p of projects) log(`  ${`${p.repo}#${p.project}`.padEnd(28)} ${p.name}: ${p.description}`);
  },

  /**
   * The agent-does-it path over a shell, for cloud sessions and any host without the connector.
   * stdout carries one JSON document; progress goes to stderr.
   */
  async task(args) {
    setLogSink((line) => process.stderr.write(line + '\n'));
    const out = (value, failed = false) => {
      process.stdout.write(JSON.stringify(value, null, 2) + '\n');
      if (failed) process.exitCode = 1;
    };
    const sessions = await import('./session.mjs');
    const identity = loadIdentity() || createIdentity({ handle: await defaultHandle() });
    const action = args._[0];
    if (action === 'begin') {
      return out(await sessions.beginSession({ identity, targets: targets(args, loadConfig()), taskRef: args.task, agent: args.agent, model: args.model, mode: 'shell' }));
    }
    if (action === 'status') return out({ unfinishedSession: sessions.activeSession()?.id || null });
    if (!args.session) throw new Error('--session <id> is required (it is in the output of `swarm task begin`).');
    if (action === 'finish') {
      const res = await sessions.finishSession(args.session, { identity, summary: args.summary });
      return out(res, !res?.ok);
    }
    if (action === 'abandon') return out(await sessions.abandonSession(args.session, { identity, reason: args.reason }));
    throw new Error('Usage: swarm task begin | finish | abandon | status');
  },

  /** Print this worker's key so a cloud environment can sign as the same worker (SWARM_IDENTITY). */
  async identity(args) {
    const id = needIdentity();
    if (args._[0] !== 'export') return log(`${id.id} (${id.handle})`);
    log(exportIdentity(id));
  },

  async choose(args) {
    const config = loadConfig();
    const chosen = new Set(config.chosen || []);
    const spec = args._[0];
    if (spec) {
      resolveRepo(spec.split('#')[0]); // validates the form
      if (args.remove) chosen.delete(spec);
      else chosen.add(spec);
      writeJson(configFile(), { ...config, chosen: [...chosen] });
    }
    if (!chosen.size) return log(`No projects chosen yet. Your quota goes to ${c.bold(PKG.swarm.defaultRepo)} by default.\nAdd one with: swarm choose <owner/name>[#project]`);
    log(c.bold('Your quota goes to:'));
    for (const x of chosen) log(`  ${x}`);
  },

  async tasks(args) {
    const all = [];
    for (const target of targets(args, loadConfig())) {
      const { mirror, board, repo } = await context(args, { needsIdentity: false, repoSpec: target.repo });
      const claims = await board.claims(mirror.projects);
      const rows = openTasks(mirror.projects, mirror.dir, claims, { projectId: target.project, unpublished: board.unpublished, rejected: board.rejected });
      all.push(...rows.map((r) => ({ repo: repo.github || repo.url, ref: r.task.ref, title: r.task.title, size: r.task.size, state: r.state })));
      if (args.json) continue;
      for (const project of mirror.projects) {
        if (target.project && project.id !== target.project) continue;
        log(`\n${c.bold(project.name || project.id)} ${c.dim(`(${project.id})`)}  ${project.description || ''}`);
        for (const r of rows.filter((x) => x.project.id === project.id)) {
          const tag = { open: c.green('open       '), claimed: c.yellow('claimed    '), done: c.dim('done       '), unpublished: c.dim('unpublished'), stuck: c.red('stuck      ') }[r.state] || c.dim(r.state.padEnd(11));
          log(`  ${tag} ${r.task.ref.padEnd(30)} ${c.dim(`[${r.task.size}]`)} ${r.task.title}`);
        }
      }
      if (rows.some((r) => r.state === 'stuck')) log(c.dim('\n  stuck: reviewers rejected several submissions for this task. A maintainer fixes the task, then runs `swarm reopen <project/task>`.'));
      if (rows.some((r) => r.state === 'unpublished')) log(c.dim('\n  unpublished: the task file is merged but has no log issue yet. A maintainer runs `swarm sync`.'));
    }
    if (args.json) log(JSON.stringify(all, null, 2));
    else log();
  },

  async run(args) {
    const ctx = await context(args);
    const runner = await pickRunner(args, ctx.config);
    const reserve = Number(args.reserve ?? ctx.config.reserve ?? 0.2);
    const onlyIfExpiringHours = args['only-if-expiring'] != null ? Number(args['only-if-expiring']) : undefined;
    const guard = (rl) => quotaDecision(rl, { reserve, onlyIfExpiringHours });

    if (!args.force && runner.name !== 'mock') {
      step('Checking your quota');
      const rl = await runner.probeQuota();
      if (rl) log(c.dim(`  ${describeWindow('5-hour', rl.fiveHour)}; ${describeWindow('weekly', rl.weekly)}`));
      const d = guard(rl);
      if (!d.go) return warn(`Not donating now: ${d.reason}. Use --force to override.`);
    }

    // Work verified on an earlier run that could not be submitted then goes out first.
    if (!args['dry-run']) await flushOutbox({ identity: ctx.identity });

    const maxTasks = Number(args['max-tasks'] ?? 1);
    const total = { submitted: 0, failed: 0, held: 0, reviewed: 0, costUsd: 0 };
    // Spread work over the chosen projects: start somewhere random, then go round.
    const list = targets(args, ctx.config);
    const start = Math.floor(Math.random() * list.length);
    let stop = false;
    for (let i = 0; i < list.length && !stop && total.submitted + total.failed + total.held < maxTasks; i++) {
      const target = list[(start + i) % list.length];
      const here = i === 0 && list.length === 1 ? ctx : await context(args, { repoSpec: target.repo });
      // Nobody's quota goes into a task whose result could not be submitted from here.
      const access = args['dry-run'] ? { ok: true } : await here.board.access({ prepare: true });
      if (!access.ok) {
        warn(`Cannot submit from here: ${access.reason}. No task was started and no quota was spent on one.`);
        continue;
      }
      // Every merge waits for another worker's review, and only runs like this one produce them,
      // so a run first reviews one waiting submission.
      for (const sub of await here.board.submissions()) {
        const project = here.mirror.projects.find((p) => p.id === sub.taskRef.split('/')[0]);
        if (sub.mine || !project || (target.project && project.id !== target.project) || (await alreadyReviewed(here, sub))) continue;
        const res = await reviewSubmission({ ...here, runner, sub, opts: await runOptions(args, here.config, project) }).catch((err) => (warn(`Review of ${sub.taskRef} failed: ${err.message.split('\n')[0]}`), { status: 'error' }));
        total.costUsd += res.usage?.costUsd || 0;
        if (res.status === 'reviewed' || res.status === 'dry-run') total.reviewed++;
        if (res.status !== 'invalid') break; // an invalid one cost nothing; anything else spent quota
      }
      while (total.submitted + total.failed + total.held < maxTasks) {
        const claims = await here.board.claims(here.mirror.projects);
        const candidates = openTasks(here.mirror.projects, here.mirror.dir, claims, { projectId: target.project, taskRef: args.task, unpublished: here.board.unpublished, rejected: here.board.rejected }).filter((r) => r.state === 'open');
        if (!candidates.length) {
          warn(args.task ? `Task ${args.task} is not open in ${target.repo}.` : `No open tasks in ${target.repo} right now.`);
          break;
        }
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const opts = await runOptions(args, here.config, pick.project);
        const res = await workOn({ ...here, runner, project: pick.project, task: pick.task, opts });
        total.costUsd += res.usage?.costUsd || 0;
        if (res.status === 'submitted' || res.status === 'dry-run') total.submitted++;
        else if (res.status === 'held') total.held++;
        else if (res.status === 'failed') total.failed++;
        if (args.task) {
          stop = true;
          break;
        }
        if (!args.force && res.rateLimit) {
          const d = guard(res.rateLimit);
          if (!d.go) {
            warn(`Stopping: ${d.reason}.`);
            stop = true;
            break;
          }
        }
      }
    }
    log(`\n${c.bold('Session')}: ${total.reviewed ? `${total.reviewed} reviewed, ` : ''}${total.submitted} submitted, ${total.held ? `${total.held} kept for the next run, ` : ''}${total.failed} failed, ${fmtUsd(total.costUsd)} API-equivalent quota used.`);
  },

  async history(args) {
    const entries = readHistory(path.join(SWARM_HOME, 'history.jsonl'));
    const summary = summarizeHistory(entries);
    if (args.json) return log(JSON.stringify(summary, null, 2));
    log(`${c.bold('Donated')}: ${summary.submitted} submitted, ${summary.failed} failed, ${fmtUsd(summary.costUsd)} API-equivalent quota used.`);
    for (const [name, r] of Object.entries(summary.byRunner)) log(c.dim(`  ${name}: ${r.submitted} submitted, ${r.failed} failed, ${fmtUsd(r.costUsd)}`));
    if (!entries.length) return log(c.dim('Nothing yet. Try `swarm run`.'));
    log(`\n${c.bold('Most recent')}`);
    for (const e of entries.slice(-10).reverse()) log(`  ${String(e.ts || '').slice(0, 19)}  ${String(e.status || '?').padEnd(10)} ${e.task || ''} ${c.dim(e.repo || '')}`);
  },

  async sync(args) {
    const ctx = await context(args);
    if (ctx.board.kind !== 'github') return ok('Nothing to sync: on a plain git remote every merged task file is claimable as is.');
    const done = new Map(ctx.mirror.projects.map((p) => [p.id, completedTasks(ctx.mirror.dir, p.id)]));
    const res = await ctx.board.sync(ctx.mirror.projects, done);
    for (const o of res.opened) ok(`Opened log issue for ${o.ref} → ${o.url}`);
    for (const x of res.closed) ok(`Closed log issue for ${x.ref}`);
    if (!res.opened.length && !res.closed.length) ok('Task issues are up to date.');
  },

  async review(args) {
    const ctx = await context(args);
    const runner = await pickRunner(args, ctx.config);
    let subs = await ctx.board.submissions();
    if (!args['include-mine']) subs = subs.filter((s) => !s.mine);
    if (args.task) subs = subs.filter((s) => s.taskRef === args.task || String(s.id) === String(args.task));
    const todo = [];
    for (const s of subs) {
      if (args.force || !(await alreadyReviewed(ctx, s))) todo.push(s);
    }
    if (!todo.length) return warn('Nothing to review.');
    const max = Number(args['max-tasks'] ?? 1);
    for (const sub of todo.slice(0, max)) {
      const project = ctx.mirror.projects.find((p) => p.id === sub.taskRef.split('/')[0]);
      const opts = await runOptions(args, ctx.config, project);
      await reviewSubmission({ ...ctx, runner, sub, opts });
    }
  },

  async merge(args) {
    const id = args._[0];
    if (!id) throw new Error('Usage: swarm merge <submission id>   (see `swarm review` or the PR number)');
    const ctx = await context(args);
    const sub = (await ctx.board.submissions()).find((s) => String(s.id) === String(id) || s.taskRef === id);
    if (!sub) throw new Error(`No open submission "${id}".`);
    const res = await mergeIfReady(ctx, sub, await mergeOptions(ctx, sub, args));
    if (!res.merged) throw new Error(res.reason);
  },

  /**
   * The maintainer's pass, for an agent to run on a schedule: for every open submission,
   * re-test it, review it if it is someone else's and not yet reviewed by this worker, and merge
   * it once the project's rules are met. Nothing here lets a worker approve its own submission.
   * A submission that a maintainer's review rejected is closed, so its task is offered again.
   */
  async maintain(args) {
    const ctx = await context(args);
    const runner = await pickRunner(args, ctx.config);
    const subs = (await ctx.board.submissions()).slice(0, Number(args.max ?? 5));
    if (!subs.length) return ok('No open submissions.');
    const done = { reviewed: 0, merged: 0, waiting: 0, closed: 0, refused: 0 };
    for (const sub of subs) {
      let justVerified = false;
      try {
        if (!sub.mine && !(await alreadyReviewed(ctx, sub))) {
          const project = ctx.mirror.projects.find((p) => p.id === sub.taskRef.split('/')[0]);
          const res = await reviewSubmission({ ...ctx, runner, sub, opts: await runOptions(args, ctx.config, project) });
          if (res.status === 'reviewed') done.reviewed++;
          justVerified = res.verdict === 'approve';
        }
        const res = await mergeIfReady(ctx, sub, { ...(await mergeOptions(ctx, sub, args)), runChecks: !justVerified });
        if (res.merged) done.merged++;
        else if (res.rejected && !args['dry-run'] && (await withdrawIfRejected(ctx, sub, res)).withdrawn) done.closed++;
        else {
          warn(`${sub.taskRef} (${sub.id}): ${res.reason.split('\n')[0]}`);
          if (res.waiting) done.waiting++;
          else done.refused++;
        }
      } catch (err) {
        done.refused++;
        fail(`${sub.taskRef} (${sub.id}): ${err.message.split('\n')[0]}`);
      }
    }
    log(`\n${c.bold('Maintain')}: ${done.reviewed} reviewed, ${done.merged} merged, ${done.waiting} waiting for another reviewer, ${done.closed} closed after rejection, ${done.refused} not mergeable.`);
  },

  /** Maintainers: offer a task again after rejected submissions parked it. */
  async reopen(args) {
    const ref = args._[0];
    if (!ref) throw new Error('Usage: swarm reopen <project/task>');
    const ctx = await context(args);
    const found = findTask(ctx.mirror.projects, ref);
    if (!found) throw new Error(`No task "${ref}" in this repository.`);
    await ctx.board.reopen(found.task);
    ok(`Reopened ${found.task.ref}. Earlier rejections no longer count against it.`);
  },

  async lint() {
    const problems = lintRepo(process.cwd());
    for (const p of problems) log(`${p.file}: ${p.problem}`);
    if (problems.length) {
      process.exitCode = 1;
      return;
    }
    ok('swarm lint: OK');
  },

  async verify(args) {
    const root = process.cwd();
    const projects = loadProjects(root);
    if (!projects.length) throw new Error('No .swarm/projects here.');
    let failed = false;
    for (const project of projects) {
      if (args.project && project.id !== args.project) continue;
      const task = args.task ? findTask([project], args.task)?.task : { verify: [] };
      if (!task) continue;
      const sandbox = await pickSandbox({ requested: args['unsafe-no-sandbox'] ? 'none' : args.sandbox || 'auto', project });
      step(`${project.id}: verifying in ${sandbox} sandbox`);
      const v = await runVerify(project, task, { workDir: root, sandbox, onStep: (s) => step(`  ${s.name}: ${c.dim(s.run)}`) });
      if (v.ok) ok(`${project.id}: ${v.results.length} step(s) passed`);
      else {
        failed = true;
        fail(`${project.id}: ${describeFailure(v)}`);
      }
    }
    if (failed) process.exitCode = 1;
  },

  async ci(args) {
    const cwd = path.resolve(args.cwd || '.');
    if (!args.base) throw new Error('Usage: swarm ci --base <sha> [--cwd <checkout>] [--title <pr title>]');
    const sandbox = await pickSandbox({ requested: args['unsafe-no-sandbox'] ? 'none' : args.sandbox || 'auto' });
    const base = (await git(cwd, ['merge-base', args.base, 'HEAD'])).trim();
    const projects = await loadProjectsAt(cwd, base);
    const isSwarm = /^\[swarm\] /.test(args.title || '');

    if (!isSwarm) {
      // Ordinary pull request from a human: run every project's verify steps on the head.
      step('Not a swarm submission: running project verify steps on the head commit');
      for (const project of loadProjects(cwd)) {
        const v = await runVerify(project, { verify: [] }, { workDir: cwd, sandbox, onStep: (s) => step(`  ${project.id} / ${s.name}`) });
        if (!v.ok) {
          fail(describeFailure(v));
          process.exitCode = 1;
          return;
        }
      }
      return ok('Project verify steps passed');
    }

    const check = await checkSubmission(cwd, { base, head: 'HEAD', projects });
    if (!check.ok) {
      fail(`Submission rejected:\n${check.problems.map((p) => `  - ${p}`).join('\n')}`);
      process.exitCode = 1;
      return;
    }
    ok(`Structure, signature and policy OK: ${check.project.id}/${check.task.id} by worker ${check.receipt.signer.id}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-ci-'));
    await git(cwd, ['worktree', 'add', '--quiet', '--detach', tmp, check.work]);
    try {
      const v = await runVerify(check.project, check.task, { workDir: tmp, sandbox, onStep: (s) => step(`  ${s.name}: ${c.dim(s.run)}`) });
      if (!v.ok) {
        fail(`Verification failed:\n${describeFailure(v)}`);
        process.exitCode = 1;
        return;
      }
      ok(`Verified from the base branch's rules: ${v.results.map((r) => r.name).join(', ')}`);
    } finally {
      await run('git', ['worktree', 'remove', '--force', tmp], { cwd });
    }
  },

  async ledger(args) {
    const root = args.cwd ? path.resolve(args.cwd) : fs.existsSync(path.join(process.cwd(), '.swarm')) && !args.repo ? process.cwd() : (await context(args, { needsIdentity: false })).mirror.dir;
    const board = leaderboard(readLedger(root));
    if (args.out) {
      writeJson(path.resolve(args.out), board);
      return ok(`Wrote ${args.out}`);
    }
    log(args.json ? JSON.stringify(board, null, 2) : renderLeaderboard(board));
  },

  /** Static data for the project page: projects, task states and the ledger, from a checkout. */
  async 'site-data'(args) {
    const root = path.resolve(args.cwd || '.');
    const projects = loadProjects(root).map((p) => {
      const done = completedTasks(root, p.id);
      return {
        id: p.id,
        name: p.name || p.id,
        description: p.description || '',
        tasks: p.tasks.map((t) => ({ ref: t.ref, title: t.title, size: t.size, state: done.has(t.id) ? 'done' : t.status === 'ready' ? 'open' : t.status })),
      };
    });
    const data = { ...leaderboard(readLedger(root)), projects };
    if (args.out) {
      writeJson(path.resolve(args.out), data);
      return ok(`Wrote ${args.out}`);
    }
    log(JSON.stringify(data, null, 2));
  },

  /** MCP connector over stdio. Loaded lazily: the server imports this module. */
  async mcp() {
    const { serve } = await import('./mcp.mjs');
    await serve();
  },

  async help() {
    log(HELP);
  },

  async version() {
    log(PKG.version);
  },
};

export async function main(argv) {
  const args = parseArgs(argv);
  const name = args.help ? 'help' : args._.shift() || 'help';
  // With --json, stdout carries the JSON document and nothing else.
  if (args.json) setProgressSink((line) => process.stderr.write(line + '\n'));
  const cmd = commands[name];
  if (!cmd) {
    fail(`Unknown command "${name}".`);
    log(HELP);
    process.exitCode = 2;
    return;
  }
  await cmd(args);
}
