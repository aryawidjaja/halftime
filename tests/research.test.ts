// A long research session (invented: a spam filter for support tickets), summarized
// and mostly done by helper agents. What Halftime reads from it for free, the digest
// it sends for the course, and how the course reply is validated.

import { expect, test } from 'claude-code/testing';
import { agentsIn, assembleLessons, worthShowing } from '../hooks/build';
import { notesOf } from '../hooks/notes';
import { fitCode } from '../hooks/learn';
import { changesOf, earlierOf, helpersOf, latestOf, relative, tidyPaths } from '../hooks/lib/extract';
import { digestOf, kindOf, redact, statsOf } from '../hooks/lib/digest';
import { mix } from '../hooks/lib/prebake';
import { attachCode, coursePrompt, parseReply, questionsOf, quizItem, scoreOf, validateCourse } from '../hooks/lib/teach';
import { mergeLibrary, mergeReview, readLibrary, readReview, withReview } from '../hooks/lib/store';
import { coursePage, pagePath } from '../hooks/lib/web';
import type { CourseRecord, Msg } from '../types';
import { AGENTS, COURSE_REPLY, RESEARCH, ROOT, SESSION, SUMMARY, bash, claude, edit, user, write } from './fixture';

const agents = new Map(Object.entries(AGENTS).map(([id, msgs]) => [id, { task: agentsIn(RESEARCH).find(a => a.id === id)!.task, msgs }]));
const lessons = (msgs: readonly Msg[] = RESEARCH, withAgents = true) => assembleLessons({
  msgs, agents: withAgents ? agents : new Map(), root: ROOT, now: 0, permsAtStart: [], rulesNow: [], descriptions: new Map(), read: async () => undefined,
});

/* ---------- what the session holds ---------- */

test('the earlier summary is read by section, without code, file listings or the message log', () => {
  const e = earlierOf([user(SUMMARY)], ROOT);
  const heads = (xs?: Array<{ head: string }>) => xs?.map(x => x.head);
  expect(heads(e.asked)).toEqual(['Make the ticket spam filter stop flagging real customer tickets.', 'Back every change with the labelled March tickets, not guesses.']);
  expect(e.ideas?.[0]).toEqual({ head: 'Decision threshold: the score above which a ticket counts as spam.', points: [] }); // bold marks gone
  expect(e.ideas?.[1]).toEqual({ head: 'Precision (of flagged tickets, how many were spam): the main score.', points: ['Used with recall to judge every change.'] });
  expect(e.errors?.map(x => x.points.length)).toEqual([1, 0]);
  expect(e.solved).toEqual([{ head: 'Solved the refund-request false positives; the false-positive rate is now 2.1%. The remaining misses are all on forwarded emails.', points: [] }]);
  expect(heads(e.open)).toEqual(['Handle forwarded emails.', 'Fix the code: re-run the benchmark on the April tickets.']); // an item with a colon is not a heading
  expect(e.now?.[0]?.head).toMatch(/refund-request/);
  const all = JSON.stringify(e);
  expect(all.includes('def is_spam')).toBe(false);
  expect(all.includes('fix the rest carefully')).toBe(false);
  expect(all.includes('Run the benchmark.')).toBe(false);
});

test('no summary, nothing earlier; a markdown-style summary works too; a bold label heads the bullets under it', () => {
  expect(earlierOf(SESSION)).toEqual({});
  const md = 'This session is being continued from a previous conversation.\n\n## Errors and fixes\n- The build failed on Node 18.\n## Pending Tasks\n- Ship it.';
  expect(earlierOf([user(md)])).toEqual({ errors: [{ head: 'The build failed on Node 18.', points: [] }], open: [{ head: 'Ship it.', points: [] }] });
  const labelled = 'This session is being continued from a previous conversation.\n\n1. Primary Request and Intent:\n\n   **Phase 1, research.** Understand the pipeline end to end:\n   - architecture and metrics;\n   - find relevant examples.\n\n   **Reports.**\n   - An HTML report for a newcomer.\n2. Key Technical Concepts:\n   - x';
  expect(earlierOf([user(labelled)]).asked).toEqual([
    { head: 'Phase 1, research. Understand the pipeline end to end', points: ['architecture and metrics;', 'find relevant examples.'] },
    { head: 'Reports.', points: ['An HTML report for a newcomer.'] },
  ]);
});

