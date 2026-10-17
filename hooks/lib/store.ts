// The course library and review deck as kept in the plugin store, per project. What
// comes back from the store is checked before use: an older Halftime, a hand edit or a
// half-written value must never break the pane. Pure.

import type { CourseRecord, Progress, ReviewItem } from '../../types';

/** Courses kept per project. The whole store is capped at 4 MiB across every project. */
export const MAX_COURSES = 8;
/** Missed questions kept per project. */
export const MAX_REVIEW = 30;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isQuiz = (v: unknown) => isObj(v) && isStr(v.ask) && Array.isArray(v.options) && v.options.every(isStr) && typeof v.right === 'number' && isStr(v.why);

function progressOf(v: unknown): Progress {
  const p = isObj(v) ? v : {};
  const answers: Record<string, number> = {};
  if (isObj(p.answers)) for (const [k, x] of Object.entries(p.answers)) if (typeof x === 'number' && Number.isInteger(x)) answers[k] = x;
  return { read: Array.isArray(p.read) ? p.read.filter(isStr) : [], answers, ...(typeof p.finishedAt === 'number' ? { finishedAt: p.finishedAt } : {}) };
}

const strings = (v: unknown) => Array.isArray(v) && v.every(isStr);

/** Every field the pane draws is there and of the right type, so a damaged record is skipped, never drawn. */
function wholeLesson(l: unknown): boolean {
  if (!isObj(l) || !isStr(l.topic) || !isStr(l.summary) || !isStr(l.takeaway) || !isQuiz(l.check)) return false;
  const w = l.what, wh = l.where, d = l.did;
  if (!isObj(w) || !isStr(w.title) || !isStr(w.body) || !isObj(wh) || !isStr(wh.body) || !isObj(d)) return false;
  if (d.kind === 'choice') return isStr(d.problem) && strings(d.options) && (d.options as string[]).length >= 2 && typeof d.picked === 'number'
    && d.picked >= 0 && d.picked < (d.options as string[]).length && isStr(d.chose) && isStr(d.why) && isStr(d.cost);
  return d.kind === 'step' && isStr(d.what) && isStr(d.why);
}

/** Courses that are whole enough to draw; anything else is skipped. */
export function readLibrary(v: unknown): CourseRecord[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r): CourseRecord[] => {
    if (!isObj(r) || !isObj(r.course)) return [];
    const c = r.course, b = c.briefing, st = c.stats;
    const whole = isStr(c.id) && isStr(c.title) && isStr(c.kind) && typeof c.createdAt === 'number'
      && isObj(b) && isStr(b.issue) && strings(b.fixed) && strings(b.holding)
      && Array.isArray(c.lessons) && c.lessons.length > 0 && c.lessons.every(wholeLesson)
      && Array.isArray(c.final) && c.final.every(isQuiz)
      && isObj(st) && ['messages', 'commands', 'helpers', 'files', 'failed'].every(k => typeof st[k] === 'number');
    return whole ? [{ course: c as unknown as CourseRecord['course'], progress: progressOf(r.progress) }] : [];
  }).slice(0, MAX_COURSES);
}

/**
 * Two sessions in one project each keep a copy of the library. A save merges the stored
 * copy with this one, so neither erases the other's courses or answers: answers and
 * read cards are joined (an answer is never changed once given), newest course first.
 */
export function mergeLibrary(stored: readonly CourseRecord[], mine: readonly CourseRecord[]): CourseRecord[] {
  const by = new Map<string, CourseRecord>();
  for (const r of [...stored, ...mine]) {
    const had = by.get(r.course.id);
    if (!had) { by.set(r.course.id, r); continue; }
    const finishedAt = [had.progress.finishedAt, r.progress.finishedAt].filter((x): x is number => typeof x === 'number');
    by.set(r.course.id, { course: r.course, progress: {
      read: [...new Set([...had.progress.read, ...r.progress.read])],
      answers: { ...had.progress.answers, ...r.progress.answers, ...had.progress.answers },
      ...(finishedAt.length ? { finishedAt: Math.min(...finishedAt) } : {}),
    } });
  }
  return [...by.values()].sort((a, b) => b.course.createdAt - a.course.createdAt).slice(0, MAX_COURSES);
}

/** The review deck after a save: this session's, plus another session's, minus what was answered right here. */
export function mergeReview(stored: readonly ReviewItem[], mine: readonly ReviewItem[], cleared: ReadonlySet<string>): ReviewItem[] {
  const seen = new Set<string>();
  return [...mine, ...stored].filter(x => !cleared.has(x.ask) && !seen.has(x.ask) && !!seen.add(x.ask)).slice(0, MAX_REVIEW);
}

export function readReview(v: unknown): ReviewItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is ReviewItem => isQuiz(x) && isStr((x as Record<string, unknown>).topic) && isStr((x as Record<string, unknown>).from)).slice(0, MAX_REVIEW);
}

/** Adds a missed question once (by its wording), or removes one answered right. */
export function withReview(list: readonly ReviewItem[], item: ReviewItem, right: boolean): ReviewItem[] {
  const rest = list.filter(x => x.ask !== item.ask);
  return right ? rest : [item, ...rest].slice(0, MAX_REVIEW);
}
