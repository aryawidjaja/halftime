// The course in the pane: home, briefing, lessons (four cards and a check), the final
// quiz, the score and badge, the review deck and the library. Pure: state comes in
// through Ctx, every change goes out through Act.
//
// An answered question stays answered: reading a course again shows your answers and
// never asks twice. A missed question goes to the review deck for the next break.

import type { CourseRecord, Lesson, Progress, QuizItem, UiState } from '../types';
import { questionsOf, scoreOf } from './lib/teach';
import { btn, clockTime, cta, field, home, nav, plural, row, section, setUi, todoButton, waitText, type Ctx } from './ui';

export const KIND: Record<string, string> = {
  admin: 'Quick task', housekeeping: 'Machine cleanup', deploy: 'Release', ml: 'ML research', science: 'Research', firefight: 'Production fix',
  ui: 'Design work', research: 'Web research', explain: 'Understanding code', refactor: 'Refactor', fix: 'Bug fix', build: 'New feature', planning: 'Planning', writing: 'Writing', general: 'Session',
};
const CARDS = ['What it is', 'Where it lives in your project', 'What Claude did, and why', 'Takeaway', 'Lesson check'];

const lessonDone = (p: Progress, i: number) => p.answers[`l${i}.check`] !== undefined;
const finalDone = (r: CourseRecord) => r.course.final.every((_, i) => r.progress.answers[`f${i}`] !== undefined);
export const finished = (r: CourseRecord) => r.course.lessons.every((_, i) => lessonDone(r.progress, i)) && finalDone(r);
const minutes = (r: CourseRecord) => 1 + r.course.lessons.length * 3 + Math.ceil(r.course.final.length / 2);

/** Records a card as read, then moves the view. */
function go(c: Ctx, r: CourseRecord, ui: (u: UiState) => UiState, key?: string) {
  return () => c.act.progress(r.course.id, p => (key && !p.read.includes(key) ? { ...p, read: [...p.read, key] } : p), ui);
}

/** Answers a question once. A miss on a check or quiz question goes to the review deck. */
function answer(c: Ctx, r: CourseRecord, key: string, i: number, q: QuizItem, topic: string, graded = true) {
  return () => {
    if (r.progress.answers[key] !== undefined) return;
    c.act.progress(r.course.id, p => (p.answers[key] !== undefined ? p : { ...p, answers: { ...p.answers, [key]: i } }));
    if (graded && i !== q.right) c.act.review({ ...q, topic, from: r.course.id }, false);
  };
}

/** The question, as buttons until answered, then the result: the same on a second reading. */
function question(c: Ctx, r: CourseRecord, key: string, q: QuizItem, topic: string, graded = true) {
  const { Text, Box } = c.el;
  const a = r.progress.answers[key];
  if (a === undefined) return <Box flexDirection="column">{q.options.map((o, i) => btn(c, `opt${i}`, o, answer(c, r, key, i, q, topic, graded), String(i + 1)))}</Box>;
  return (
    <Box flexDirection="column">
      {q.options.map((o, i) => <Text color={i === q.right ? 'success' : i === a ? 'error' : 'inactive'}>{i === q.right ? '✓' : i === a ? '✕' : ' '}  {o}</Text>)}
      <Text color="text"><Text color={a === q.right ? 'success' : 'error'}>{a === q.right ? 'Right.' : 'Not quite.'}</Text> {q.why}</Text>
    </Box>
  );
}