test('helpers: a direct answer, a background notification, a hand-back, and one still working', () => {
  const h = helpersOf(RESEARCH, id => ({ files: id === 'ag_fix' ? 1 : 0, last: id === 'ag_label' ? 'Relabelling the rows in /repo/data/labels.csv now.' : undefined }), ROOT);
  expect(h.map(x => x.task)).toEqual(['Literature review on ticket spam', 'Threshold fixes: short tickets', 'Benchmark on March tickets', 'Label cleanup']);
  expect(h[0]!.report).toMatch(/^Found three papers\. Character n-grams/);
  expect(h[1]!.report).toMatch(/Short tickets are now scored/);
  expect(h[1]!.files).toBe(1);
  expect(h[2]!.report).toMatch(/^Precision rose from 0\.71 to 0\.83/); // the hand-back's heading is dropped
  expect(h[3]!.report).toBe(undefined);
  expect(h[3]!.last).toBe('Relabelling the rows in data/labels.csv now.'); // its own latest words, with a short path
  expect(h.map(x => x.running)).toEqual([false, false, false, true]);
});

test("a helper's edits become a change of their own, where Claude handed it the task", () => {
  const ch = changesOf(RESEARCH, ROOT, agents);
  expect(ch.map(c => c.ask)).toEqual(['Helper agent: Threshold fixes: short tickets']);
  expect(ch[0]!.files[0]!.file).toBe('src/filter.py');
  expect(latestOf(RESEARCH)).toMatch(/^The threshold and benchmark helpers reported back/);
});

test('helpers count: their failing-then-passing checks are bugs, their edits are changes', async () => {
  const L = await lessons();
  expect(L.bugs.length).toBe(1);
  expect(L.bugs[0]!.fix[0]!.file).toBe('src/filter.py');
  expect(L.changes.length).toBe(1);
  expect(L.helpers.length).toBe(4);
  expect(L.counts.messages).toBe(RESEARCH.length + 4 + 2 + 2);
  expect(worthShowing(L)).toBe(true);
  // Without the helpers' transcripts, the main thread alone shows no edits at all.
  expect((await lessons(RESEARCH, false)).changes.length).toBe(0);
});

test('session notes teach from the summary and the helpers, with no request', async () => {
  const n = notesOf(await lessons());
  expect(n.chapters.map(ch => ch.title)).toEqual(['What happened', 'What went wrong, and how it was fixed', 'Terms that came up', 'Before you continue']);
  expect(n.chapters[0]!.steps.map(s => s.key)).toEqual(['asked', 'solved', 'helpers']);
  expect(n.chapters[1]!.steps.map(s => s.kind)).toEqual(['bug', 'list']);
  const open = n.chapters[3]!.steps[0]!;
  expect(open.kind === 'list' && open.items.every(i => i.todo?.startsWith('Next: '))).toBe(true);
});

test('an empty session teaches nothing and says so', async () => {
  const L = await lessons([user('hi')], false);
  expect(worthShowing(L)).toBe(false);
  expect(notesOf(L).chapters).toEqual([]);
});

/* ---------- Windows paths ---------- */

