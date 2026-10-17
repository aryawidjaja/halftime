// Reads a session transcript and pulls out what Halftime teaches from.
// Pure functions only: no engine calls, no I/O. Linear in the transcript size.

import type { Approval, Bug, Change, DiffLine, Earlier, FileChange, Helper, Msg, Point, Risk } from '../../types';

const MAX_DIFF_LINES = 14;

/** Strips harness tags (reminders, command wrappers) from a user prompt. */
export function cleanPrompt(text: string): string {
  return text
    .replace(/<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|bash-[a-z-]+|task-notification|ide_[a-z_]+|user-prompt-submit-hook)[^>]*>[\s\S]*?<\/\1>/g, '')
    // Other lowercase tags lose their brackets only; `x < 3` and `Promise<User>` stay.
    .replace(/<\/?[a-z][\w-]*(\s[^<>]*)?\/?>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const shorten = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/** Shows an absolute path by its last part: shorter to read, and it keeps home folders out of view. */
export function tidyPaths(text: string, root = ''): string {
  if (root.length > 1) {
    text = text.split(root + '/').join('');
    // A Windows root also appears with backslashes.
    if (root.includes('\\')) text = text.split(root + '\\').join('');
  }
  return text
    // A home folder's name first becomes ~, even with spaces in it ("/Users/Jane Doe/x" → "~/x").
    .replace(/\/(?:Users|home)\/[^/\n"'`]+(?=\/)/g, '~')
    .replace(/\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\n"'`]+(?=\\)/g, '~')
    .replace(/(?:~|\/(?:Users|home|private|var|tmp|Volumes|opt))(?:\/[^\s"'`)\]>,;]+)+/g, p => '…/' + p.split('/').filter(Boolean).slice(-1)[0])
    .replace(/~(?:\\[^\s"'`)\]>,;\\]+)+/g, p => '…\\' + p.split('\\').filter(Boolean).slice(-1)[0]);
}

/** First one or two sentences of a message, for narration. */
export function firstSentences(text: string, max = 240): string | undefined {
  // Markdown marks go; underscores stay (they are in names like JWT_SECRET).
  const t = text.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*(#+|>)\s*/gm, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 20) return undefined;
  const m = t.match(/^(.+?[.!?])(\s+.+?[.!?])?(\s|$)/);
  return shorten(m ? (m[1] + (m[2] ?? '')).trim() : t, max);
}

/** A small line diff: common head and tail kept as context, the middle as removed then added. */
export function diffOf(before: string, after: string): DiffLine[] {
  const a = before.split('\n'), b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out: DiffLine[] = [];
  if (head > 0) out.push({ op: ' ', text: a[head - 1]! });
  for (const l of a.slice(head, a.length - tail)) out.push({ op: '-', text: l });
  for (const l of b.slice(head, b.length - tail)) out.push({ op: '+', text: l });
  if (tail > 0) out.push({ op: ' ', text: a[a.length - tail]! });
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** What an editing tool call did to a file, or undefined for any other tool. */
export function fileChangeOf(tool: string, input: Record<string, unknown>, root = ''): FileChange | undefined {
  const file = relative(str(input.file_path) || str(input.notebook_path), root);
  if (!file) return undefined;
  let diff: DiffLine[] = [];
  if (tool === 'Edit') diff = diffOf(str(input.old_string), str(input.new_string));
  else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits as Array<Record<string, unknown>>) diff.push(...diffOf(str(e.old_string), str(e.new_string)));
  } else if (tool === 'Write') diff = str(input.content) ? str(input.content).replace(/\n$/, '').split('\n').map(text => ({ op: '+', text })) : [];
  else return undefined;
  const added = diff.filter(d => d.op === '+').length, removed = diff.filter(d => d.op === '-').length;
  return { file, added, removed, diff: diff.slice(0, MAX_DIFF_LINES) };
}

/** A path outside the project: Unix-absolute, or a Windows drive. */
export const isOutside = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p);

/** Forward slashes everywhere, so Windows paths (C:\\repo\\src) compare like the others. */
export const slashes = (p: string) => p.replace(/\\/g, '/');

export function relative(path: string, root: string): string {
  if (!path) return '';
  const p = slashes(path), r = slashes(root).replace(/\/$/, '');
  if (r && p.toLowerCase().startsWith(r.toLowerCase() + '/') && (p.startsWith(r + '/') || /^[a-z]:\//i.test(p))) return p.slice(r.length + 1);
  return p;
}

/** Merges several changes to one file into one entry. */
function mergeFiles(list: FileChange[]): FileChange[] {
  const by = new Map<string, FileChange>();
  for (const f of list) {
    const cur = by.get(f.file);
    if (!cur) by.set(f.file, { ...f, diff: [...f.diff] });
    else {
      cur.added += f.added; cur.removed += f.removed;
      if (cur.diff.length < MAX_DIFF_LINES) cur.diff.push(...f.diff.slice(0, MAX_DIFF_LINES - cur.diff.length));
    }
  }
  return [...by.values()];
}

/** User-role rows the harness writes (skill bodies, agent reports, notices), not the person's requests. */
const INJECTED = /^(\[Request interrupted|Base directory for this skill|Another Claude session sent a message|\[SYSTEM NOTIFICATION|Caveat: The messages below|This session is being continued|Launching skill|## Page contract|Your response above was cut off)/;

const isPrompt = (m: Msg) => {
  if (m.role !== 'user' || m.toolResults?.length) return false;
  const t = cleanPrompt(m.text);
  return t.length > 0 && !INJECTED.test(t);
};

/** The label for edits made before any request we can see: after a summary, Claude keeps working from it. */
export const CONTINUED_ASK = 'Work continued from earlier in this session';

/** True when the conversation was summarized (compacted): only what came after the summary is visible. */
export const wasSummarized = (msgs: readonly Msg[]) =>
  msgs.some(m => m.role === 'user' && /^This session is being continued from a previous conversation/.test(m.text.trim()));

/**
 * Groups the transcript into changes: one per user request that led to edits. A helper
 * agent's edits (`helpers`, by agent id) become a change of their own, placed where
 * Claude handed it the task.
 */
export function changesOf(msgs: readonly Msg[], root = '', helpers: ReadonlyMap<string, { task: string; msgs: readonly Msg[] }> = new Map()): Change[] {
  const out: Change[] = [];
  let cur: { ask: string; said?: string; files: FileChange[] } | undefined;
  const push = (ask: string, said: string | undefined, list: FileChange[]) => {
    if (!list.length) return;
    const files = mergeFiles(list);
    out.push({ index: out.length, ask: shorten(ask, 90), said, files, added: files.reduce((n, f) => n + f.added, 0) });
  };
  const flush = () => { if (cur) push(cur.ask, cur.said, cur.files); };
  for (const m of msgs) {
    if (isPrompt(m)) { flush(); cur = { ask: tidyPaths(cleanPrompt(m.text), root), files: [] }; continue; }
    if (m.role !== 'assistant') continue;
    for (const u of m.toolUses) {
      const h = u.agentId ? helpers.get(u.agentId) : undefined;
      if (!h) continue;
      // Close the request so far, add the helper's work, then carry on with the same request.
      flush();
      const edits = h.msgs.flatMap(x => x.role === 'assistant' ? x.toolUses.flatMap(t => { const fc = !t.isError && fileChangeOf(t.tool, t.input, root); return fc ? [fc] : []; }) : []);
      push(`Helper agent: ${h.task}`, undefined, edits);
      if (cur) cur = { ask: cur.ask, said: cur.said, files: [] };
    }
    // Edits with no request in view (the request is inside a summary) still count.
    if (!cur && m.toolUses.some(u => !u.isError && fileChangeOf(u.tool, u.input, root))) cur = { ask: CONTINUED_ASK, files: [] };
    if (!cur) continue;
    if (!cur.said && m.text) cur.said = firstSentences(m.text);
    for (const u of m.toolUses) { const fc = !u.isError && fileChangeOf(u.tool, u.input, root); if (fc) cur.files.push(fc); }
  }
  flush();
  return out;
}

/* ---------- bugs: a failing check, edits, then the same check passing ---------- */

/** A command's simple commands: heredoc bodies dropped, split on && || ; | and newlines, leading VAR=val dropped. */
function segments(cmd: string): string[] {
  const flat = cmd.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n\s*\2[ \t]*(?=\n|$)/g, '$3').replace(/<<[\s\S]*$/, '');
  return flat.split(/&&|\|\||[;|\n]/).map(x => x.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);
}

const CHECK_PROG = /^(jest|vitest|mocha|pytest|tsc|eslint|mypy|ruff|rspec|phpunit|xcodebuild|gradle|gradlew|mvn|biome)$/;
const CHECK_SUB = /^(test|build|check|vet|lint|clippy)$/;
const CHECK_SCRIPT = /^(test|tests|tsc|lint|typecheck|type-check|build|check|pytest|jest|vitest|mypy|ruff|eslint)$/;

/** Whether one simple command runs tests, a build, a linter or a type-check. Paths and file names never count. */
function isCheckSegment(seg: string): boolean {
  const w = seg.split(/\s+/), prog = (w[0] ?? '').split('/').pop() ?? '';
  if (CHECK_PROG.test(prog) || (prog === 'prettier' && w.includes('--check'))) return true;
  if (/^(go|cargo|swift|make|dotnet)$/.test(prog)) return CHECK_SUB.test(w[1] ?? '');
  if (!/^(npm|pnpm|yarn|bun|npx|bunx|uv|poetry|python3?|node|deno)$/.test(prog)) return false;
  const next = w.slice(1, 4).filter(t => !/[/.]/.test(t));
  return next.some((t, i) => CHECK_SCRIPT.test(t) || (t === 'run' && CHECK_SCRIPT.test((next[i + 1] ?? '').split(':')[0]!)));
}

export const isCheck = (cmd: string) => !/^\s*git\b/.test(cmd) && segments(cmd).some(isCheckSegment);
const FAILURE = /(\bFAIL(ED)?\b|^\(fail\)|\b[1-9]\d* fail\b|✕|✗|\b[1-9]\d* (failing|failed)\b|error TS\d+|Traceback \(most recent call last\)|\bAssertionError\b|\bError:|panic:|Expected[\s\S]{0,40}Received|exit code [1-9]|Command failed)/m;

/** Names a check across runs: the part of a chain that is the check, its first words up to a flag or redirect. */
/** A command as a person would say it: no `cd …&&` prefix, no redirects, no `| tail`. */
export function displayCmd(cmd: string): string {
  const segs = cmd.split(/&&|;/).map(s => s.trim()).filter(s => s && !/^(cd|export|source)\b/.test(s));
  return shorten((segs[0] ?? cmd).split('|')[0]!.replace(/\s+\d?>&?\d*(\s+\S+)?/g, '').trim(), 80);
}

export function checkKey(cmd: string): string {
  const segs = segments(cmd), part = segs.find(isCheckSegment) ?? segs[0] ?? cmd.trim();
  const words = part.split(/\s+/);
  const end = words.findIndex(w => w.startsWith('-') || w.includes('>'));
  return words.slice(0, Math.min(3, end < 0 ? 3 : end)).join(' ');
}

function errorLines(text: string): string[] {
  const lines = text.split('\n').map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()).filter(l => l.trim());
  const hits = lines.filter(l => (FAILURE.test(l) || /expected|received|error/i.test(l)) && !/^\s*[-+]\s*(Expected|Received)\s*$/.test(l));
  return (hits.length ? hits : lines).slice(0, 6).map(l => shorten(l.trim(), 120));
}

const CAUSE = /\b(because|caused by|the (root )?cause|the (problem|issue|bug) (is|was)|fails? (when|since|due)|due to|instead of|was (using|written|comparing|missing)|wasn't|isn't|doesn't|didn't)\b/i;

/** Sentences that narrate what Claude is doing rather than why something broke. */
const NARRATION = /^(let me|let's|i'll|i will|i'm|now|next|running|checking|looking|ok|okay|great|good|all \d+|done)\b|\b(pass(es|ed)?|green)\b/i;

/** The first sentence in a message that explains a cause, if any. */
function causeOf(text: string): string | undefined {
  const flat = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ');
  const hit = flat.match(/[^.!?]*[.!?]/g)?.map(x => x.replace(/^[-*•\s]+/, '').trim()).find(x => CAUSE.test(x) && x.length > 15);
  return hit ? shorten(hit.replace(/[*`]/g, ''), 300) : undefined;
}

export function bugsOf(msgs: readonly Msg[], root = ''): Bug[] {
  const bugs: Bug[] = [];
  const open = new Map<string, { cmd: string; error: string[]; why?: string; fix: FileChange[]; changeIndex: number }>();
  // changeIndex matches changesOf: it counts only requests that led to edits.
  let prompts = 0, done = 0, edited = false;
  // A fixed bug whose cause Claude had not explained yet: its summary after the passing run often does.
  let pending: Bug[] = [];
  for (const m of msgs) {
    if (isPrompt(m)) { if (edited) done++; edited = false; prompts++; pending = []; continue; }
    if (m.role !== 'assistant') continue;
    const cause = m.text && pending.length ? causeOf(m.text) : undefined;
    if (cause) { for (const b of pending) { b.why = plainCause(cause); b.title = bugTitle(cause, b.error, b.failed); } pending = []; }
    // Claude's words between a failure and its fix usually say why it failed. Prefer a
    // sentence that explains a cause over "Let me look at…".
    if (m.text) for (const o of open.values()) if (!o.fix.length && (!o.why || !CAUSE.test(o.why))) o.why = causeOf(m.text) ?? o.why ?? firstSentences(m.text, 300);
    for (const u of m.toolUses) {
      const fc = !u.isError && fileChangeOf(u.tool, u.input, root);
      if (fc) {
        if (prompts) edited = true;
        for (const o of open.values()) { if (!o.fix.length) o.changeIndex = done; o.fix.push(fc); }
        continue;
      }
      if (u.tool !== 'Bash') continue;
      const cmd = str(u.input.command);
      if (!isCheck(cmd)) continue;
      const key = checkKey(cmd), out = u.text ?? '';
      const failed = !!u.isError || FAILURE.test(out);
      if (failed) { if (!open.has(key)) open.set(key, { cmd, error: errorLines(out), fix: [], changeIndex: done }); continue; }
      const o = open.get(key);
      if (o && o.fix.length) {
        const fix = mergeFiles(o.fix);
        const bug: Bug = { title: bugTitle(o.why, o.error, o.cmd), failed: displayCmd(o.cmd), error: o.error, why: o.why && plainCause(o.why), fix, verified: displayCmd(cmd), changeIndex: o.changeIndex };
        bugs.push(bug);
        if (!o.why || !CAUSE.test(o.why)) pending.push(bug);
      }
      open.delete(key);
    }
  }
  return bugs.slice(-5);
}

/** "The cause is the one I gave above: the UTC date puts…" → "The UTC date puts…" */
function plainCause(why: string): string {
  const t = why.replace(/[*`]/g, '').replace(/^(the (root )?cause (is|was)[^:]*:|because:?)\s*/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function bugTitle(why: string | undefined, error: string[], cmd: string): string {
  // Only a sentence that explains the cause makes a good title; "Running it again." does not.
  const first = why && (CAUSE.test(why) || !NARRATION.test(why)) ? plainCause(why).match(/^(.+?[.!?])(\s|$)/)?.[1] : undefined;
  if (first && first.length <= 90) return first.replace(/[.!?]$/, '');
  if (error[0]) return shorten(`${checkKey(cmd)} failed: ${error[0]}`, 90);
  return `${checkKey(cmd)} failed, then passed`;
}

/* ---------- approvals: packages, commands, secrets, permissions ---------- */

type Rule = { re: RegExp; risk: Risk; kind: Approval['kind']; what: (m: RegExpMatchArray) => string; say: string; todo?: string };

const COMMAND_RULES: Rule[] = [
  { re: /\bgit\s+push\b[^\n;&|]*(--force|-f)\b/i, risk: 'high', kind: 'command', what: () => 'Force-pushed to git', say: 'Overwrote history on the remote. Anyone else\'s work on that branch can be lost.' },
  { re: /\bgit\s+reset\s+--hard\b/i, risk: 'high', kind: 'command', what: () => 'Ran git reset --hard', say: 'Threw away uncommitted changes in your project.' },
  { re: /\b(prisma\s+migrate\s+reset|db:reset|db:drop|dropdb|DROP\s+(TABLE|DATABASE))\b/i, risk: 'high', kind: 'migration', what: m => `Erased a database (${m[1]})`, say: 'Wiped the database it ran against. Fine on a test database; on your live one it deletes every record.', todo: 'Add a safety check so database reset commands can never run against the live database' },
  { re: /(?:^|[;&|(]\s*)(npx\s+(?:-y|--yes)\b[^\n;&|]*)/i, risk: 'med', kind: 'command', what: m => shorten((m[1] ?? m[0]).trim(), 60), say: 'Downloaded a package and ran it straight away, without asking. Fine for well-known tools; check the name for anything unfamiliar.' },
  { re: /\b(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b/i, risk: 'high', kind: 'command', what: () => 'Ran a script straight from the internet', say: 'Downloaded a script and ran it without saving it first. Whoever controls that address controls what ran.' },
  { re: /\bchmod\s+(-R\s+)?777\b/i, risk: 'med', kind: 'command', what: () => 'Made files writable by everyone (chmod 777)', say: 'Any user or program on the machine can now change those files.' },
  { re: /\b(prisma\s+migrate\s+(dev|deploy)|alembic\s+upgrade|rails\s+db:migrate|knex\s+migrate|sequelize\s+db:migrate|drizzle-kit\s+(push|migrate)|supabase\s+db\s+push)\b/i, risk: 'low', kind: 'migration', what: m => `Changed the database structure (${m[1]})`, say: 'Applied a database change. Check which database it ran against before you deploy.' },
  { re: /\b(vercel\s+(--prod|deploy)|fly\s+deploy|railway\s+up|netlify\s+deploy|npm\s+publish|firebase\s+deploy|wrangler\s+(deploy|publish))\b/i, risk: 'med', kind: 'command', what: m => `Deployed or published (${m[1]})`, say: 'Sent code to a live service where real people can reach it.' },
  { re: /\bgit\s+push\b/i, risk: 'low', kind: 'command', what: () => 'Pushed to git', say: 'Your commits are now on the remote.' },
];

const INSTALL = /\b(npm|pnpm|yarn|bun)\s+(install|i|add)\b([^\n;&|]*)|\b(pip3?|uv\s+pip|uv|poetry)\s+(install|add)\b([^\n;&|]*)|\bcargo\s+add\b([^\n;&|]*)|\bgo\s+(?:get|install)\b([^\n;&|]*)|\bbrew\s+install\b([^\n;&|]*)|\bgem\s+install\b([^\n;&|]*)/gi;

const VALUE_FLAG = /^(-[rceitF]|--(requirement|constraint|editable|index-url|extra-index-url|target|features|registry|prefix))$/;

/** Package names from an install command; flags and paths dropped. */
export function packagesOf(cmd: string): Array<{ name: string; global: boolean }> {
  const out: Array<{ name: string; global: boolean }> = [];
  for (const m of cmd.matchAll(INSTALL)) {
    const rest = (m[3] ?? m[6] ?? m[7] ?? m[8] ?? m[9] ?? m[10] ?? '').trim();
    const words = rest.split(/\s+/).filter(Boolean);
    const global = words.some(w => w === '-g' || w === '--global');
    words.forEach((w, i) => {
      // Skip flags, the value of a flag that takes one, paths and redirects.
      if (/^-/.test(w) || VALUE_FLAG.test(words[i - 1] ?? '') || /^[./~]|^\d*>|:\/\//.test(w)) return;
      // Quotes, extras ([all]), versions (@1.2, @latest, ==2, >=2) go.
      const name = w.replace(/^['"]|['"]$/g, '').replace(/\[.*?\]/, '').replace(/(.)@[^/]*$/, '$1').replace(/[=<>!~;,].*$/, '');
      if (name) out.push({ name, global });
    });
  }
  return out;
}

const SECRET_NAME = /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|DSN|DATABASE_URL)/i;

// Deletions that are housekeeping, not a loss: temp and $VAR-rooted paths, find's {}, build output, caches, archives.
const SCRATCH = /^((\/private)?\/tmp(\/|$)|\/var\/folders\/|\$|\{\}$)/;
const ARTIFACT = /^(node_modules|dist|build|\.next|out|coverage|__pycache__|\.pytest_cache|\.DS_Store)$|cache|\.(tgz|tar|tar\.gz|zip)$/i;

/** Targets of recursive `rm` in a command (anywhere in a chain, after sudo, xargs or find -exec); scratch ones dropped. */
export function deletedOf(cmd: string): string[] {
  const out: string[] = [];
  for (const seg of segments(cmd)) {
    const m = seg.match(/(?:^|\s)rm\s+(.*)$/);
    if (!m || /^git\s/.test(seg)) continue; // git rm only untracks
    const got: string[] = [];
    let recursive = false, flags = true, skip = false;
    for (const tok of (m[1] ?? '').split(/\s+/)) {
      if (skip || !tok) { skip = false; continue; }
      if (flags && tok === '--') { flags = false; continue; }
      if (flags && tok.startsWith('-')) { if (/^-[a-zA-Z]*[rR]|^--recursive$/.test(tok)) recursive = true; continue; }
      flags = false;
      if (/^\d*>/.test(tok)) { skip = /^\d*>>?$/.test(tok); continue; } // a redirect, and its file
      const t = tok.replace(/^['"]|['"]$/g, '');
      if (/^(\+|\\;?|;)$/.test(t) || SCRATCH.test(t) || ARTIFACT.test(t.replace(/\/+$/, '').split('/').pop() ?? '')) continue;
      got.push(t);
    }
    if (recursive) out.push(...got);
  }
  return out;
}

/** Variable names (never values) written to .env files. */
export function envNamesOf(content: string): string[] {
  return [...content.matchAll(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/gm)].map(m => m[1]!);
}

export function approvalsOf(msgs: readonly Msg[], opts: { root?: string; newPermissions?: string[]; describe?: (pkg: string) => string | undefined } = {}): Approval[] {
  const seen = new Set<string>(), out: Approval[] = [], deleted = new Set<string>();
  const add = (a: Approval) => { if (!seen.has(a.what)) { seen.add(a.what); out.push(a); } };
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    for (const u of m.toolUses) {
      if (u.isError) continue;
      if (u.tool === 'Bash') {
        const cmd = str(u.input.command);
        for (const p of packagesOf(cmd)) {
          const desc = opts.describe?.(p.name);
          add({ risk: p.global ? 'med' : 'low', kind: 'package', what: `Installed ${p.name}${p.global ? ' for the whole computer' : ''}`,
            say: (desc ? shorten(desc, 140) + ' ' : '') + 'Packages are code written by other people, and they run on your computer.' });
        }
        deletedOf(cmd).forEach(t => deleted.add(t));
        for (const r of COMMAND_RULES) { const mm = cmd.match(r.re); if (mm) { add({ risk: r.risk, kind: r.kind, what: shorten(r.what(mm), 80), say: r.say, todo: r.todo }); break; } }
      }
      if (u.tool === 'Write' || u.tool === 'Edit' || u.tool === 'MultiEdit') {
        const file = relative(str(u.input.file_path), opts.root ?? '');
        if (/(^|\/)\.env(\.[\w-]+)?$/.test(file) && !/\.example$|\.sample$|\.template$/.test(file)) {
          const text = str(u.input.content) || str(u.input.new_string) || ((u.input.edits as Array<Record<string, unknown>> | undefined) ?? []).map(e => str(e.new_string)).join('\n');
          for (const name of envNamesOf(text).filter(n => SECRET_NAME.test(n)))
            add({ risk: 'med', kind: 'secret', what: `Created a secret (${name} in ${file})`, say: 'Keep this file out of git, and use a different value on your live server.' });
        }
      }
    }
  }
  // One entry for every real deletion in the session, not one per command.
  if (deleted.size) {
    const all = [...deleted].map(t => shorten(tidyPaths(t, opts.root ?? ''), 40)), n = all.length, shown = all.slice(0, 5).join(', ');
    add({ risk: 'high', kind: 'command', what: `Deleted ${n} ${n === 1 ? 'folder or file' : 'folders or files'} for good`,
      say: `Removed: ${shown}${n > 5 ? `, and ${n - 5} more` : ''}. They do not go to the trash.` });
  }
  for (const rule of opts.newPermissions ?? []) {
    const broad = /^Bash\((\*|[\w.-]+:\*)\)$|^Bash$|\b(rm|curl|wget|sudo|npm install|pnpm add|yarn add|pip install)\b/.test(rule);
    add({ risk: broad ? 'high' : 'med', kind: 'permission', what: `Let Claude run ${rule} without asking`,
      say: broad ? 'Claude can now do this on its own. To be asked again, remove it in /permissions.' : 'Saved as an always-allowed action for this project. Remove it in /permissions to be asked again.' });
  }
  const order: Record<Risk, number> = { high: 0, med: 1, low: 2 };
  return out.sort((a, b) => order[a.risk] - order[b.risk]);
}

/* ---------- the summary of the earlier conversation ---------- */

const SUMMARY_START = /^This session is being continued from a previous conversation/;
/** Which of the summary's sections Halftime shows, by heading. Code listings and the raw message log are left out. */
const SECTIONS: Array<[keyof Earlier, RegExp]> = [
  ['asked', /request|intent/i], ['ideas', /concept/i], ['errors', /error|fix/i], ['solved', /problem.solving/i], ['open', /pending/i], ['now', /current work/i],
];
const SKIP = /files|code|user messages|next step/i;
const plain = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();

/**
 * Claude Code's summary of the conversation before it was compacted, split into the
 * sections worth reading. A bullet is an entry; a bold label (a line that is not a
 * bullet) heads the bullets under it; deeper bullets are points of the entry above.
 */
export function earlierOf(msgs: readonly Msg[], root = ''): Earlier {
  const m = [...msgs].reverse().find(x => x.role === 'user' && SUMMARY_START.test(x.text.trim()));
  if (!m) return {};
  const out: Earlier = {};
  type G = { head: string; points: string[]; label: boolean; indent: number };
  let key: keyof Earlier | undefined, groups: G[] = [], blank = false;
  const tidy = (t: string, n: number) => shorten(tidyPaths(plain(t), root), n).replace(/:$/, '');
  const close = () => {
    if (key && groups.length) out[key] = groups.map((g): Point => ({ head: tidy(g.head, 240), points: g.points.map(p => tidy(p, 220)).filter(p => p.length > 2).slice(0, 8) })).filter(g => g.head.length > 2).slice(0, 8);
  };
  for (const line of m.text.replace(/```[\s\S]*?```/g, '').split('\n')) {
    // Headings start the line ("1. Errors and fixes:" or "## Errors and fixes"); numbered items inside a section are indented.
    const head = line.match(/^(?:\d+[.)]|#{1,4})\s+([^:\n]{3,60}):\s*(.*)$/) ?? line.match(/^#{1,4}\s+(.{3,60})$/);
    const k = head ? (SKIP.test(head[1]!) ? null : SECTIONS.find(([, re]) => re.test(head[1]!))?.[0]) : undefined;
    if (head && k !== undefined) {
      close();
      key = k ?? undefined; groups = key && head[2] ? [{ head: head[2], points: [], label: true, indent: 0 }] : []; blank = false;
      continue;
    }
    if (!key) continue;
    if (!line.trim()) { blank = true; continue; }
    const at = line.search(/\S/), b = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/), last = groups[groups.length - 1];
    if (b) {
      if (last && (last.label ? at >= last.indent : at > last.indent)) last.points.push(b[1]!);
      else groups.push({ head: b[1]!, points: [], label: false, indent: at });
    } else if (last && !blank) {
      // A wrapped line continues what it follows.
      if (last.points.length) last.points[last.points.length - 1] += ' ' + line.trim(); else last.head += ' ' + line.trim();
    } else groups.push({ head: line.trim(), points: [], label: true, indent: at });
    blank = false;
  }
  close();
  return out;
}

/* ---------- helper agents ---------- */

/** Tasks Claude gave helper agents, with what each reported back (sync answer, background notification or hand-back). */
export function helpersOf(msgs: readonly Msg[], info: (agentId: string) => { files: number; last?: string } = () => ({ files: 0 }), root = ''): Helper[] {
  const reports = new Map<string, { text?: string; done: boolean }>();
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    for (const n of m.text.matchAll(/<task-notification>([\s\S]*?)<\/task-notification>/g)) {
      const id = n[1]!.match(/<tool-use-id>([^<]+)<\/tool-use-id>/)?.[1];
      if (!id) continue;
      const res = n[1]!.match(/<result>([\s\S]*?)<\/result>/)?.[1];
      reports.set(id, { text: res && !/delivered to you as a message/.test(res) ? res : reports.get(id)?.text, done: /<status>(completed|failed|killed|stopped)/.test(n[1]!) });
    }
  }
  // A background helper can also report through a hand-back message, addressed by its agent id.
  const handbacks = new Map<string, string>();
  for (const m of msgs) {
    if (m.role !== 'user') continue;
    for (const h of m.text.matchAll(/<agent-message from="([^"]+)">([\s\S]*?)(?:<\/agent-message>|$)/g)) {
      const body = h[2]!.split(/The report follows:\s*/).pop()!;
      handbacks.set(h[1]!, body.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'));
    }
  }
  const out: Helper[] = [];
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    for (const u of m.toolUses) {
      if (u.tool !== 'Agent' && u.tool !== 'Task') continue;
      const back = u.agentId ? handbacks.get(u.agentId) : undefined;
      const task = plain(String(u.input.description ?? u.input.prompt ?? '')).slice(0, 90);
      if (!task) continue;
      const sync = u.text && !/^Async agent launched/.test(u.text) ? u.text : undefined;
      const r = reports.get(u.tool_use_id);
      const raw = firstSentences(sync ?? back ?? r?.text ?? '', 320), report = raw && tidyPaths(raw, root);
      const { files, last } = u.agentId ? info(u.agentId) : { files: 0 };
      out.push({ task, report, ...(!report && last ? { last: tidyPaths(last, root) } : {}), files, running: !sync && !back && !r?.done });
    }
  }
  return out;
}

/**
 * Where things stand: the start of Claude's latest substantial reply. A short closing
 * line ("Nothing new to save.") says little, so among the last few replies a longer one wins.
 */
export function latestOf(msgs: readonly Msg[], root = '', min = 40): string | undefined {
  const said = msgs.filter(m => m.role === 'assistant' && m.text.trim().length > min).slice(-6).map(m => m.text);
  const pick = [...said].reverse().find(t => t.trim().length >= 200) ?? said[said.length - 1];
  const t = pick && firstSentences(pick, 300);
  return t && tidyPaths(t, root);
}
