// The course: the one request's prompt, and validation of its reply. Every field is
// checked and clamped; anything malformed is dropped, never shown. Pure.

import type { Course, Did, Lesson, Lessons, QuizItem, Stats } from '../../types';
import { EMPHASIS, KINDS, type Kind, redact, redactDeep } from './digest';
import { parseReply, mix } from './prebake';

export { parseReply };

/** The prompt. `taught` lists topics earlier courses in this project already covered. */
export function coursePrompt(digest: string, kind: Kind, taught: readonly string[]): string {
  return `Halftime, a study aid the user installed in Claude Code, asks you to write a short course. The user hit their usage limit and has a few minutes to learn what Claude did in their project, so they understand it instead of just shipping it. Think of a good Coursera unit about their own project.

Rules:
- Use only facts from the session digest below. Never invent numbers, files, results or options; every number you write appears in the digest exactly. Never mention the digest, notes, cards or session record.
- "not confirmed yet" belongs only in "holding", at most twice. Never build a lesson, a cost or a reason on an unknown: two solid lessons beat four thin ones.
- Write for a smart person who may be new to this field. Plain words, sentences under 22 words. Never write "simply", "just" or "obviously".
- Define every term, acronym or internal code in a few words the first time it appears ANYWHERE, including the briefing and the questions, or replace it with plain words.
- Say "you" for the user and "Claude" for what Claude or its helper agents did. Never "the user" or "the team". A decision the user made is "you chose", not Claude's.
- Lessons are TOPICS, not events: a concrete thing in this project (an API, a technique, a metric, a tool, a part of the code, a concept), named in at most 4 words. Lesson 1 is the central subject: your latest request, or the root cause of the main problem. The briefing's issue names it. Each lesson teaches something true of this project, with its own evidence: no two lessons rest on the same fact. Do not teach about Claude's own tools or folders unless the session was about them.
- Each lesson teaches its topic: what it is, where it is used in this project, what Claude did with it and why, and one takeaway.
- A "why" gives the underlying cause itself, never where it came from, and never restates the decision.
- Every decision Claude explained (one approach picked over another, a trade-off accepted, something deliberately left out) is a "choice": the guess-first card is the most useful part of the course. At least one lesson's "did" MUST be a "choice": the session's main decision. Its options are only ones the digest shows, plus "leave it as it is" when the digest shows no other; its "why" is the reason in the digest.
- Every separate thing you asked for gets a lesson of its own: two requests in the session means at least two lessons, one about each.
- "fixed" and "holding" must agree with "Where it stands now", which overrides earlier notes. Never list as open something it shows as done. "holding" lists every risk, warning or unfinished step Claude's last reply names (work not committed, a check not run, something to do before shipping); it is empty only when they name none.
- Every wrong option is a mistake a thoughtful newcomer could really make: same topic, about the same length as the right one. Never silly (bad: "Because of the font colour").
- Every question, lesson check or final, asks why or how, or applies an idea to a new case; never one whose answer is a number, a name, a setting or a status. Each lesson check is answerable from that lesson's own cards; final questions never repeat a check. No sentence appears in two lessons.
- First decide the kind of work from the digest, then stress what that kind needs:
${KINDS.map(k => `  ${k}: ${EMPHASIS[k]}`).join('\n')} (general: when none of the others fits)
  (Halftime's own guess, often wrong: ${kind}.)
- Never include secrets, keys, passwords, tokens or personal data.${taught.length ? `\n- Already taught in earlier courses, so do not teach these again (build on them instead): ${taught.slice(0, 40).join('; ')}.` : ''}

Reply with ONE JSON object and nothing else:
{"kind": "<the kind of work, from the list above>", "title": "<what this session tackled, max 8 words>",
 "briefing": {"issue": "<the problem or goal, max 30 words>", "fixed": ["<what is done or fixed, max 20 words>"] (1-3), "holding": ["<what is still open, blocked or unverified, max 20 words>"] (0-3), "trivia": "<one surprising true fact from the session, max 35 words>"},
 "lessons": [ (2-5, the most useful first)
  {"topic": "<max 4 words>", "summary": "<what you will learn, max 12 words>",
   "what": {"title": "<the idea in one sentence, max 14 words>", "body": "<max 60 words>", "analogy": "<optional everyday comparison, max 20 words>", "breaks": "<where that comparison stops working, max 15 words; required with an analogy>", "more": "<optional deeper detail, max 80 words>"},
   "where": {"body": "<where and how it is used in this project, max 50 words>", "file": "<a file path from the digest, optional>"},
   "did": EITHER {"kind": "choice", "problem": "<the situation that needed a choice, max 30 words>", "options": ["<2-3 realistic options including the chosen one, max 12 words each>"], "picked": <index of the chosen option>, "chose": "<max 30 words>", "why": "<max 30 words>", "cost": "<the trade-off, max 30 words>"}
          OR {"kind": "step", "what": "<what Claude did with this topic, max 40 words>", "why": "<max 40 words>", "evidence": "<the result, file or number that shows it, max 20 words>"},
   "takeaway": "<one sentence to remember, max 20 words>",
   "next": "<a prompt you could send Claude next to go further on this topic in this project, max 20 words>",
   "check": {"ask": "<question about this topic>", "options": ["<a>", "<b>", "<c>"], "right": <0-2>, "why": "<max 20 words>"}}],
 "final": [ (4-8) {"ask": "<question mixing the lessons; about why or how, not trivia>", "options": ["<a>", "<b>", "<c>"], "right": <0-2>, "why": "<max 20 words>"}]}
Use a "choice" for at least one lesson when the digest shows a real decision. No code fences, no commentary.

Session digest:
${digest}`;
}

