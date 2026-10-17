import type { CourseRecord } from '../../types';
import { PAGE } from './page';

const html = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * The course as one self-contained web page. It starts from your progress in the pane and
 * then keeps its own in the browser. Everything it shows travels as JSON inside the page,
 * written so no text in the course can end the script early.
 */
export function coursePage(rec: CourseRecord, o: { project: string; kind: string; resetsAt?: number; saved: readonly string[] }): string {
  const c = rec.course, p = rec.progress;
  const answers: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.answers)) {
    const l = /^l(\d+)\.check$/.exec(k), f = /^f(\d+)$/.exec(k);
    if (l) answers[`lesson:${l[1]}`] = v; else if (f) answers[`final:${f[1]}`] = v;
  }
  const data = {
    course: { id: c.id, title: c.title, briefing: c.briefing, lessons: c.lessons, final: c.final, stats: c.stats },
    project: o.project, kind: o.kind, resetsAt: o.resetsAt && o.resetsAt > 0 ? o.resetsAt : null, saved: o.saved,
    progress: { done: c.lessons.map((_, i) => i).filter(i => p.answers[`l${i}.check`] !== undefined), answers, briefed: p.read.includes('briefing') },
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return PAGE.replace('__TITLE__', () => html(`${c.title} · Halftime`)).replace('__DATA__', () => json);
}

/** Where a course's page is saved: one file per course, under Claude Code's folder. */
export function pagePath(configDir: string, project: string, rec: CourseRecord): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'course';
  return `${configDir.replace(/[\\/]+$/, '')}/halftime/${slug(project)}/${slug(rec.course.title)}-${rec.course.id.slice(-6)}.html`;
}