/** What the big button on the course home does next. */
function nextStep(c: Ctx, r: CourseRecord): { label: string; press: () => void } {
  const p = r.progress, L = r.course.lessons;
  if (finished(r)) return { label: 'See your score and badge →', press: setUi(c, u => ({ ...u, view: 'score' })) };
  if (!p.read.includes('briefing')) return { label: 'Start with the briefing (1 min) →', press: setUi(c, u => ({ ...u, view: 'briefing' })) };
  const i = L.findIndex((_, k) => !lessonDone(p, k));
  if (i >= 0) {
    const card = Math.max(0, ...[0, 1, 2, 3, 4].filter(k => p.read.includes(`l${i}.c${k}`)).map(k => k + 1));
    return {
      label: `${card ? 'Continue' : 'Start'} lesson ${i + 1}: ${L[i]!.topic} →`,
      press: setUi(c, u => ({ ...u, view: 'lesson', lesson: i, card: Math.min(card, 4) })),
    };
  }
  if (!finalDone(r)) return { label: `Take the final quiz (${plural(r.course.final.length, 'question')}) →`, press: setUi(c, u => ({ ...u, view: 'final', final: r.course.final.findIndex((_, k) => p.answers[`f${k}`] === undefined) })) };
  return { label: 'See your score and badge →', press: setUi(c, u => ({ ...u, view: 'score' })) };
}

/* ---------- home ---------- */