const s = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // The reader never saw the digest, so it is "the session" to them.
  const t = v.replace(/\s+/g, ' ').trim().replace(/\b(the|this) (session )?digest\b/gi, '$1 session').replace(/\bthe user\b/gi, 'you');
  return t ? (t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t) : undefined;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && v.trim()) ? Number(v) : NaN);
const strings = (v: unknown, max: number, n: number) => arr(v).map(x => s(x, max)).filter((x): x is string => !!x).slice(0, n);

/** A question with 2-4 whole options and a valid answer, the answer moved to a position set by its text. */
export function quizItem(v: unknown): QuizItem | undefined {
  const x = obj(v), raw = arr(x.options), options = raw.map(o => s(o, 110)).filter((o): o is string => !!o);
  const right = int(x.right), ask = s(x.ask, 220), why = s(x.why, 220);
  // A bad option drops the question: filtering it out would shift which one is right.
  if (!ask || !why || options.length !== raw.length || options.length < 2 || options.length > 4 || !Number.isInteger(right) || right < 0 || right >= options.length) return undefined;
  if (new Set(options).size !== options.length) return undefined;
  return { ask, why, ...mix(options, right, ask) };
}

function did(v: unknown, seed: string): Did | undefined {
  const x = obj(v);
  if (x.kind === 'choice') {
    const raw = arr(x.options), options = raw.map(o => s(o, 110)).filter((o): o is string => !!o), picked = int(x.picked);
    const problem = s(x.problem, 260), chose = s(x.chose, 260), why = s(x.why, 260), cost = s(x.cost, 260);
    if (problem && chose && why && cost && options.length === raw.length && options.length >= 2 && options.length <= 4 && new Set(options).size === options.length
      && Number.isInteger(picked) && picked >= 0 && picked < options.length) {
      const m = mix(options, picked, seed);
      return { kind: 'choice', problem, options: m.options, picked: m.right, chose, why, cost };
    }
    // A choice that cannot be guessed still teaches as a step.
    if (chose && why) return { kind: 'step', what: chose, why };
    return undefined;
  }
  const what = s(x.what, 320), why = s(x.why, 320), evidence = s(x.evidence, 180);
  return what && why ? { kind: 'step', what, why, ...(evidence ? { evidence } : {}) } : undefined;
}

function lesson(v: unknown): Lesson | undefined {
  const x = obj(v), w = obj(x.what), wh = obj(x.where);
  const topic = s(x.topic, 48), summary = s(x.summary, 120), title = s(w.title, 160), body = s(w.body, 480);
  const whereBody = s(wh.body, 400), takeaway = s(x.takeaway, 200), check = quizItem(x.check);
  const d = topic ? did(x.did, topic) : undefined;
  if (!topic || !summary || !title || !body || !whereBody || !takeaway || !check || !d) return undefined;
  const analogy = s(w.analogy, 180), breaks = s(w.breaks, 140), more = s(w.more, 600), next = s(x.next, 180);
  // A file is a path: no spaces, no placeholder brackets.
  const rawFile = s(wh.file, 160), file = rawFile && /^[^\s<>]+\.[\w]+$|^[^\s<>]*\/[^\s<>]+$/.test(rawFile) ? rawFile : undefined;
  return {
    topic, summary,
    // An analogy without its limit can mislead, so it is shown only with one.
    what: { title, body, ...(analogy && breaks ? { analogy, breaks } : {}), ...(more ? { more } : {}) },
    where: { body: whereBody, ...(file ? { file } : {}) },
    did: d, takeaway, ...(next ? { next } : {}), check,
  };
}

