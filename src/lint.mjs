// Static checks for .swarm/projects/*: manifests and task files.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './util.mjs';

const KNOWN_KEYS = new Set(['name', 'description', 'paths', 'protect', 'verify', 'limits', 'review', 'replication', 'claimTtlMinutes', 'sandbox']);
const STATUSES = new Set(['ready', 'blocked', 'draft']);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Returns [{ file, problem }] for everything wrong under <root>/.swarm/projects. Never throws. */
export function lintRepo(root) {
  const problems = [];
  const projectsDir = path.join(root, '.swarm', 'projects');
  let ids = [];
  try {
    ids = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return problems;
  }
  for (const id of ids) {
    try {
      lintProject(root, id, problems);
    } catch (e) {
      problems.push({ file: `.swarm/projects/${id}`, problem: `could not be checked: ${e.message}` });
    }
  }
  return problems;
}

function lintProject(root, id, problems) {
  const rel = `.swarm/projects/${id}`;
  const manifestFile = `${rel}/project.json`;
  const manifestPath = path.join(root, manifestFile);
  if (!fs.existsSync(manifestPath)) {
    problems.push({ file: manifestFile, problem: 'missing project.json' });
  } else {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      problems.push({ file: manifestFile, problem: `not valid JSON (${e.message})` });
    }
    if (manifest !== undefined) lintManifest(manifest, manifestFile, problems);
  }
  const tasksDir = path.join(root, rel, 'tasks');
  if (!fs.existsSync(tasksDir)) return;
  for (const f of fs.readdirSync(tasksDir).filter((n) => n.endsWith('.md')).sort()) {
    lintTask(root, `${rel}/tasks/${f}`, path.join(tasksDir, f), problems);
  }
}

function lintManifest(manifest, file, problems) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push({ file, problem: 'must be a JSON object' });
    return;
  }
  for (const key of Object.keys(manifest)) {
    if (!KNOWN_KEYS.has(key)) problems.push({ file, problem: `unknown key "${key}"` });
  }
  if (!Array.isArray(manifest.verify) || manifest.verify.length === 0) {
    problems.push({ file, problem: 'no verify steps' });
    return;
  }
  manifest.verify.forEach((v, i) => {
    if (!v || typeof v !== 'object') return problems.push({ file, problem: `verify[${i}] must be an object with name and run` });
    if (!v.name) problems.push({ file, problem: `verify[${i}] is missing "name"` });
    if (!v.run) problems.push({ file, problem: `verify[${i}] is missing "run"` });
  });
}

function lintTask(root, file, abs, problems) {
  const { meta, body } = parseFrontmatter(fs.readFileSync(abs, 'utf8'));
  if (!meta.title) problems.push({ file, problem: 'missing title' });
  const id = meta.id || path.basename(file, '.md');
  if (typeof id !== 'string' || !ID_RE.test(id)) problems.push({ file, problem: `id "${id}" must be lowercase letters, digits and dashes` });
  if (meta.status !== undefined && !STATUSES.has(meta.status)) problems.push({ file, problem: `status "${meta.status}" must be ready, blocked or draft` });
  if (!body.trim()) problems.push({ file, problem: 'empty body' });
  const verify = Array.isArray(meta.verify) ? meta.verify : [];
  for (const v of verify) {
    const cmd = typeof v === 'string' ? v : v && v.run;
    if (typeof cmd !== 'string') continue;
    for (const m of cmd.matchAll(/\.swarm\/projects\/[^\s"'`;|&]+/g)) {
      if (!fs.existsSync(path.join(root, m[0]))) problems.push({ file, problem: `verify references missing file ${m[0]}` });
    }
  }
}
