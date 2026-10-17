// Session notes: what Halftime can show without any model request, read straight from
// the session. Chapters appear only when the session has something real for them. Pure
// and cheap, so the pane can call it on every draw.

import type { Approval, Bug, Lessons, Point } from '../types';
import { dependentsOf } from './lib/graph';

export type Step =
  | { kind: 'bug'; key: string; bug: Bug; focus: string[] }
  | { kind: 'approvals'; key: string; items: Approval[]; focus: string[] }
  | { kind: 'files'; key: string; focus: string[] }
  | { kind: 'depends'; key: string; center: string; direct: string[]; indirect: string[]; focus: string[] }
  | { kind: 'list'; key: string; title: string; lead?: string; items: Item[]; focus: string[] };

/** One entry of a list page: a title, labelled lines, and optionally a prompt to save. */
export type Item = { title?: string; lines: Array<[label: string | undefined, text: string]>; todo?: string; dim?: boolean };

export type Chapter = { title: string; note: string; steps: Step[] };
export type Notes = { chapters: Chapter[] };

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Graph ids that a file name refers to. */
export function idsFor(l: Lessons, files: readonly string[]): string[] {
  const ids = l.graph.nodes.map(n => n.id);
  return ids.filter(id => files.some(f => id === f || id.endsWith('/' + f) || f.endsWith('/' + id)));
}

/** The file the most other files use, if any file is used at all. */
function hub(l: Lessons): string | undefined {
  const users = (id: string) => l.graph.edges.filter(([, b]) => b === id).length;
  return l.graph.nodes.map(n => ({ id: n.id, u: users(n.id), a: n.added })).filter(x => x.u > 0).sort((x, y) => y.u - x.u || y.a - x.a)[0]?.id;
}

/** A labelled entry keeps its points beneath the label; a lone line stands as it is. */
const plain = (xs: readonly Point[] | undefined): Item[] =>
  (xs ?? []).map(p => p.points.length ? { title: p.head, lines: p.points.map(t => [undefined, t] as [undefined, string]) } : { lines: [[undefined, p.head]] });

export function notesOf(l: Lessons): Notes {
  const chapters: Chapter[] = [];
  const e = l.earlier, list = (key: string, title: string, items: Item[], lead?: string): Step[] =>
    items.length ? [{ kind: 'list', key, title, lead, items, focus: [] }] : [];

  // What happened: the summary's account of the earlier work, then the helpers.
  const one = [
    ...list('asked', 'What you set out to do', plain(e.asked), 'From the summary Claude Code wrote when this conversation got long.'),
    ...list('solved', 'What was worked out', plain([...(e.solved ?? []), ...(e.now ?? [])].slice(0, 8))),
    ...list('helpers', 'What your helper agents did', l.helpers.slice(-12).map(h => ({
      title: h.task, dim: !h.report,
      lines: [h.report ? [undefined, h.report] : h.last ? [h.running ? 'Still working. Last update' : 'Its last words', h.last] : [undefined, h.running ? 'Still working when Halftime read the session.' : 'Finished without a written report.'],
        ...(h.files ? [[undefined, `Changed ${plural(h.files, 'file')}.`] as [undefined, string]] : [])],
    })), `Claude handed ${plural(l.helpers.length, 'task')} to helper agents, each working on its own.${l.helpers.some(h => h.running) ? ' Some were still working when Halftime read the session.' : ''}`),
  ];
  if (one.length) chapters.push({ title: 'What happened', note: [e.asked && 'what you asked for', l.helpers.length && plural(l.helpers.length, 'helper task')].filter(Boolean).join(', ') || 'in order', steps: one });

  // What went wrong: failing checks that later passed, then the summary's errors.
  const bugs = l.bugs.slice(-3).reverse();
  const two: Step[] = [
    ...bugs.map((bug, i) => ({ kind: 'bug' as const, key: `bug.${i}`, bug, focus: idsFor(l, bug.fix.map(f => f.file)) })),
    ...list('errors', 'Problems hit earlier, and their fixes', plain(e.errors)),
  ];
  if (two.length) chapters.push({ title: 'What went wrong, and how it was fixed', note: plural(bugs.length + (e.errors?.length ?? 0), 'problem'), steps: two });

  const ideas = plain(e.ideas);
  if (ideas.length) chapters.push({ title: 'Terms that came up', note: plural(ideas.length, 'term'), steps: list('ideas', 'Terms that came up', ideas, 'As the summary lists them. The course explains them properly.') });

  // How the files fit together, only when they use each other.
  const five: Step[] = [];
  if (l.graph.edges.length) five.push({ kind: 'files', key: 'files', focus: l.graph.nodes.map(n => n.id) });
  const center = hub(l);
  if (center) {
    const { direct, indirect } = dependentsOf(l.graph, center);
    five.push({ kind: 'depends', key: 'depends', center, direct, indirect, focus: [center, ...direct, ...indirect] });
  }
  if (five.length) chapters.push({ title: 'How your files fit together', note: `${plural(l.graph.nodes.length, 'file')} and how they use each other`, steps: five });

  const risky = l.approvals.filter(a => a.risk !== 'low').length;
  if (l.approvals.length) chapters.push({ title: 'What you approved', note: `${plural(l.approvals.length, 'item')}${risky ? `, ${risky} worth a look` : ''}`, steps: [{ kind: 'approvals', key: 'approvals', items: l.approvals, focus: [] }] });

  const open = (e.open ?? []).slice(0, 8);
  if (open.length) chapters.push({ title: 'Before you continue', note: `${plural(open.length, 'thing')} still open`, steps: list('open', 'Before you continue', plain(open).map((it, i) => ({ ...it, todo: `Next: ${open[i]!.head}` })), 'Still open, unchecked or risky. Save any of these as a prompt for when Claude is back.') });

  return { chapters };
}

/** Nodes the user has learned about: the focus of every step they read. */
export function litOf(n: Notes, read: readonly string[]): string[] {
  const lit = new Set<string>();
  for (const ch of n.chapters) for (const s of ch.steps) if (read.includes(s.key)) s.focus.forEach(f => lit.add(f));
  return [...lit];
}