export function vHome(c: Ctx) {
  const { Box, Text } = c.el;
  const head = c.lim
    ? <Text color="inactive">{c.lim.resetsAt ? `Claude is back at ${clockTime(c.lim.resetsAt)}, in ${waitText(c.lim.resetsAt - c.now)}.` : 'Claude is paused until your limit resets.'} Here is what it did, while you wait.</Text>
    : <Text color="inactive">What Claude did in this session, as a short course. No one grades it but you.</Text>;
  const r = c.rec;
  const others = c.library.filter(x => x.course.id !== r?.course.id);
  const review = c.review.length ? row(c, 'review', 'v', `Review: ${plural(c.review.length, 'question')} you missed before`, 'about 1 min', setUi(c, u => ({ ...u, view: 'review', review: 0 }))) : null;
  const more = [
    c.notes?.chapters.length || c.L?.changes.length ? row(c, 'notes', 'n', 'Session notes', 'the facts, read straight from the session', setUi(c, u => ({ ...u, view: 'notes' }))) : null,
    row(c, 'prompts', 'p', 'Prompts for when Claude is back', c.saved.length ? `${c.saved.length} saved` : 'none yet', setUi(c, u => ({ ...u, view: 'prompts' }))),
    others.length ? row(c, 'library', 'l', 'Your courses in this project', `${plural(others.length, 'course')}, ${plural(c.library.filter(finished).length, 'badge')}`, setUi(c, u => ({ ...u, view: 'library' }))) : null,
  ];
  const footer = [
    c.always ? <Box flexDirection="row" flexWrap="wrap" columnGap={2}><Text color="inactive">Halftime writes a course before each limit, in 1 small request.</Text>{btn(c, 'off', 'Ask me first instead', () => c.act.consent('off'))}</Box> : null,
  ];

  if (r) {
    const p = r.progress, L = r.course.lessons, done = L.filter((_, i) => lessonDone(p, i)).length, sc = scoreOf(r.course, p.answers);
    const mine = r.course.id === c.current;
    const step = nextStep(c, r);
    return [
      mine ? head : nav(c, [<Text color="inactive">From {new Date(r.course.createdAt).toLocaleDateString()}</Text>, btn(c, 'this', '← Back to this session', setUi(c, u => ({ ...u, course: c.current, view: 'home' })), 'b')]),
      <Box flexDirection="column">
        <Text color="text">{r.course.title}</Text>
        <Text color="inactive">{KIND[r.course.kind] ?? 'Session'} · a briefing, {plural(L.length, 'lesson')} and a final quiz · about {minutes(r)} min</Text>
      </Box>,
      cta(c, 'next', step.label, step.press, 's'),
      c.surface === 'mobile' ? null : row(c, 'browser', 'o', 'Open in your browser',
        c.browser.includes(r.course.id) ? 'opened · your answers there stay in the browser' : 'the same course, full size', () => c.act.browser(r.course.id)),
      <Box flexDirection="column">
        {L.map((l, i) => row(c, `lesson${i}`, String(i + 1), `${lessonDone(p, i) ? '✓ ' : c.surface === 'terminal' ? '' : `${i + 1}. `}${l.topic}`,
          `${l.summary} · ${lessonDone(p, i) ? (p.answers[`l${i}.check`] === l.check.right ? 'done' : 'done, to review') : p.read.some(k => k.startsWith(`l${i}.`)) ? 'in progress' : '3 min'}`,
          setUi(c, u => ({ ...u, view: 'lesson', lesson: i, card: 0 }))))}
      </Box>,
      <Text color="inactive">{done} of {L.length} lessons done{sc.answered ? `, ${sc.right} of ${sc.answered} answers right so far` : ''}.</Text>,
      review,
      <Box flexDirection="column"><Text color="inactive">More</Text>{more}</Box>,
      ...footer,
    ];
  }

  // No course yet: the free briefing, and the way to get the course.
  const Lx = c.L;
  const limited = !!c.lim && !c.lim.simulated;
  const make = c.preparing
    ? <Text color="claude">Writing your course with {c.model}… this can take up to three minutes.</Text>
    : !limited
      ? <Box flexDirection="column">{cta(c, 'prepare', 'Make this session\'s course →', () => c.act.prepare(), 'g')}<Text color="inactive">A briefing, lessons on the topics in your project, quizzes and a badge. 1 small request to {c.model}{c.model === 'Claude Haiku' ? ', the lightest model' : ''}.</Text></Box>
      : !c.always
        ? <Box flexDirection="column">{cta(c, 'always', 'Write a course before my next limit →', () => c.act.consent('on'), 'g')}<Text color="inactive">Claude cannot write one during a limit. Halftime will then prepare it at 85% of your next limit, in 1 small request.</Text></Box>
        : <Text color="inactive">Your next course is written before your next limit.</Text>;
  const tiles = Lx ? numbers({ commands: Lx.counts.commands, helpers: Lx.helpers.length, files: new Set(Lx.changes.flatMap(x => x.files.map(f => f.file))).size, failed: Lx.bugs.length, messages: 0 }) : '';
  const asked = Lx?.earlier.asked?.[0]?.head ?? Lx?.changes.find(x => !x.ask.startsWith('Work continued') && !x.ask.startsWith('Helper agent'))?.ask;
  return [
    head,
    Lx && (asked || Lx.latest || tiles) ? <Box flexDirection="column">
      {asked ? field(c, 'You asked', asked) : null}
      {Lx.latest ? field(c, 'Latest', Lx.latest) : null}
      {Lx.earlier.open?.length ? field(c, 'Still open', plural(Lx.earlier.open.length, 'item'), 'warning') : null}
      {tiles ? <Text color="inactive">{tiles}</Text> : null}
    </Box> : <Text color="inactive">Nothing happened in this session yet.</Text>,
    make,
    review,
    <Box flexDirection="column"><Text color="inactive">More</Text>{more}</Box>,
    ...footer,
  ];
}

/* ---------- briefing ---------- */

