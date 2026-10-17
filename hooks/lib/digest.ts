// What the course is written from: a compact, secret-free digest of the session, and
// the kind of session it was. Pure: the hooks module passes the transcript in.

import type { Lessons, Msg, Point, Stats } from '../../types';
import { cleanPrompt, firstSentences, isCheck, shorten, tidyPaths } from './extract';

/* ---------- secrets ---------- */

/** Values that look like credentials, each with what replaces it. A kept label ("password=") stays so the text still reads. */
const HIDDEN = '•••';
const SECRETS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, HIDDEN],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant|or)?[-_]?[A-Za-z0-9_-]{16,}/g, HIDDEN], // Stripe, OpenAI, Anthropic style
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, HIDDEN], // GitHub
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, HIDDEN],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, HIDDEN], // Slack
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN], // AWS access key id
  [/\bAIza[0-9A-Za-z_-]{30,}/g, HIDDEN], // Google API key
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, HIDDEN], // JWT
  [/\b(?:npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,})/g, HIDDEN],
  [/(:\/\/[^\s:/@]+:)[^\s@/]{3,}@/g, `$1${HIDDEN}@`], // user:password@ in URLs
  // Also env-var style names: DB_PASSWORD=, JWT_SECRET=, client_secret=, GITHUB_TOKEN:
  [/([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|private[_-]?key|access[_-]?key)(?:_[A-Za-z0-9]+)*["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, `$1${HIDDEN}`],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, `$1${HIDDEN}`],
];

/** Removes anything that looks like a secret. */
export function redact(text: string): string {
  return SECRETS.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Applies `redact` to every string in a JSON-like value. */
export function redactDeep<T>(v: T): T {
  if (typeof v === 'string') return redact(v) as T;
  if (Array.isArray(v)) return v.map(redactDeep) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)])) as T;
  return v;
}

/* ---------- the kind of session ---------- */

export const KINDS = ['admin', 'housekeeping', 'deploy', 'ml', 'science', 'firefight', 'ui', 'research', 'explain', 'refactor', 'fix', 'build', 'planning', 'writing', 'general'] as const;
export type Kind = (typeof KINDS)[number];

/** What the course stresses for each kind of session. */
export const EMPHASIS: Record<Kind, string> = {
  admin: 'a short task; teach the one or two ideas behind it',
  housekeeping: 'what was safe to remove and why, what it costs to get back, and how to tell caches from real data',
  deploy: 'each release step, the gates you approved, and what each tool or setting does',
  ml: 'what each metric means in plain words, why a change helped or hurt, and whether the result generalises',
  science: 'the hypothesis, the controls, and what the statistics can and cannot say',
  firefight: 'the timeline, how the real cause was told apart from noise, and how to spot it next time',
  ui: 'the design choices, the components involved, and how the result was checked by eye',
  research: 'the conclusion, how sources were weighed, and how to read the findings critically',
  explain: 'the path a request or data takes through the code, and where the source of truth lives',
  refactor: 'what moved, what must not break, and how the risk was contained',
  fix: 'the debugging path including dead ends, the root cause, and how the fix was proven',
  build: 'how the new parts fit together, why this structure, and what the tests prove',
  planning: 'the options weighed and the trade-offs accepted',
  writing: 'what the document argues, how it is built, and why it is written that way',
  general: 'the main ideas behind what was done and why',
};