test('Windows paths: relative to the project, outside ones shortened', () => {
  expect(relative('C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('src/a.ts');
  expect(relative('c:/work/app/src/a.ts', 'C:\\work\\app')).toBe('src/a.ts');
  expect(relative('D:\\other\\b.ts', 'C:\\work\\app')).toBe('D:/other/b.ts');
  expect(tidyPaths('see C:\\Users\\sam\\notes\\todo.md', 'C:\\work\\app')).toBe('see …\\todo.md');
  expect(tidyPaths('in C:\\work\\app\\src\\a.ts', 'C:\\work\\app')).toBe('in src\\a.ts');
});

/* ---------- secrets ---------- */
// The fake secrets below are split into pieces so that secret scanners don't mistake the tests for a leak.

test('secrets never reach the digest or the pane', () => {
  const leaks = [
    'export STRIPE=sk_' + 'live_51HxYzAbCdEfGhIjKlMnOp', 'token ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789', 'key AKIA' + 'IOSFODNN7EXAMPLE',
    'Authorization: Bearer ' + 'abcdefghijklmnopqrstuvwxyz012345', 'postgres://admin:' + 'hunter2pass@db.example.com/app', 'password = ' + '"correct-horse-battery"',
    'jwt eyJhbGci' + 'OiJIUzI1NiJ9.eyJzdWIi' + 'OiIxMjMifQ.abcdefghijklmnop', '-----BEGIN RSA PRIV' + 'ATE KEY-----\nMIIEow\n-----END RSA PRIV' + 'ATE KEY-----',
    'slack xox' + 'b-1234567890-abcdefghij', 'AIza' + 'SyA1234567890abcdefghijklmnopqrstuv',
  ];
  for (const t of leaks) {
    const r = redact(t);
    expect(r.includes('•••')).toBe(true);
    for (const secret of ['51HxYzAbCd', 'abcdefghijklmnopqrstuvwxyz0123', 'IOSFODNN7', 'hunter2pass', 'correct-horse', 'eyJzdWIi', 'MIIEow', '1234567890-abc', 'SyA1234567890']) expect(r.includes(secret)).toBe(false);
  }
  // Ordinary text and labels stay readable.
  expect(redact('the threshold is 0.5 and the token count rose')).toBe('the threshold is 0.5 and the token count rose');
  expect(redact('postgres://admin:' + 'hunter2pass@db')).toBe('postgres://admin:•••@db');
});

test('the digest is compact, ordered by importance, and carries no secret', async () => {
  const msgs = [...RESEARCH, user('use this key sk_' + 'live_51HxYzAbCdEfGhIjKlMnOp'), claude('I chose a lower threshold because short tickets scored too high, which means fewer real tickets get flagged by mistake in the queue.')];
  const L = await lessons(msgs);
  const d = digestOf(L, msgs);
  expect(d.includes('51HxYzAbCd')).toBe(false);
  expect(d).toMatch(/## What you asked, in order/);
  expect(d).toMatch(/Earlier, before the conversation was summarized/);
  expect(d).toMatch(/Label cleanup \(still working\)/);
  // Claude's closing reply to each request goes in whole, warnings and all, and is not repeated as an explanation.
  const ends = d.slice(d.indexOf("## Claude's reply at the end of each request"));
  expect(ends).toMatch(/^## Claude's reply at the end of each request\n- .*\n- I chose a lower threshold because short tickets scored too high, which means fewer real tickets get flagged by mistake in the queue\.\n/);
  expect(d.split('I chose a lower threshold').length).toBe(3); // the reply, and "Where it stands now"
  expect(d.length <= 20_001).toBe(true);
  expect(digestOf(L, msgs, 500).length <= 502).toBe(true);
  expect(statsOf(L)).toEqual({ messages: L.counts.messages, commands: L.counts.commands, helpers: 4, files: 1, failed: 1 });
});

/* ---------- the kind of session ---------- */

const many = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const pad = many(20, i => user(`step ${i}`));

test('the kind of session is spotted from what ran', async () => {
  expect(kindOf([user('hi')])).toBe('admin');
  expect(kindOf([...pad, user('free some disk space'), claude('Scanning.', bash('du -sh ~/Library/Caches'), bash('df -h'), bash('du -sh ~/Library/Developer/Xcode/DerivedData'))])).toBe('housekeeping');
  expect(kindOf([...pad, user('ship it'), claude('Releasing.', bash('git push origin main'), bash('vercel deploy --prod'), bash('gh release create v1'))])).toBe('deploy');
  expect(kindOf([...pad, user('retrain the model'), claude('Training.', bash('python train.py --epochs 10'), bash('nvidia-smi'), bash('python eval.py checkpoint.pt')), claude('ok', bash('torch info'))])).toBe('ml');
  expect(kindOf([...pad, user('the checkout is broken, fix it'), claude('Fixing.', edit('src/a.ts', 'a', 'b'), bash('npm test', 'FAIL src/a.test.ts'))])).toBe('fix');
  expect(kindOf([...pad, user('build the settings page'), claude('Building.', ...many(6, i => write(`src/s${i}.py`, 'x = 1')))])).toBe('build');
  expect(kindOf([...pad, user('how does auth work here?'), claude('Reading.', ...many(12, i => ({ tool_use_id: `r${i}`, tool: 'Read', input: { file_path: `/repo/f${i}.ts` } })))])).toBe('explain');
  expect(kindOf([...pad, user('compare vector databases'), claude('Searching.', ...many(9, i => ({ tool_use_id: `w${i}`, tool: 'WebSearch', input: { query: `q${i}` } })))])).toBe('research');
  expect(kindOf([...pad, user('refactor the billing module'), claude('Refactoring.', ...many(4, i => edit(`src/b${i}.ts`, 'a', 'b')))])).toBe('refactor');
  expect(kindOf([...pad, user('sentry is full of alerts since the deploy'), claude('Looking.', bash('git log -5'))])).toBe('firefight');
  expect((await lessons()).kind).toBe('fix'); // the invented filter session: a fix, through its helper's failing test
});

/* ---------- the course reply ---------- */

const lesson = (topic: string, extra: Record<string, unknown> = {}) => ({
  topic, summary: `What ${topic} is`,
  what: { title: `${topic} in one line`, body: 'A plain explanation.', analogy: 'Like a bouncer at a door.', breaks: 'Bouncers can be talked round.', more: 'Deeper detail.' },
  where: { body: 'Used in the filter.', file: 'filter.py' },
  did: { kind: 'choice', problem: 'Real tickets were flagged.', options: ['Raise the threshold', 'Drop the length feature', 'Retrain from scratch'], picked: 1, chose: 'Dropped length under 20 words.', why: 'Length was the cause.', cost: 'Long spam is caught a bit less.' },
  takeaway: 'Fix the cause, not the score.', next: 'Add a test for forwarded emails',
  check: { ask: `What does ${topic} decide?`, options: ['Spam or not', 'Ticket owner', 'Reply time'], right: 0, why: 'It sorts tickets.' },
  ...extra,
});
const REPLY = {
  title: 'Stopping false spam flags',
  briefing: { issue: 'Real tickets were flagged as spam.', fixed: ['Short tickets are scored fairly'], holding: ['Forwarded emails still fail'], trivia: 'Claude first suspected the labels.' },
  lessons: [lesson('Decision threshold'), lesson('Precision', { did: { kind: 'step', what: 'Measured it on March tickets.', why: 'To prove the fix.', evidence: '0.71 to 0.83' } }), lesson('Decision threshold'), { topic: 'broken' }],
  final: [{ ask: 'Why drop length?', options: ['It caused the flags', 'It was slow'], right: 0, why: 'It pushed short tickets over.' }, { ask: 'bad', options: ['a', 'a'], right: 0, why: 'dup' }],
};
const META = { kind: 'fix', createdAt: 1_700_000_000_000, model: 'haiku', stats: { messages: 10, commands: 3, helpers: 4, files: 1, failed: 1 } };

test('a valid reply becomes a course; duplicates, broken lessons and broken questions are dropped', () => {
  const c = validateCourse(parseReply('Here you go:\n' + JSON.stringify(REPLY)), META)!;
  expect(c.title).toBe('Stopping false spam flags');
  expect(c.lessons.map(l => l.topic)).toEqual(['Decision threshold', 'Precision']); // the repeat topic and the broken lesson are gone
  expect(c.final.length).toBe(1); // duplicate options drop a question
  const d = c.lessons[0]!.did;
  expect(d.kind === 'choice' && d.options[d.picked]).toBe('Drop the length feature'); // still the chosen one, wherever it sits now
  expect(c.lessons[0]!.what.analogy).toBe('Like a bouncer at a door.');
  expect(c.lessons[1]!.did.kind).toBe('step');
  expect(c.id).toMatch(/^c/);
  expect(c.stats.helpers).toBe(4);
});

test('the course needs a title, an issue and two whole lessons; an analogy needs its limit', () => {
  expect(validateCourse(null, META)).toBe(undefined);
  expect(validateCourse({ ...REPLY, title: '' }, META)).toBe(undefined);
  expect(validateCourse({ ...REPLY, lessons: [lesson('One')] }, META)).toBe(undefined);
  const noBreak = validateCourse({ ...REPLY, lessons: [lesson('A', { what: { title: 't', body: 'b', analogy: 'Like a door.' } }), lesson('B')] }, META)!;
  expect(noBreak.lessons[0]!.what.analogy).toBe(undefined);
  // A choice with a bad pick still teaches, as a step.
  const bad = validateCourse({ ...REPLY, lessons: [lesson('A', { did: { kind: 'choice', problem: 'p', options: ['x', 'y'], picked: 7, chose: 'c', why: 'w', cost: 'k' } }), lesson('B')] }, META)!;
  expect(bad.lessons[0]!.did).toEqual({ kind: 'step', what: 'c', why: 'w' });
});

test('long fields are clamped and secrets in the reply are removed', () => {
  const c = validateCourse({ ...REPLY, title: 'T'.repeat(300), briefing: { ...REPLY.briefing, issue: 'leaked sk_' + 'live_51HxYzAbCdEfGhIjKlMnOp here' } }, META)!;
  expect(c.title.length).toBe(80);
  expect(c.briefing.issue.includes('51HxYz')).toBe(false);
});

test('answers are moved so the right one is not always first, and stay put on every draw', () => {
  const seeds = ['Why drop length?', 'What does it decide?', 'Which helper', 'Where it runs', 'Why merge'];
  const at = seeds.map(q => mix(['right', 'b', 'c'], 0, q));
  for (const m of at) expect(m.options[m.right]).toBe('right');
  expect(new Set(at.map(m => m.right)).size > 1).toBe(true);
  expect(mix(['right', 'b', 'c'], 0, seeds[0]!)).toEqual(at[0]!);
  expect(quizItem({ ask: 'q', options: ['a', 'b'], right: '1', why: 'w' })?.options.length).toBe(2); // a numeric string is a number
  expect(quizItem({ ask: 'q', options: ['a', 'b'], right: 2, why: 'w' })).toBe(undefined);
});

test('the real code from the session is attached under "where it lives"; never invented', async () => {
  const L = await lessons();
  const c = attachCode(validateCourse(REPLY, META)!, L);
  expect(c.lessons[0]!.where.file).toBe('src/filter.py');
  expect(c.lessons[0]!.where.code).toMatch(/^@@ .*\n-return score\(t\) > 0\.5\n\+return score/);
  const none = attachCode(validateCourse({ ...REPLY, lessons: [lesson('A', { where: { body: 'b', file: 'nowhere.py' } }), lesson('B', { where: { body: 'b' } })] }, META)!, L);
  expect(none.lessons.map(l => l.where.code)).toEqual([undefined, undefined]);
});

test('scores count every check and final question; the prompt fits any session and skips taught topics', () => {
  const c = validateCourse(REPLY, META)!;
  expect(questionsOf(c).map(q => q.key)).toEqual(['l0.check', 'l1.check', 'f0']);
  const right = Object.fromEntries(questionsOf(c).map(x => [x.key, x.q.right]));
  expect(scoreOf(c, right)).toEqual({ right: 3, total: 3, answered: 3 });
  expect(scoreOf(c, { 'l0.check': (c.lessons[0]!.check.right + 1) % 3 })).toEqual({ right: 0, total: 3, answered: 1 });
  const p = coursePrompt('DIGEST', 'ml', ['Decision threshold', 'Precision']);
  expect(p).toMatch(/what each metric means/);
  expect(p).toMatch(/Already taught .*Decision threshold; Precision/);
  expect(p.endsWith('DIGEST')).toBe(true);
  expect(coursePrompt('D', 'general', [])).not.toMatch(/Already taught/);
});

/* ---------- the store ---------- */

test('only whole courses come back from the store; missed questions are kept once and leave when answered right', () => {
  const c = validateCourse(REPLY, META)!;
  expect(readLibrary([{ course: c, progress: { read: ['briefing', 3], answers: { 'l0.check': 1, bad: 'x' } } }, { course: { id: 'x' } }, null, 'junk'])).toEqual([
    { course: c, progress: { read: ['briefing'], answers: { 'l0.check': 1 } } },
  ]);
  expect(readLibrary('nope')).toEqual([]);
  const q = { ...c.final[0]!, topic: 'T', from: c.id };
  const once = withReview(withReview([], q, false), q, false);
  expect(once.length).toBe(1);
  expect(withReview(once, q, true)).toEqual([]);
  expect(readReview([q, { ask: 'no options' }])).toEqual([q]);
});

test("the model's kind wins when it names a known one; anything else keeps Halftime's guess", () => {
  expect(validateCourse({ ...REPLY, kind: 'science' }, META)!.kind).toBe('science');
  expect(validateCourse({ ...REPLY, kind: 'made-up' }, META)!.kind).toBe('fix');
  expect(validateCourse(REPLY, META)!.kind).toBe('fix');
});

test('the code under a lesson is the latest change to its file: the fix, not the first draft', async () => {
  const msgs = [user('write the filter'), claude('Writing.', write('src/filter.py', 'def is_spam(t):\n    return False')), user('fix it'), claude('Fixing.', edit('src/filter.py', 'return False', 'return score(t) > 0.5'))];
  const L = await lessons(msgs, false);
  const c = attachCode(validateCourse(REPLY, META)!, L);
  expect(c.lessons[0]!.where.code).toBe("@@ -1,1 +1,1 @@\n-return False\n+return score(t) > 0.5");
});

test('placeholder file names are dropped; "the digest" and "the user" become words the reader knows', () => {
  const c = validateCourse({ ...REPLY, briefing: { ...REPLY.briefing, issue: 'The digest shows the user wanted fewer false flags.' },
    lessons: [lesson('A', { where: { body: 'b', file: '<a file path from the digest, optional>' } }), lesson('B', { where: { body: 'b', file: 'src/filter.py' } }), lesson('C', { where: { body: 'b', file: 'Makefile' } })] }, META)!;
  expect(c.briefing.issue).toBe('The session shows you wanted fewer false flags.');
  expect(c.lessons.map(l => l.where.file)).toEqual([undefined, 'src/filter.py', undefined]);
});

test('secrets written as environment variables are removed too; ordinary words stay', () => {
  for (const t of ['DB_PASSWORD=hunter2hunter2', 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI', 'JWT_SECRET=supersecretvalue', 'SECRET_KEY=django-insecure-abc', 'GITHUB_TOKEN: abcdef1234567890', 'client_secret=abcdefghi'])
    expect(redact(t).endsWith('•••')).toBe(true);
  for (const t of ['the token count rose', 'tokenizer: sentencepiece', 'max_tokens: 32000']) expect(redact(t)).toBe(t);
});

test('home folders with spaces in their names never show', () => {
  expect(tidyPaths('see /Users/Jane Doe/proj/a.ts now', '/repo')).toBe('see …/a.ts now');
  expect(tidyPaths('C:\\Users\\John Smith\\repo\\a.ts', 'D:\\work')).toBe('…\\a.ts');
});

test('a damaged stored course is skipped, not drawn', () => {
  const c = validateCourse(REPLY, META)!;
  const broken = [
    { ...c, briefing: { issue: 'x' } }, // no fixed or holding lists
    { ...c, lessons: [{ ...c.lessons[0]!, did: { kind: 'choice', problem: 'p' } }] }, // a choice with no options
    { ...c, stats: {} },
  ];
  expect(readLibrary(broken.map(course => ({ course, progress: {} })))).toEqual([]);
  expect(readLibrary([{ course: c, progress: {} }]).length).toBe(1);
});

test("two sessions' saves merge: neither erases the other's courses or answers; a cleared review item stays cleared", () => {
  const a = validateCourse(REPLY, META)!, b = validateCourse({ ...REPLY, title: 'Another course' }, { ...META, createdAt: META.createdAt + 1000 })!;
  const stored = [{ course: a, progress: { read: ['briefing'], answers: { 'l0.check': 1 } } }];
  const mine: CourseRecord[] = [{ course: b, progress: { read: [], answers: {} } }, { course: a, progress: { read: ['l0.c0'], answers: { 'l1.check': 0 } } }];
  const m = mergeLibrary(stored, mine);
  expect(m.map(r => r.course.title)).toEqual(['Another course', 'Stopping false spam flags']); // newest first, nothing lost
  expect(m[1]!.progress).toEqual({ read: ['briefing', 'l0.c0'], answers: { 'l0.check': 1, 'l1.check': 0 } });
  const q = (ask: string) => ({ ask, options: ['a', 'b'], right: 0, why: 'w', topic: 't', from: 'c' });
  expect(mergeReview([q('other'), q('done')], [q('mine')], new Set(['done'])).map(x => x.ask)).toEqual(['mine', 'other']);
});

test('code under a lesson fits the pane: cut to its width, at most 8 lines, header recounted', () => {
  const code = '@@ -1,5 +1,8 @@\n' + Array.from({ length: 12 }, (_, i) => `${i < 4 ? '-' : '+'}${'x'.repeat(i === 0 ? 200 : 10)}`).join('\n');
  const out = fitCode(code, 60).split('\n');
  expect(out.length).toBe(9);
  expect(out[0]).toBe('@@ -1,4 +1,4 @@'); // 4 removed and 4 added lines kept: the old counts would be refused
  expect(out[1]!.length).toBe(52);
  expect(out[1]!.endsWith('…')).toBe(true);
});

test('the browser page: course text cannot end its script, progress starts from the pane, and nothing loads from outside', () => {
  const course = validateCourse({ ...COURSE_REPLY, title: 'Fix </script><img src=x onerror=alert(1)>   bug' }, { kind: 'fix', createdAt: 1, model: 'haiku', stats: { messages: 3, commands: 1, helpers: 0, files: 1, failed: 0 } })!;
  const rec: CourseRecord = { course, progress: { read: ['briefing'], answers: { 'l0.check': 1, f0: 2 } } };
  const page = coursePage(rec, { project: 'tally', kind: 'Bug fix', resetsAt: 5, saved: ['Show me the test'] });
  const script = page.slice(page.indexOf('var DATA = '), page.lastIndexOf('</script>'));
  expect(script.includes('</script>')).toBe(false);
  expect(script.includes(' ')).toBe(false);
  expect(page).toMatch(/<title>Fix &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  const data = JSON.parse(script.slice('var DATA = '.length, script.indexOf(';\n')));
  expect(data.course.title).toBe(course.title);
  expect(data.progress).toEqual({ done: [0], answers: { 'lesson:0': 1, 'final:0': 2 }, briefed: true });
  expect(data.saved).toEqual(['Show me the test']);
  expect(/\s(src|href)=["']?(https?:)?\/\//i.test(page)).toBe(false);
  expect(pagePath('/home/u/.claude/', 'Tally App', rec)).toMatch(/^\/home\/u\/\.claude\/halftime\/tally-app\/fix-script-img-src-x-onerror-alert-1-bug-[a-z0-9]{6}\.html$/);
});