/** The session in numbers, as one sentence a person would say. Only what is there is mentioned. */
function numbers(s: { commands: number; helpers: number; files: number; failed: number; messages: number }): string {
  const did = [s.commands ? `ran ${plural(s.commands, 'command')}` : '', s.files ? `changed ${plural(s.files, 'file')}` : ''].filter(Boolean).join(' and ');
  const parts = [
    did ? `Claude ${did}${s.helpers ? `, with ${plural(s.helpers, 'helper agent')}` : ''}.` : s.helpers ? `${plural(s.helpers, 'helper agent')} worked on it.` : '',
    s.failed ? `${s.failed === 1 ? 'One check' : `${s.failed} checks`} failed before the fix.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export function vBriefing(c: Ctx) {
  const { Box, Text } = c.el;
  const r = c.rec;
  if (!r) return vHome(c);
  const b = r.course.briefing, first = r.course.lessons[0]!;
  const said = numbers(r.course.stats);
  return [
    <Text color="inactive">Briefing · {r.course.title}</Text>,
    <Box flexDirection="column">
      {field(c, 'The issue', b.issue)}
      {b.fixed.map(t => field(c, 'Done', t, 'success'))}
      {b.holding.map(t => field(c, 'Still open', t, 'warning'))}
    </Box>,
    said ? <Text color="inactive">{said}</Text> : null,
    b.trivia ? section(c, 'Did you know', <Text color="text">{b.trivia}</Text>) : null,
    nav(c, [
      cta(c, 'next', `Start lesson 1: ${first.topic} →`, go(c, r, u => ({ ...u, view: 'lesson', lesson: 0, card: 0 }), 'briefing'), 'n'),
      btn(c, 'menu', 'Course home', go(c, r, u => ({ ...u, view: 'home' }), 'briefing'), 'm'),
    ]),
  ];
}

/* ---------- a lesson: four cards and a check ---------- */

/**
 * A diff that fits the pane: lines cut to its width (a wrapped diff line reads as noise and
 * pushes the card's keys out of view), at most 8 lines after the hunk header. The header is
 * recounted for the lines kept: a count that disagrees makes the engine refuse the diff.
 */
export function fitCode(code: string, width: number): string {
  const max = Math.max(24, width - 8);
  const kept = code.split('\n').slice(1, 9);
  const oldN = kept.filter(l => !l.startsWith('+')).length, newN = kept.filter(l => !l.startsWith('-')).length;
  const cut = kept.map(l => (l.length > max ? l.slice(0, max - 1) + '…' : l));
  return [`@@ -1,${oldN} +1,${newN} @@`, ...cut].join('\n');
}

function cardBody(c: Ctx, r: CourseRecord, i: number, l: Lesson, card: number) {
  const { Box, Text, Code } = c.el;
  const key = `l${i}`;
  if (card === 0) {
    const deep = c.u.deeper.includes(key);
    return [
      <Text color="text">{l.what.title}</Text>,
      <Text color="text">{l.what.body}</Text>,
      l.what.analogy ? <Box flexDirection="column">{field(c, 'Like', l.what.analogy)}{field(c, 'Where that breaks', l.what.breaks ?? '')}</Box> : null,
      l.what.more && deep ? section(c, 'Deeper', <Text color="text">{l.what.more}</Text>) : null,
    ];
  }
  if (card === 1) return [
    <Text color="text">{l.where.body}</Text>,
    l.where.file ? <Text color="inactive">In {l.where.file}</Text> : null,
    l.where.code ? <Box flexDirection="column"><Code source={fitCode(l.where.code, c.width)} format="diff" path={l.where.file} /></Box> : null,
  ];
  if (card === 2) {
    const d = l.did;
    if (d.kind === 'step') return [
      field(c, 'What Claude did', d.what),
      field(c, 'Why', d.why),
      d.evidence ? field(c, 'Shown by', d.evidence) : null,
    ];
    const g = r.progress.answers[`${key}.guess`];
    if (g === undefined) return [
      field(c, 'The situation', d.problem),
      <Text color="text">What would you have done?</Text>,
      // A guess teaches by being made; it is not graded and never goes to review.
      question(c, r, `${key}.guess`, { ask: d.problem, options: d.options, right: d.picked, why: d.why }, l.topic, false),
      <Text color="inactive">Pick one to see what Claude chose. Not graded.</Text>,
    ];
    return [
      <Text color={g === d.picked ? 'success' : 'warning'}>{g === d.picked ? '✓ Same choice as Claude.' : `Claude chose differently. Your pick: ${d.options[g] ?? ''}`}</Text>,
      field(c, 'Claude chose', d.chose),
      field(c, 'Why', d.why),
      field(c, 'The trade-off', d.cost, 'warning'),
    ];
  }
  if (card === 3) return [
    <Text color="claude">{l.takeaway}</Text>,
    l.next ? <Box flexDirection="column"><Text color="inactive">A next step you could ask Claude for:</Text><Text color="text">{l.next}</Text>{todoButton(c, l.next, 'todo')}</Box> : null,
  ];
  return [
    <Text color="text">{l.check.ask}</Text>,
    question(c, r, `${key}.check`, l.check, l.topic),
  ];
}

export function vLesson(c: Ctx) {
  const { Text } = c.el;
  const r = c.rec, i = c.u.lesson, l = r?.course.lessons[i];
  if (!r || !l) return vHome(c);
  const card = Math.max(0, Math.min(4, c.u.card)), key = `l${i}`, n = r.course.lessons.length;
  const to = (k: number) => go(c, r, u => ({ ...u, view: 'lesson', lesson: i, card: k }), `${key}.c${card}`);
  const last = i === n - 1;
  const after = last
    ? (r.course.final.length ? go(c, r, u => ({ ...u, view: 'final', final: 0 }), `${key}.c4`) : go(c, r, u => ({ ...u, view: 'score' }), `${key}.c4`))
    : go(c, r, u => ({ ...u, view: 'lesson', lesson: i + 1, card: 0 }), `${key}.c4`);
  const guessing = card === 2 && l.did.kind === 'choice' && r.progress.answers[`${key}.guess`] === undefined;
  const checking = card === 4 && r.progress.answers[`${key}.check`] === undefined;
  return [
    <Text color="inactive">Lesson {i + 1} of {n} · {l.topic} · {CARDS[card]} ({card + 1} of 5)</Text>,
    ...cardBody(c, r, i, l, card),
    nav(c, [
      card > 0 ? btn(c, 'back', '← Back', to(card - 1), 'b') : null,
      card < 4 && !guessing ? cta(c, 'next', card === 3 ? 'Lesson check →' : 'Next →', to(card + 1), 'n') : null,
      card === 4 && !checking ? cta(c, 'next', last ? (r.course.final.length ? 'Final quiz →' : 'See your score →') : `Lesson ${i + 2}: ${r.course.lessons[i + 1]!.topic} →`, after, 'n') : null,
      // "I know this" skips the explanation and goes to what Claude did with it.
      card === 0 ? btn(c, 'know', 'I know this', to(2), 'k') : null,
      card === 0 && l.what.more ? btn(c, 'deeper', c.u.deeper.includes(key) ? 'Less' : 'Go deeper', setUi(c, u => ({ ...u, deeper: u.deeper.includes(key) ? u.deeper.filter(x => x !== key) : [...u.deeper, key] })), 'd') : null,
      btn(c, 'menu', 'Course home', home(c), 'm'),
    ]),
  ];
}

/* ---------- final quiz, score and badge ---------- */

export function vFinal(c: Ctx) {
  const { Text } = c.el;
  const r = c.rec, j = c.u.final, q = r?.course.final[j];
  if (!r || !q) return vScore(c);
  const n = r.course.final.length, key = `f${j}`, done = r.progress.answers[key] !== undefined;
  return [
    <Text color="inactive">Final quiz · question {j + 1} of {n}</Text>,
    <Text color="text">{q.ask}</Text>,
    question(c, r, key, q, r.course.title),
    nav(c, [
      j > 0 ? btn(c, 'back', '← Back', setUi(c, u => ({ ...u, final: j - 1 })), 'b') : null,
      done ? cta(c, 'next', j < n - 1 ? 'Next question →' : 'See your score →', setUi(c, u => (j < n - 1 ? { ...u, final: j + 1 } : { ...u, view: 'score' })), 'n') : null,
      btn(c, 'menu', 'Course home', home(c), 'm'),
    ]),
  ];
}

export function vScore(c: Ctx) {
  const { Text } = c.el;
  const r = c.rec;
  if (!r) return vHome(c);
  const sc = scoreOf(r.course, r.progress.answers), complete = finished(r);
  const strong = r.course.lessons.filter((l, i) => r.progress.answers[`l${i}.check`] === l.check.right).map(l => l.topic);
  const weak = questionsOf(r.course).filter(x => r.progress.answers[x.key] !== undefined && r.progress.answers[x.key] !== x.q.right).length;
  const badges = c.library.filter(finished).length;
  if (!complete) {
    const step = nextStep(c, r);
    return [<Text color="text">Almost there</Text>, <Text color="text">Finish every lesson check and the final quiz to earn the badge. {sc.answered} of {sc.total} answered.</Text>, cta(c, 'next', step.label, step.press, 'n'), btn(c, 'menu', 'Course home', home(c), 'm')];
  }
  return [
    <Text color="text">Course complete: {r.course.title}</Text>,
    <Text color="claude">You got {sc.right} of {sc.total} right. Badge {badges} in this project.</Text>,
    strong.length ? field(c, 'Strong', strong.join(', '), 'success') : null,
    weak ? field(c, 'To review', `${weak === 1 ? 'The question you missed comes' : `The ${weak} questions you missed come`} back as a short review at your next break.`, 'warning') : null,
    section(c, 'Share it', <Text color="text">{shareText(r, c.u.shareTitle)}</Text>),
    nav(c, [
      cta(c, 'share', c.surface === 'terminal' ? 'Copy to share' : 'Copy or save to share', () => c.act.share(r.course.id), 'c'),
      btn(c, 'title', c.u.shareTitle ? '✓ Course title included' : 'Include the course title', setUi(c, u => ({ ...u, shareTitle: !u.shareTitle })), 't'),
      btn(c, 'menu', 'Course home', home(c), 'm'),
    ]),
    <Text color="inactive">The title is off by default: it could reveal what your project is.</Text>,
  ];
}

/** What you share: your score and what you learned. The course title only when you turn it on. */
export function shareText(r: CourseRecord, withTitle: boolean): string {
  const sc = scoreOf(r.course, r.progress.answers);
  const what = withTitle ? ` on "${r.course.title}"` : '';
  return `I spent my Claude usage-limit break learning my own project${what}: ${plural(r.course.lessons.length, 'lesson')}, ${sc.right}/${sc.total} on the quiz. Made with Halftime for Claude Code: github.com/aryawidjaja/halftime`;
}

const MEDAL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><radialGradient id="g" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#f3d08b"/><stop offset=".6" stop-color="#c48a35"/><stop offset="1" stop-color="#8a5a1f"/></radialGradient></defs><circle cx="32" cy="32" r="30" fill="url(#g)" stroke="#3a2c1e" stroke-width="3"/><path d="M32 20c-5-3.5-11-4-16-3v24c5-.8 11-.2 16 3z" fill="#1f1e1d"/><path d="M32 20c5-3.5 11-4 16-3v24c-5-.8-11-.2-16 3z" fill="#1f1e1d" opacity=".85"/><rect x="37" y="25" width="3" height="11" rx="1.5" fill="#f3d08b"/><rect x="42" y="25" width="3" height="11" rx="1.5" fill="#f3d08b"/></svg>`;

/* ---------- review and library ---------- */

export function vReview(c: Ctx) {
  const { Text, Box } = c.el;
  const j = Math.min(c.u.review, Math.max(0, c.review.length - 1)), q = c.review[j], pick = c.u.reviewPick;
  if (!q) return [<Text color="text">Review</Text>, <Text color="success">Nothing left to review. Every question you missed is now right.</Text>, btn(c, 'menu', 'Home', home(c), 'm')];
  const next = setUi(c, u => ({ ...u, reviewPick: -1, review: c.review.length ? (j + 1) % c.review.length : 0 }));
  return [
    <Text color="inactive">Review · {j + 1} of {c.review.length} · from "{q.topic}"</Text>,
    <Text color="text">{q.ask}</Text>,
    pick < 0
      ? <Box flexDirection="column">{q.options.map((o, i) => btn(c, `opt${i}`, o, () => {
        // Right: it leaves the deck (the next question slides into this place). Wrong: it stays.
        if (i === q.right) { c.act.review(q, true); c.act.ui(u => ({ ...u, reviewPick: -1, review: Math.min(j, Math.max(0, c.review.length - 2)) })); return; }
        c.act.ui(u => ({ ...u, reviewPick: i }));
      }, String(i + 1)))}</Box>
      : <Box flexDirection="column">
        {q.options.map((o, i) => <Text color={i === q.right ? 'success' : i === pick ? 'error' : 'inactive'}>{i === q.right ? '✓' : i === pick ? '✕' : ' '}  {o}</Text>)}
        <Text color="text"><Text color="error">Not quite.</Text> {q.why} It stays in your review deck.</Text>
      </Box>,
    <Text color="inactive">Get it right and it leaves the deck.</Text>,
    nav(c, [
      pick >= 0 ? cta(c, 'next', c.review.length > 1 ? 'Next question →' : 'Try again', next, 'n') : null,
      btn(c, 'menu', 'Home', home(c), 'm'),
    ]),
  ];
}

export function vLibrary(c: Ctx) {
  const { Text, Box } = c.el;
  return [
    <Text color="text">Your courses in this project</Text>,
    <Text color="inactive">{plural(c.library.filter(finished).length, 'badge')} earned. Finished lessons open as you left them; their questions are not asked again.</Text>,
    <Box flexDirection="column">{c.library.map(r => {
      const sc = scoreOf(r.course, r.progress.answers);
      return row(c, `c-${r.course.id}`, undefined, `${finished(r) ? '★' : '○'} ${r.course.title}`,
        `${new Date(r.course.createdAt).toLocaleDateString()} · ${finished(r) ? `${sc.right}/${sc.total}` : `${r.course.lessons.filter((_, i) => lessonDone(r.progress, i)).length} of ${r.course.lessons.length} lessons`}${r.course.id === c.current ? ' · this session' : ''}`,
        setUi(c, u => ({ ...u, course: r.course.id, view: 'home' })));
    })}</Box>,
    btn(c, 'menu', '← Back', setUi(c, u => ({ ...u, course: c.current, view: 'home' })), 'm'),
  ];
}

/** The badge as a standalone image to keep or post. No project details unless you include the title. */
export function badgeSvg(r: CourseRecord, withTitle: boolean): string {
  const sc = scoreOf(r.course, r.progress.answers);
  const esc = (t: string) => t.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
  const title = withTitle ? esc(r.course.title.length > 44 ? r.course.title.slice(0, 43) + '…' : r.course.title) : 'A course on my own project';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" width="600" height="240" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif">`
    + `<rect width="600" height="240" rx="24" fill="#1f1e1d"/>`
    + `<g transform="translate(40 52)">${MEDAL.replace(/^<svg[^>]*>|<\/svg>$/g, '').replace('width="64" height="64"', '')}</g>`
    + `<text x="130" y="86" fill="#e4e0d8" font-size="16" font-weight="600" letter-spacing="1.5">HALFTIME COURSE COMPLETE</text>`
    + `<text x="130" y="126" fill="#ffffff" font-size="26" font-weight="700">${title}</text>`
    + `<text x="130" y="162" fill="#d97757" font-size="20" font-weight="600">${sc.right}/${sc.total} on the quiz · ${plural(r.course.lessons.length, 'lesson')}</text>`
    + `<text x="130" y="200" fill="#9b968e" font-size="14">Learned during a Claude usage-limit break · github.com/aryawidjaja/halftime</text>`
    + `</svg>`;
}