const WORDS = {
  housekeeping: /\b(du -[a-z]*h|df -h|ncdu|pmset|vm_stat|top -l|ps aux|lsof|DerivedData|Library\/Caches|brew cleanup|docker system prune)\b/,
  deploy: /\b(git push|gh (pr create|release)|vercel|fly deploy|eas (build|submit)|fastlane|kubectl (apply|rollout)|terraform apply|helm (install|upgrade)|docker push|gcloud [a-z ]*deploy|wrangler (deploy|publish)|netlify deploy)\b/,
  ml: /\b(train(ing)?\.py|finetun|fine-tun|epochs?\b|torch|cuda|nvidia-smi|wandb|tensorboard|onnx|tensorrt|checkpoint|inference|lora\b|huggingface|accelerate launch|deepspeed)/i,
  science: /\b(simulat|p-value|bootstrap|monte carlo|hypothes[ie]s|pre-?regist|null result|confidence interval)/i,
  firefight: /\b(sentry|pagerduty|incident|outage|alert(s|ing)?\b|error rate|5\d\d errors?|production is down|prod is down|on-?call)/i,
  refactor: /\b(refactor|migrat|port (it|this|over)|rename|clean ?up|upgrade|deprecat)/i,
  fix: /\b(bug|fix|broken|fails?|failing|crash(es|ing)?|regression|doesn'?t work|not working|error)\b/i,
  planning: /\b(plan|strategy|roadmap|should (we|i)|pros and cons|pricing|go-to-market|business model)\b/i,
  ui: /\b(design|landing page|layout|animation|css|tailwind|figma|ui\b|ux\b|component)/i,
};

const count = (xs: readonly string[], re: RegExp) => xs.filter(x => re.test(x)).length;

/** The kind of session, from what ran in it (the main thread and its helpers). */
export function kindOf(msgs: readonly Msg[], helpers: ReadonlyArray<readonly Msg[]> = []): Kind {
  const all = [msgs, ...helpers].flat();
  const uses = all.flatMap(m => m.role === 'assistant' ? m.toolUses : []);
  const commands = uses.filter(u => u.tool === 'Bash').map(u => String(u.input.command ?? ''));
  const edits = uses.filter(u => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(u.tool)).length;
  const reads = uses.filter(u => /^(Read|Grep|Glob)$/.test(u.tool)).length + count(commands, /^\s*(cat|grep|rg|sed -n|head|tail|find|ls)\b/);
  const web = uses.filter(u => /^(WebSearch|WebFetch)$/.test(u.tool) || /web_?(search|fetch)/i.test(u.tool)).length;
  const browser = uses.filter(u => /browser|chrome|playwright|puppeteer/i.test(u.tool)).length;
  const asks = msgs.filter(m => m.role === 'user' && !m.toolResults?.length).map(m => cleanPrompt(m.text)).filter(Boolean);
  const said = all.filter(m => m.role === 'assistant').map(m => m.text);
  const fileEdits = uses.filter(u => /^(Edit|Write|MultiEdit)$/.test(u.tool)).map(u => String(u.input.file_path ?? ''));
  const styled = count(fileEdits, /\.(css|scss|html|svelte|vue|tsx|jsx)$/);

  // A short thread that handed its work to helpers is not a small task.
  if (msgs.length < 20 && !helpers.length && edits <= 2 && commands.length <= 6) return 'admin';
  if (count(commands, WORDS.housekeeping) >= 3 && edits <= 2) return 'housekeeping';
  if (count(commands, WORDS.deploy) >= 2 && edits <= commands.length / 3) return 'deploy';
  if (count(commands, WORDS.ml) + count(asks, WORDS.ml) >= 4) return 'ml';
  if (count(said, WORDS.science) + count(asks, WORDS.science) >= 3) return 'science';
  if (count(asks, WORDS.firefight) >= 1 && edits <= 10) return 'firefight';
  if (browser >= 5 || (styled >= 3 && styled >= fileEdits.length / 2) || (count(asks, WORDS.ui) >= 2 && styled >= 1)) return 'ui';
  if (web >= 8 && edits <= 5) return 'research';
  if (edits === 0 && reads >= 10) return 'explain';
  if (count(asks, WORDS.refactor) >= 1 && edits >= 3) return 'refactor';
  if (count(asks, WORDS.fix) >= 1 || (commands.some(isCheck) && edits >= 1 && /fail|error/i.test(all.map(m => m.toolUses.map(u => u.text ?? '').join(' ')).join(' ').slice(0, 200_000)) && edits < 10)) return 'fix';
  if (edits >= 5) return 'build';
  if (count(asks, WORDS.planning) >= 1) return 'planning';
  return 'general';
}

/* ---------- the digest ---------- */

/** Assistant messages that explain a reason: where the "why" of a session lives. */
const REASON = /\b(because|so that|instead of|rather than|trade-?off|the (root )?cause|the reason|which means|this means|otherwise|the risk|i chose|we chose|went with|decided)\b/i;

const clean = (t: string) => t.replace(/```[\s\S]*?```/g, ' [code] ').replace(/\s+/g, ' ').trim();

function reasons(msgs: readonly Msg[], max: number, skip: ReadonlySet<string>): string[] {
  const out = msgs.filter(m => m.role === 'assistant' && m.text.length >= 160 && REASON.test(m.text)).map(m => clean(m.text)).filter(t => !skip.has(t));
  return out.slice(-max).map(t => shorten(redact(t), 1200));
}

/** The last thing Claude wrote before each new request, and at the end: its answer to that request. */
export function turnEnds(msgs: readonly Msg[]): string[] {
  const out: string[] = [];
  let last = '';
  for (const m of msgs) {
    if (m.role === 'user' && !m.toolResults?.length) { if (last) out.push(last); last = ''; }
    else if (m.role === 'assistant' && m.text.trim().length > 40) last = m.text;
  }
  if (last) out.push(last);
  return out;
}

const point = (p: Point) => `- ${p.head}${p.points.length ? `: ${p.points.join('; ')}` : ''}`;

/** Counted from the session, never invented. */
export function statsOf(l: Lessons): Stats {
  return {
    messages: l.counts.messages,
    commands: l.counts.commands,
    helpers: l.helpers.length,
    files: new Set(l.changes.flatMap(c => c.files.map(f => f.file))).size,
    failed: l.bugs.length,
  };
}

/**
 * Everything the course writer needs, at most `max` characters, secrets removed. The
 * order is the order of importance, so a cut loses the least useful parts.
 */
export function digestOf(l: Lessons, msgs: readonly Msg[], max = 20_000): string {
  const root = l.project, out: string[] = [];
  const add = (title: string, lines: string[]) => { if (lines.length) out.push(`## ${title}`, ...lines, ''); };
  const s = statsOf(l);
  add('Session', [
    `Project folder: ${root.split(/[\\/]/).pop() ?? root}`,
    `Kind of work: ${l.kind}`,
    `Size: ${s.messages} messages, ${s.commands} commands, ${s.files} files changed, ${s.helpers} helper agents${l.summarized ? ', summarized once it got long' : ''}`,
  ]);
  const asks = msgs.filter(m => m.role === 'user' && !m.toolResults?.length).map(m => cleanPrompt(m.text))
    .filter(t => t.length > 3 && !/^(This session is being continued|Another Claude session|\[Request interrupted|Base directory for this skill|Caveat:)/.test(t));
  add('What you asked, in order', asks.slice(-15).map(t => `- ${shorten(tidyPaths(redact(t), root), 300)}`));
  const e = l.earlier;
  add('Earlier, before the conversation was summarized', [
    ...(e.asked ?? []).map(point), ...(e.solved ?? []).map(point), ...(e.now ?? []).map(point),
  ]);
  add('Ideas and terms used', (e.ideas ?? []).map(point));
  const file = (f: string) => tidyPaths(f, root);
  add('Problems hit and how they were fixed', [
    ...l.bugs.map(b => `- ${b.title}. Failed: ${b.failed}. ${b.why ? `Cause: ${b.why}. ` : ''}Fix changed: ${b.fix.map(f => file(f.file)).join(', ')}.${b.verified ? ` Then passed: ${b.verified}.` : ''}`),
    ...(e.errors ?? []).map(point),
  ]);
  add('Helper agents and what they reported', l.helpers.map(h => `- ${h.task}${h.report ? `: ${h.report}` : h.last ? ` (${h.running ? 'still working' : 'done'}; last update: ${h.last})` : h.running ? ' (still working)' : ''}`));
  // Claude's closing reply to each request, whole: it holds the warnings and loose ends ("not committed",
  // "before you deploy") that "Where it stands now", one or two sentences, leaves out.
  const ends = turnEnds(msgs).slice(-4);
  add("Claude's reply at the end of each request", ends.map(t => `- ${tidyPaths(shorten(redact(clean(t)), 2500), root)}`));
  const said = new Set(ends.map(clean));
  add("Claude's explanations (the reasons behind the work)", reasons(msgs, 8, said).map(t => `- ${tidyPaths(t, root)}`));
  add('Files changed', l.changes.slice(-20).map(c => `- ${c.ask.startsWith('Helper agent') ? c.ask : `For "${c.ask}"`}: ${c.files.map(f => `${file(f.file)} (+${f.added} -${f.removed})`).join(', ')}`));
  add('What you approved', l.approvals.filter(a => a.risk !== 'low').map(a => `- ${a.what}: ${a.say}`));
  add('Still open', (e.open ?? []).map(point));
  if (l.latest) add('Where it stands now', [l.latest]);
  const text = redact(out.join('\n'));
  return text.length > max ? text.slice(0, max) + '\n…' : text;
}

/** The digest's one-line take for the briefing when no course exists: the latest words, cleaned. */
export const latestLine = (l: Lessons) => l.latest && redact(firstSentences(l.latest, 240) ?? l.latest);