/** A stable id for a course: its title and time, hashed. */
export function courseId(title: string, createdAt: number): string {
  let h = 2166136261;
  for (const c of `${title}|${createdAt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return `c${createdAt.toString(36)}${h.toString(36)}`;
}

/**
 * The course from the model's reply, or undefined when it is not usable: it needs a
 * title, an issue and at least two whole lessons. Lesson topics repeat at most once,
 * and every string is cleaned of secrets.
 */
export function validateCourse(raw: unknown, meta: { kind: string; createdAt: number; model: string; stats: Stats }): Course | undefined {
  const r = obj(raw), b = obj(r.briefing);
  const title = s(r.title, 80), issue = s(b.issue, 260);
  const seen = new Set<string>();
  const lessons = arr(r.lessons).map(lesson).filter((l): l is Lesson => {
    if (!l) return false;
    const k = l.topic.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
  if (!title || !issue || lessons.length < 2) return undefined;
  const final = arr(r.final).map(quizItem).filter((q): q is QuizItem => !!q).slice(0, 8);
  const trivia = s(b.trivia, 300);
  // The model reads the whole digest, so its kind wins over Halftime's guess when it names a known one.
  const kind = typeof r.kind === 'string' && (KINDS as readonly string[]).includes(r.kind) ? r.kind : meta.kind;
  return redactDeep({
    id: courseId(title, meta.createdAt), title, kind, createdAt: meta.createdAt, model: meta.model,
    briefing: { issue, fixed: strings(b.fixed, 200, 3), holding: strings(b.holding, 200, 3), ...(trivia ? { trivia } : {}) },
    lessons, final, stats: meta.stats,
  });
}

/** All questions of a course with their keys: each lesson's check, then the final quiz. */
export function questionsOf(c: Course): Array<{ key: string; q: QuizItem; topic: string }> {
  return [
    ...c.lessons.map((l, i) => ({ key: `l${i}.check`, q: l.check, topic: l.topic })),
    ...c.final.map((q, i) => ({ key: `f${i}`, q, topic: c.title })),
  ];
}

/** Right answers out of questions answered, over the whole course. */
export function scoreOf(c: Course, answers: Readonly<Record<string, number>>): { right: number; total: number; answered: number } {
  const qs = questionsOf(c);
  return {
    right: qs.filter(x => answers[x.key] === x.q.right).length,
    total: qs.length,
    answered: qs.filter(x => answers[x.key] !== undefined).length,
  };
}

/**
 * Puts the session's own diff under each lesson's "where it lives" card, when the file
 * the lesson names was changed in the session. Halftime attaches it, so it is real code,
 * never written by the model; secrets are removed, and it stays short.
 */
export function attachCode(c: Course, l: Lessons): Course {
  // The latest change to a file comes first: that is usually the fix the lesson is about.
  const files = [...l.changes].reverse().flatMap(ch => ch.files);
  const find = (name: string) => {
    const n = name.replace(/\\/g, '/').replace(/^\.?\//, '');
    return files.find(f => f.file === n) ?? files.find(f => f.file.endsWith('/' + n) || n.endsWith('/' + f.file));
  };
  return {
    ...c,
    lessons: c.lessons.map(ls => {
      const f = ls.where.file ? find(ls.where.file) : undefined;
      if (!f || !f.diff.length) return ls;
      const lines = f.diff.slice(0, 10), oldN = lines.filter(d => d.op !== '+').length, newN = lines.filter(d => d.op !== '-').length;
      const code = `@@ -1,${oldN} +1,${newN} @@\n` + lines.map(d => d.op + redact(d.text).slice(0, 160)).join('\n');
      return { ...ls, where: { ...ls.where, file: f.file, code } };
    }),
  };
}
