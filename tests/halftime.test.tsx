// End-to-end tests of the hooks module against the engine's test kit: limit detection,
// the pane on every surface, the course from the one request, the reset, the
// auto-continue fallback, and the one-request budget.

import { expect, mock, test } from 'claude-code/testing';
import { AGENTS, COURSE_REPLY, DISK, RESEARCH, ROOT, SESSION, claude, user } from './fixture';
import type { Msg } from '../types';
import { questionsOf, validateCourse } from '../hooks/lib/teach';

const T0 = Date.parse('2026-10-15T12:00:00Z');
const RESET = '2026-10-15T13:30:00Z';
const PANE_PROPS = { title: 'Halftime', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const;
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const;

type Spy = {
  opened: string[]; toasts: string[]; status: Array<string | undefined>; submitted: string[]; filled: string[];
  forks: number; completes: number; asks: Array<{ model: string; prompt: string; effort?: string; maxTokens?: number }>;
  store: Map<string, unknown>; messagesRead: number; draft: string; panesShown: boolean; usage: Array<{ kind: string; percentUsed: number; resetsAt?: string }>;
  settings: Record<string, string>; written: Map<string, string>; copied: string[]; ran: string[][];
};

type EngineOptions = {
  session?: Msg[]; agents?: Record<string, Msg[]>; surfaces?: string[]; sessionId?: string;
  /** The model's reply text; null makes the request fail. */
  reply?: string | null; copy?: boolean; home?: string; store?: Record<string, unknown>;
  /** The engine refuses to send the request at all (a blocked model). */
  refuse?: boolean;
  /** What `uname -s` prints (the host's system); the open command exits with openExit. */
  os?: string; openExit?: number;
};

/** Registers the engine's bottom for every call Halftime makes, recording what it did. */
function engine(on: any, o: EngineOptions = {}): Spy {
  const s: Spy = { opened: [], toasts: [], status: [], submitted: [], filled: [], forks: 0, completes: 0, asks: [], store: new Map(Object.entries(o.store ?? {})), messagesRead: 0, draft: '', panesShown: false, usage: [], settings: {}, written: new Map(), copied: [], ran: [] };
  const file = (path: string) => s.settings[path] ?? DISK[path.replace(ROOT + '/', '')];
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }));
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }));
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }));
  on('classic.StopFailure', () => ({}));
  on('ui.render', (t$: any, e: any) => { const { Box } = t$.ui.resolve(e); return <Box />; }); // the engine's own (empty) drawing, beneath Halftime's
  on('command.register', () => ({ value: undefined }));
  on('session.root', () => ({ value: ROOT }));
  on('session.id', () => ({ value: o.sessionId ?? 'session-1' }));
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }));
  on('session.messages', (_$: any, e: any) => {
    if (e?.agentId) return { value: o.agents?.[e.agentId] ?? { deny: 'no such agent' } };
    s.messagesRead++; return { value: o.session ?? SESSION };
  });
  on('session.usage', () => ({ value: { startedAt: T0, context: { window: 200000 }, rateLimits: s.usage } }));
  on('store.get', (_$: any, e: any) => ({ value: s.store.get(e.key) }));
  on('store.set', (_$: any, e: any) => { s.store.set(e.key, JSON.parse(JSON.stringify(e.value))); return { value: undefined }; });
  on('store.delete', (_$: any, e: any) => { s.store.delete(e.key); return { value: undefined }; });
  on('env.get', (_$: any, e: any) => ({ value: e.name === 'HOME' ? o.home : undefined }));
  on('fs.stat', (_$: any, e: any) => (file(e.path) !== undefined ? { value: { kind: 'file', size: file(e.path)!.length, mtimeMs: 0, isLink: false } } : { deny: 'missing' }));
  on('fs.read', (_$: any, e: any) => (file(e.path) !== undefined ? { value: file(e.path) } : { deny: 'missing' }));
  on('fs.exists', (_$: any, e: any) => ({ value: /Downloads$/.test(e.path) }));
  on('fs.write', (_$: any, e: any) => { s.written.set(e.path, e.text); return { value: undefined }; });
  on('process.run', (_$: any, e: any) => {
    const argv = [...e.argv]; s.ran.push(argv);
    return { value: argv[0] === 'uname' ? { exitCode: 0, stdout: `${o.os ?? 'Darwin'}\n`, stderr: '' } : { exitCode: o.openExit ?? 0, stdout: '', stderr: '' } };
  });
  on('ui.copy', (_$: any, e: any) => { if (o.copy) s.copied.push(e.text); return { value: o.copy ? { isCopied: true } : { isCopied: false, reason: 'no-path' } }; });
  on('ui.open', (_$: any, e: any) => { s.opened.push(e.id); return { value: { isPlaced: true } }; });
  on('ui.close', () => ({ value: undefined }));
  on('ui.panes', () => ({ value: s.panesShown ? [{ id: 'halftime', title: 'Halftime', isShown: true, isFocused: false, isPlaced: true }] : [] }));
  on('ui.toast', (_$: any, e: any) => { s.toasts.push(e.text); return { value: undefined }; });
  on('ui.status', (_$: any, e: any) => { s.status.push(e.text); return { value: undefined }; });
  on('prompt.read', () => ({ value: { text: s.draft, cursor: s.draft.length } }));
  on('prompt.fill', (_$: any, e: any) => { s.filled.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length }; });
  on('prompt.submit', (_$: any, e: any) => { s.submitted.push(e.text); return { text: e.text }; });
  on('model.complete', (_$: any, e: any) => {
    s.completes++;
    s.asks.push({ model: e.model, prompt: String(e.prompt), effort: e.effort, maxTokens: e.maxTokens });
    if (o.refuse) return { deny: 'model not allowed' };
    if (o.reply === null) return { value: { isAnswered: false, reason: 'api-error', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
    return { value: { isAnswered: true, text: o.reply ?? JSON.stringify(COURSE_REPLY), usage: { input_tokens: 5200, output_tokens: 3100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } };
  });
  on('model.fork', () => { s.forks++; return { value: { isAnswered: false, reason: 'nothing-to-fork' } }; });
  return s;
}

const measure = async ($: any, percentUsed: number, resetsAt = RESET, clock?: { settle(): Promise<void> }) => {
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }] });
  await clock?.settle();
};
const stop = async ($: any, clock: { settle(): Promise<void> }, transcript = '/home/u/.claude/projects/p/x.jsonl') => {
  await $.classic.StopFailure({ error: 'rate_limit', session_id: 'x', transcript_path: transcript, cwd: ROOT });
  await clock.settle();
};
const complete = ($: any, id = 't') => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: id, reason: 'answer' });
const start = ($: any) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
const open = ($: any) => $.command.run({ command: 'halftime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
const pane = ($: any, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ plugin: 'halftime', surface, component: 'Pane', requestId: 'halftime', props: PANE_PROPS });
const has = async (ui: any, q: Record<string, unknown>) => (await ui.find(q)) !== undefined;
/** The visible text of a drawing: a Text's pieces joined as written, blocks on their own lines. */
const flat = (n: any): string => typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(flat).join('\n')
  : !n || typeof n !== 'object' ? ''
  : n.type === 'Text' ? (n.children ?? []).map((k: any) => (typeof k === 'object' ? flat(k) : String(k))).join('')
  : n.type === 'Button' && n.props?.label && !n.children?.length ? `[${n.props.label}]`
  : (n.children ?? []).map(flat).join('\n');
const text = async (ui: any) => flat(await ui.drawn());
const BAND = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} };
const band = ($: any, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ plugin: 'halftime', surface, component: 'AbovePrompt', props: BAND });
const asking = async ($: any) => { const b = await band($); const on = (await b.find({ type: 'Button', key: 'once' })) !== undefined; await b.unmount(); return on; };
const turns = async ($: any, clock: { settle(): Promise<void> }, ids: string[]) => { for (const id of ids) await complete($, id); await clock.settle(); };
const LATER = '2026-10-15T18:30:00Z';
/** Opens the pane outside a limit and writes the course with one request. */
async function withCourse($: any, clock: { settle(): Promise<void> }, surface: (typeof SURFACES)[number] = 'terminal') {
  await open($);
  const ui = await pane($, surface);
  await ui.press({ key: 'prepare' });
  await clock.settle();
  return ui;
}

test('hitting the limit builds lessons once, opens the pane and shows the countdown', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 100, RESET, clock);
  expect(s.messagesRead).toBe(1);
  expect(s.opened).toEqual(['halftime']);
  expect(s.toasts[0]).toMatch(/Usage limit reached/);
  expect(s.status.at(-1) ?? '').toMatch(/Claude is back at .* \(1h 30m\)/);
  // Another reading of the same limit does not read the transcript again.
  await measure($, 100, RESET, clock);
  expect(s.messagesRead).toBe(1);
});

test('after an interrupted turn, Halftime continues only if Claude Code did not', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }];
  await stop($, clock);
  await clock.advance(Date.parse(RESET) - T0);
  s.usage = [{ kind: 'five_hour', percentUsed: 0, resetsAt: '2026-10-15T18:30:00Z' }];
  await clock.advance(10_000 + 150_000);
  expect(s.submitted.length).toBe(1);
  // Never a second one for the same limit, even if the reset is seen again.
  await measure($, 0, '2026-10-15T18:30:00Z', clock);
  await clock.advance(200_000);
  expect(s.submitted.length).toBe(1);
});

test('no second continue when Claude Code already continued by itself', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }];
  await stop($, clock);
  await clock.advance(Date.parse(RESET) - T0);
  s.usage = [];
  await clock.advance(20_000);
  await $.turn.start({ text: 'continue', turnId: 'native' });
  await clock.advance(200_000);
  expect(s.submitted).toEqual([]);
});

test('no continue when the user turned the built-in option off', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  s.settings['/home/u/.claude/settings.json'] = JSON.stringify({ autoContinueAtUsageLimit: false });
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }];
  await stop($, clock);
  await clock.advance(Date.parse(RESET) - T0);
  s.usage = [];
  await clock.advance(200_000);
  expect(s.submitted).toEqual([]);
});

test('a passing 429 far from the limit is ignored', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }];
  await stop($, clock, '/t');
  expect(s.opened).toEqual([]);
  expect(s.messagesRead).toBe(0);
});

test('the preparation request runs once per window, only near the limit, after a few turns', { options: { prebake: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 50, RESET, clock);
  for (const id of ['a', 'b', 'c']) await complete($, id);
  await clock.settle();
  expect(s.completes).toBe(0);
  await measure($, 90, RESET, clock);
  await complete($, 'd');
  await clock.settle();
  expect(s.completes).toBe(1);
  await complete($, 'e');
  await clock.settle();
  expect(s.completes).toBe(1);
});

test('by default Halftime never calls the model on its own', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 95, RESET, clock);
  for (const id of ['a', 'b', 'c', 'd']) await complete($, id);
  await clock.settle();
  expect(s.completes).toBe(0);
});

test('nothing happens below the limit: no reads, no timers, no pane', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 60, RESET, clock);
  await clock.advance(6 * 3600_000);
  expect(s.messagesRead).toBe(0);
  expect(s.opened).toEqual([]);
  expect(s.status).toEqual([]);
});

test('the band shows while limited and the pane is hidden, and stays out of the way otherwise', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const props = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} };
  const quiet = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props });
  expect((await quiet.find({ type: 'Button', key: 'open' })) === undefined).toBe(true);
  await quiet.unmount();
  await measure($, 100, RESET, clock);
  const band = await $.ui.mount({ plugin: 'halftime', surface: 'terminal', component: 'AbovePrompt', props });
  expect((await band.find({ type: 'Button', key: 'open' })) !== undefined).toBe(true);
  await band.unmount();
  void s;
});

test('/halftime opens the pane any time, without a limit', async ($, on) => {
  mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await $.command.run({ command: 'halftime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
  expect(s.opened).toEqual(['halftime']);
  expect(s.messagesRead).toBe(1);
});

test('two full windows: Claude is back only after the later reset', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const WEEK = '2026-10-18T09:00:00Z';
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 100, resetsAt: WEEK }];
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: s.usage });
  await clock.settle();
  expect(s.status.at(-1) ?? '').toMatch(/Claude is back at/);
  await clock.advance(Date.parse(RESET) - T0 + 60_000);
  expect(s.toasts.some(t => /Claude is back\./.test(t))).toBe(false);
  expect(s.submitted).toEqual([]);
});

test('a rate_limit error at 98% waits for a second reading, and a passing one clears quietly', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 98.5, resetsAt: RESET }];
  await stop($, clock);
  expect(s.opened).toEqual([]);
  s.usage = [{ kind: 'five_hour', percentUsed: 98.6, resetsAt: RESET }];
  await clock.advance(130_000);
  expect(s.opened).toEqual([]);
  expect(s.toasts).toEqual([]);
  expect(s.submitted).toEqual([]);
});

test('the StopFailure hook and a measure racing open the pane once and read the transcript once', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }];
  await Promise.all([
    $.classic.StopFailure({ error: 'rate_limit', session_id: 'x', transcript_path: '/t', cwd: ROOT }),
    $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: s.usage }),
  ]);
  await clock.settle();
  expect(s.opened).toEqual(['halftime']);
  expect(s.messagesRead).toBe(1);
});

test('no preparation request while any window is full, and one covers overlapping windows', { options: { prebake: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  for (const id of ['a', 'b', 'c']) await complete($, id);
  // Five-hour near the limit, weekly already full: no request.
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 100, resetsAt: '2026-10-18T09:00:00Z' }] });
  await clock.settle();
  await complete($, 'd');
  await clock.settle();
  expect(s.completes).toBe(0);
});

test('a weekly window that stays near the limit does not add a request per five-hour window', { options: { prebake: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  for (const id of ['a', 'b', 'c']) await complete($, id);
  const week = { kind: 'seven_day', percentUsed: 90, resetsAt: '2026-10-18T09:00:00Z' };
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: RESET }, week] });
  await complete($, 'd');
  await clock.settle();
  expect(s.completes).toBe(1);
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: 88, resetsAt: RESET }, week] });
  await complete($, 'e');
  await clock.settle();
  expect(s.completes).toBe(1);
});

test('/halftime simulate runs the whole limit flow and never sends anything', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await $.command.run({ command: 'halftime', args: 'simulate 2', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
  await clock.settle();
  expect(s.opened).toEqual(['halftime']);
  expect(s.status.at(-1) ?? '').toMatch(/Claude is back at .* \(2m\)/);
  await clock.advance(2 * 60_000 + 10_000);
  expect(s.toasts.some(t => /simulated limit is over/.test(t))).toBe(true);
  await clock.advance(200_000);
  expect(s.toasts.some(t => /Simulation: this is when Halftime would ask Claude to continue/.test(t))).toBe(true);
  expect(s.submitted).toEqual([]);
});

test('in a wide terminal, opening says how to uncover the pane if the diff panel covers it; not in VS Code', async ($, on) => {
  mock.clock(on, { now: T0 });
  engine(on);
  await start($);
  const wide = await $.command.run({ command: 'halftime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 184 } });
  expect(wide.text).toMatch(/type \/diff to hide that panel/);
  const narrow = await $.command.run({ command: 'halftime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
  expect(narrow.text).toBe('Halftime is open in a side pane.');
});

test('no diff panel hint where there is no terminal', async ($, on) => {
  mock.clock(on, { now: T0 });
  engine(on, { surfaces: ['vscode'] });
  await start($);
  const r = await $.command.run({ command: 'halftime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 184 } });
  expect(r.text).toBe('Halftime is open in a side pane.');
});

/* ---------- the pane on every surface, and the free session notes ---------- */

test('the pane draws on every surface; session notes and their map can be read', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on);
  await start($);
  await measure($, 100, RESET, clock);
  for (const surface of SURFACES) {
    const ui = await pane($, surface);
    expect(await has(ui, { type: 'Text', text: /Claude is back at/ })).toBe(true);
    expect(await has(ui, { type: 'Button', key: 'halftime-header' })).toBe(surface === 'terminal');
    await ui.press({ key: 'notes' });
    expect(await has(ui, { type: surface === 'terminal' ? 'Raster' : surface === 'vscode' ? 'Code' : 'Svg' })).toBe(true);
    await ui.press({ key: 'ch0' });
    expect(await has(ui, { type: 'Text', text: /Chapter 1 of/ })).toBe(true);
    await ui.press({ key: 'menu' }); // to the notes
    await ui.press({ key: 'menu' }); // home, for the next surface
    await ui.unmount();
  }
});

test('saving a prompt keeps it in this project, and it is filled (not sent) after the reset', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 100, RESET, clock);
  const ui = await pane($);
  await ui.press({ key: 'notes' });
  await ui.press({ key: 'ch0' });
  await ui.press({ key: 'todo' });
  const saved = s.store.get(`${ROOT}:todos`) as string[];
  expect(saved.length).toBe(1);
  await ui.unmount();
  s.usage = [];
  await clock.advance(Date.parse(RESET) - T0 + 10_000);
  expect(s.status.at(-1)).toBe(undefined);
  expect(s.filled).toEqual(saved);
  expect(s.submitted).toEqual([]);
});

/* ---------- the course ---------- */

test('the course: one request to Haiku at low effort, from a digest with no secrets', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { session: [...SESSION, user('use my key sk_' + 'live_51HxYzAbCdEfGhIjKlMnOp for payments')] });
  await start($);
  const ui = await withCourse($, clock);
  expect(s.completes).toBe(1);
  expect(s.forks).toBe(0);
  expect(s.asks[0]!.model).toBe('haiku');
  expect(s.asks[0]!.effort).toBe('low');
  expect(s.asks[0]!.prompt.includes('51HxYzAbCd')).toBe(false);
  expect(s.asks[0]!.prompt).toMatch(/## What you asked, in order/);
  expect(s.toasts.some(t => /Your course is ready: Building the habit tracker API/.test(t))).toBe(true);
  expect(await has(ui, { type: 'Text', text: /Building the habit tracker API/ })).toBe(true);
  expect(await has(ui, { type: 'Button', key: 'next' })).toBe(true);
  expect(await has(ui, { type: 'Button', key: 'lesson2' })).toBe(true);
  const lib = s.store.get(`${ROOT}:courses`) as Array<{ course: { session: string; usage: { output: number }; lessons: Array<{ where: { code?: string } }> } }>;
  expect(lib.length).toBe(1);
  expect(lib[0]!.course.session).toBe('session-1');
  expect(lib[0]!.course.usage.output).toBe(3100);
  expect(lib[0]!.course.lessons[0]!.where.code).toMatch(/streak|toISOString|timeZone/); // the session's own diff of streak.ts
  // Reopening never spends again.
  await open($);
  await clock.settle();
  expect(s.completes).toBe(1);
  await ui.unmount();
});

test('the model can be set to Sonnet', { options: { model: 'sonnet' } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await withCourse($, clock);
  expect(s.asks[0]!.model).toBe('sonnet');
});

const stored = (s: Spy) => (s.store.get(`${ROOT}:courses`) as any[])[0];
const rightOf = (s: Spy, key: string) => {
  const c = stored(s).course;
  return key.startsWith('l') ? c.lessons[Number(key.slice(1, key.indexOf('.')))].check.right : c.final[Number(key.slice(1))].right;
};

test('a whole course: briefing, four cards and a check per lesson, the final quiz, the score and the badge', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const ui = await withCourse($, clock);
  await ui.press({ key: 'next' }); // the briefing
  expect(await text(ui)).toMatch(/The issue  You wanted a small habit-tracker API/);
  expect(await text(ui)).toMatch(/Claude ran 8 commands and changed 13 files\. One check failed before the fix\./);
  expect(await text(ui)).not.toMatch(/[A-Z]{4,} [A-Z]{2,}/); // no all-caps labels
  await ui.press({ key: 'next' }); // lesson 1, what it is
  expect(await text(ui)).toMatch(/Lesson 1 of 3 · Time zones in streaks/);
  expect(await text(ui)).toMatch(/Where that breaks/);
  await ui.press({ key: 'next' }); // where it lives, with the real diff
  expect(await has(ui, { type: 'Code' })).toBe(true);
  await ui.press({ key: 'next' }); // what Claude did: guess first
  expect(await text(ui)).toMatch(/What would you have done/);
  expect(await has(ui, { type: 'Button', key: 'next' })).toBe(false); // no skipping the guess
  const d = stored(s).course.lessons[0].did;
  await ui.press({ key: `opt${(d.picked + 1) % d.options.length}` });
  expect(await text(ui)).toMatch(/Claude chose differently/);
  expect(await text(ui)).toMatch(/The trade-off/);
  await ui.press({ key: 'next' }); // takeaway, with a prompt to save
  expect(await has(ui, { type: 'Button', key: 'todo' })).toBe(true);
  await ui.press({ key: 'next' }); // the check
  expect(await has(ui, { type: 'Button', key: 'next' })).toBe(false);
  await ui.press({ key: `opt${rightOf(s, 'l0.check')}` });
  expect(await text(ui)).toMatch(/Right\./);
  for (const i of [1, 2]) {
    await ui.press({ key: 'next' }); // the next lesson
    expect(await text(ui)).toMatch(new RegExp(`Lesson ${i + 1} of 3`));
    await ui.press({ key: 'know' }); // "I know this" skips to what Claude did
    expect(await text(ui)).toMatch(/What Claude did/);
    await ui.press({ key: 'next' });
    await ui.press({ key: 'next' });
    await ui.press({ key: `opt${rightOf(s, `l${i}.check`)}` });
  }
  await ui.press({ key: 'next' }); // the final quiz
  for (const j of [0, 1]) {
    expect(await text(ui)).toMatch(new RegExp(`question ${j + 1} of 2`));
    await ui.press({ key: `opt${rightOf(s, `f${j}`)}` });
    await ui.press({ key: 'next' });
  }
  await clock.settle();
  expect(await text(ui)).toMatch(/Course complete/);
  expect(await text(ui)).toMatch(/You got 5 of 5 right\. Badge 1 in this project\./);
  expect(s.toasts.some(t => /Course complete/.test(t))).toBe(true);
  expect(typeof stored(s).progress.finishedAt).toBe('number');
  expect(s.store.get(`${ROOT}:review`) ?? []).toEqual([]); // nothing missed (the guess is never graded)
  await ui.unmount();
});

test('an answered question is never asked again: reading the lesson again shows your answer', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const ui = await withCourse($, clock);
  await ui.press({ key: 'lesson1' });
  for (let k = 0; k < 4; k++) await ui.press({ key: 'next' });
  await ui.press({ key: `opt${rightOf(s, 'l1.check')}` });
  await ui.press({ key: 'menu' });
  expect(await text(ui)).toMatch(/JWT login/);
  await ui.press({ key: 'lesson1' });
  for (let k = 0; k < 4; k++) await ui.press({ key: 'next' });
  expect(await has(ui, { type: 'Button', key: 'opt0' })).toBe(false);
  expect(await text(ui)).toMatch(/Right\./);
  await ui.unmount();
});

test('a missed question goes to the review deck; at the next break it comes back until answered right', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const ui = await withCourse($, clock);
  await ui.press({ key: 'lesson2' });
  for (let k = 0; k < 4; k++) await ui.press({ key: 'next' });
  await ui.press({ key: `opt${(rightOf(s, 'l2.check') + 1) % 3}` });
  await clock.settle();
  expect(await text(ui)).toMatch(/Not quite\./);
  const deck = s.store.get(`${ROOT}:review`) as Array<{ ask: string; right: number; options: string[] }>;
  expect(deck.map(q => q.ask)).toEqual(['What does the API answer over the limit?']);
  await ui.press({ key: 'menu' });
  await ui.press({ key: 'review' });
  await ui.press({ key: `opt${(deck[0]!.right + 1) % 3}` }); // wrong again: it stays, with the reason
  expect(await text(ui)).toMatch(/It stays in your review deck/);
  expect(await text(ui)).toMatch(/Try again/);
  await ui.press({ key: 'next' });
  await ui.press({ key: `opt${deck[0]!.right}` });
  await clock.settle();
  expect(s.store.get(`${ROOT}:review`)).toEqual([]);
  await ui.unmount();
});

async function finishedRecord(id = 'old-session', sessionTitle = 'Setting up checkout') {
  const course = validateCourse({ ...COURSE_REPLY, title: sessionTitle }, { kind: 'build', createdAt: T0 - 86_400_000, model: 'haiku', stats: { messages: 40, commands: 12, helpers: 0, files: 5, failed: 1 } })!;
  const answers = Object.fromEntries(questionsOf(course).map(x => [x.key, x.q.right]));
  return { course: { ...course, session: id }, progress: { read: ['briefing'], answers, finishedAt: T0 - 80_000_000 } };
}

test('the library: an earlier course opens as it was, and the new course is told what was already taught', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const old = await finishedRecord();
  const s = engine(on, { sessionId: 'session-2', store: { [`${ROOT}:courses`]: [old] } });
  await start($);
  await open($);
  const ui = await pane($);
  expect(await text(ui)).toMatch(/Make this session's course/); // the old course is not this session's
  await ui.press({ key: 'library' });
  expect(await text(ui)).toMatch(/1 badge earned/);
  await ui.press({ key: `c-${old.course.id}` });
  expect(await text(ui)).toMatch(/Setting up checkout/);
  expect(await text(ui)).toMatch(/See your score and badge/);
  await ui.press({ key: 'this' });
  await ui.press({ key: 'prepare' });
  await clock.settle();
  expect(s.asks[0]!.prompt).toMatch(/Already taught in earlier courses.*Time zones in streaks; JWT login; Rate limiting/);
  expect((s.store.get(`${ROOT}:courses`) as unknown[]).length).toBe(2);
  await ui.unmount();
});

test('a resumed session finds its own course without a new request', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1', 'Building the habit tracker API');
  const s = engine(on, { store: { [`${ROOT}:courses`]: [mine] } });
  await start($);
  await open($);
  await clock.settle();
  const ui = await pane($);
  expect(await text(ui)).toMatch(/Building the habit tracker API/);
  expect(s.completes).toBe(0);
  await ui.unmount();
});

test('sharing: copied where the surface allows it; otherwise a text file and a badge image; the title only when asked', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1', 'Secret project X');
  const s = engine(on, { home: '/home/u', store: { [`${ROOT}:courses`]: [mine] } });
  await start($);
  await open($);
  const ui = await pane($, 'vscode');
  await ui.press({ key: 'next' }); // see your score
  expect(await text(ui)).toMatch(/Course complete/);
  await ui.press({ key: 'share' });
  await clock.settle();
  const files = [...s.written.keys()];
  expect(files.some(f => /^\/home\/u\/Downloads\/halftime-.*\.txt$/.test(f))).toBe(true);
  expect(files.some(f => /\.svg$/.test(f))).toBe(true);
  const txt = [...s.written.entries()].find(([f]) => f.endsWith('.txt'))![1];
  expect(txt).toMatch(/5\/5 on the quiz/);
  expect(txt.includes('Secret project X')).toBe(false);
  expect([...s.written.values()].some(v => v.includes('Secret project X'))).toBe(false);
  await ui.press({ key: 'title' });
  await ui.press({ key: 'share' });
  await clock.settle();
  expect([...s.written.values()].some(v => v.includes('Secret project X'))).toBe(true);
  expect(s.toasts.some(t => /Saved to \/home\/u\/Downloads/.test(t))).toBe(true);
  await ui.unmount();
});

test('open in your browser: one page saved under Claude Code\'s folder, opened with the system\'s command; never on a phone', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1', 'Building the habit tracker API');
  const s = engine(on, { home: '/home/u', store: { [`${ROOT}:courses`]: [mine] } });
  await start($);
  await open($);
  const phone = await pane($, 'mobile');
  expect(await phone.find({ type: 'Button', key: 'browser' })).toBeUndefined();
  await phone.unmount();
  const ui = await pane($);
  expect(await text(ui)).toMatch(/Open in your browser/);
  await ui.press({ key: 'browser' });
  await clock.settle();
  const [path, html] = [...s.written.entries()].find(([f]) => f.endsWith('.html'))!;
  expect(path).toMatch(/^\/home\/u\/\.claude\/halftime\/[a-z0-9-]+\/building-the-habit-tracker-api-[a-z0-9]{6}\.html$/);
  expect(html).toMatch(/<title>Building the habit tracker API · Halftime<\/title>/);
  expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'/);
  expect(s.ran).toEqual([['uname', '-s'], ['open', path]]);
  expect(s.toasts.at(-1)).toMatch(/Opened in your browser\. Answers there stay in the browser/);
  expect(await text(ui)).toMatch(/opened · your answers there stay in the browser/);
  await ui.unmount();
});

test('open in your browser on Linux uses xdg-open; when nothing opens, the toast gives the path', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1');
  const s = engine(on, { home: '/home/u', os: 'Linux', openExit: 3, store: { [`${ROOT}:courses`]: [mine] } });
  await start($);
  await open($);
  const ui = await pane($);
  await ui.press({ key: 'browser' });
  await clock.settle();
  const path = [...s.written.keys()].find(f => f.endsWith('.html'))!;
  expect(s.ran.at(-1)).toEqual(['xdg-open', path]);
  expect(s.toasts.at(-1)).toBe(`Saved the course page. Open it in your browser: ${path}`);
  await ui.unmount();
});

test('sharing in the terminal copies to the clipboard', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1');
  const s = engine(on, { copy: true, store: { [`${ROOT}:courses`]: [mine] } });
  await start($);
  await open($);
  const ui = await pane($);
  await ui.press({ key: 'next' });
  await ui.press({ key: 'share' });
  await clock.settle();
  expect(s.copied.length).toBe(1);
  expect(s.written.size).toBe(0);
  await ui.unmount();
});

test('an incomplete reply saves nothing and says so; a failed request too; an empty session sends nothing', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { reply: '{"title":"Only a title"}' });
  await start($);
  const ui = await withCourse($, clock);
  expect(s.toasts.some(t => /came back incomplete/.test(t))).toBe(true);
  expect(s.store.get(`${ROOT}:courses`)).toBe(undefined);
  expect(await has(ui, { type: 'Button', key: 'prepare' })).toBe(true); // you can try again
  await ui.unmount();
});

test('a failed request says so and saves nothing', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { reply: null });
  await start($);
  await withCourse($, clock);
  expect(s.toasts.some(t => /could not write the course \(api-error\)/.test(t))).toBe(true);
  expect(s.store.get(`${ROOT}:courses`)).toBe(undefined);
});

test('a session with nothing to teach sends no request', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { session: [user('hi'), claude('Hello! How can I help?')] });
  await start($);
  await withCourse($, clock);
  expect(s.completes).toBe(0);
  expect(s.toasts.some(t => /Nothing to teach yet/.test(t))).toBe(true);
});

test('during a real limit no request is made; the pane offers to write the next course in time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  s.usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }];
  await measure($, 100, RESET, clock);
  const ui = await pane($);
  expect(await has(ui, { type: 'Button', key: 'prepare' })).toBe(false);
  await ui.press({ key: 'always' });
  await clock.settle();
  expect(s.store.get('always')).toBe(true);
  expect(s.completes + s.forks).toBe(0);
  await ui.unmount();
});

test('a damaged store never breaks the pane', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on, { store: { [`${ROOT}:courses`]: 'garbage', [`${ROOT}:review`]: [{ nope: 1 }, null], [`${ROOT}:todos`]: [3, 'keep me'] } });
  await start($);
  await open($);
  await clock.settle();
  for (const surface of SURFACES) {
    const ui = await pane($, surface);
    expect(await text(ui)).toMatch(/Make this session's course/);
    expect(await has(ui, { type: 'Button', key: 'review' })).toBe(false);
    await ui.unmount();
  }
});

test('the desktop app walks the course: briefing, then the guess', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on, { surfaces: ['desktop'] });
  await start($);
  const ui = await withCourse($, clock, 'desktop');
  for (let k = 0; k < 4; k++) await ui.press({ key: 'next' });
  expect(await text(ui)).toMatch(/What would you have done/);
  await ui.press({ key: 'opt0' });
  expect(await text(ui)).toMatch(/Claude chose/);
  await ui.unmount();
});

test('VS Code and mobile walk the course too', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { surfaces: ['vscode'] });
  await start($);
  const ui = await withCourse($, clock, 'vscode');
  await ui.press({ key: 'lesson0' });
  for (let k = 0; k < 2; k++) await ui.press({ key: 'next' });
  await ui.press({ key: 'opt1' });
  await ui.press({ key: 'next' });
  await ui.press({ key: 'next' });
  await ui.press({ key: `opt${rightOf(s, 'l0.check')}` });
  expect(await text(ui)).toMatch(/Right\./);
  await ui.unmount();
  const m = await pane($, 'mobile');
  await m.press({ key: 'menu' });
  expect(await text(m)).toMatch(/Building the habit tracker API/);
  await m.press({ key: 'lesson1' });
  expect(await text(m)).toMatch(/JWT login/);
  await m.unmount();
});

test('during a limit the band names the ready course', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on);
  await start($);
  await withCourse($, clock);
  await measure($, 100, RESET, clock);
  const b = await band($);
  expect(await text(b)).toMatch(/Your course is ready: Building the habit tracker API/);
  await b.unmount();
});

/* ---------- asking before the one request ---------- */

test('near the limit Halftime asks once above the prompt, and spends nothing until you answer', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 86, RESET, clock);
  await turns($, clock, ['a', 'b']);
  expect(await asking($)).toBe(false); // too little done yet to teach
  await turns($, clock, ['c']);
  expect(await asking($)).toBe(true);
  for (const surface of SURFACES) {
    const b = await band($, surface);
    expect(await has(b, { type: 'Text', text: /86% of your 5-hour limit/ })).toBe(true);
    expect(await has(b, { type: 'Button', key: 'always' })).toBe(true);
    expect(await has(b, { type: 'Button', key: 'no' })).toBe(true);
    await b.unmount();
  }
  expect(s.forks + s.completes).toBe(0);
});

test('"Not now" stays quiet for that window, and asks again in the next one', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 86, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  const b = await band($);
  await b.press({ key: 'no' });
  await b.unmount();
  expect(await asking($)).toBe(false);
  await measure($, 92, RESET, clock);
  await turns($, clock, ['d', 'e']);
  expect(await asking($)).toBe(false);
  await measure($, 86, LATER, clock); // the next 5-hour window
  await turns($, clock, ['f']);
  expect(await asking($)).toBe(true);
  expect(s.completes).toBe(0);
});

test('"Prepare" makes exactly one request for the window, and the course waits in the pane', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 88, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  const b = await band($);
  await b.press({ key: 'once' });
  await b.unmount();
  await clock.settle();
  expect(s.completes).toBe(1);
  expect(s.toasts.some(t => /Your course is ready/.test(t))).toBe(true);
  expect(await asking($)).toBe(false);
  await turns($, clock, ['d', 'e']);
  expect(s.completes).toBe(1);
  expect(s.store.get('always')).toBe(undefined);
  await measure($, 100, RESET, clock);
  const ui = await pane($, 'desktop');
  expect(await text(ui)).toMatch(/Building the habit tracker API/);
  expect(await text(ui)).toMatch(/Start with the briefing/);
  await ui.unmount();
});

test('"Always" is remembered across sessions, writes without asking, and can be turned off in the pane', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 86, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  const b = await band($);
  await b.press({ key: 'always' });
  await b.unmount();
  await clock.settle();
  expect(s.store.get('always')).toBe(true);
  expect(s.completes).toBe(1);
  await measure($, 87, LATER, clock); // the next window: no question, one request
  await turns($, clock, ['d']);
  expect(await asking($)).toBe(false);
  expect(s.completes).toBe(2);
  await measure($, 96, '2026-10-15T23:30:00Z', clock); // even at 96%, where Halftime no longer asks
  await turns($, clock, ['e']);
  expect(s.completes).toBe(3);
  await open($);
  const ui = await pane($);
  await ui.press({ key: 'off' });
  await clock.settle();
  expect(s.store.get('always')).toBe(undefined);
  expect(s.toasts.some(t => /will ask before writing a course/.test(t))).toBe(true);
  await ui.unmount();
});

test('above 95% Halftime does not ask; during a limit it neither asks nor spends', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 96, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  expect(await asking($)).toBe(false);
  await measure($, 86, LATER, clock);
  await turns($, clock, ['d']);
  expect(await asking($)).toBe(true);
  // The limit hits before you answer: the question goes away, the limit band shows instead.
  await measure($, 100, LATER, clock);
  const b = await band($);
  expect(await has(b, { type: 'Button', key: 'once' })).toBe(false);
  expect(await has(b, { type: 'Button', key: 'open' })).toBe(true);
  await b.unmount();
  await turns($, clock, ['e']);
  expect(s.forks + s.completes).toBe(0);
});

test('prebake on in the settings means Always: no question', { options: { prebake: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  await measure($, 86, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  expect(await asking($)).toBe(false);
  expect(s.completes).toBe(1);
});

test('/halftime simulate ask shows the question; nothing is spent until a press', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on);
  await start($);
  const r = await $.command.run({ command: 'halftime', args: 'simulate ask', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
  expect(r.text).toMatch(/only if you press Prepare or Always/);
  const b = await band($);
  expect(await has(b, { type: 'Text', text: /most of your usage limit/ })).toBe(true);
  expect(s.completes).toBe(0);
  await b.press({ key: 'once' });
  await b.unmount();
  await clock.settle();
  expect(s.completes).toBe(1);
});

/* ---------- a long research session done mostly by helper agents ---------- */

test('a summarized session with helper agents: free notes from the summary and the helpers, on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { session: RESEARCH, agents: AGENTS });
  await start($);
  await measure($, 100, RESET, clock);
  expect(s.opened).toEqual(['halftime']);
  for (const surface of SURFACES) {
    const ui = await pane($, surface);
    expect(await text(ui)).toMatch(/You asked  Make the ticket spam filter stop flagging real customer tickets/);
    expect(await text(ui)).toMatch(/Latest  The threshold and benchmark helpers reported back/);
    expect(await has(ui, { type: 'Button', key: 'always' })).toBe(true); // during a limit: set it up for next time
    await ui.press({ key: 'notes' });
    await ui.press({ key: 'ch0' });
    expect(await text(ui)).toMatch(/Back every change with the labelled March tickets/);
    await ui.press({ key: 'next' });
    await ui.press({ key: 'next' });
    expect(await text(ui)).toMatch(/Precision rose from 0\.71 to 0\.83/);
    expect(await text(ui)).toMatch(/Still working when Halftime read the session/);
    await ui.press({ key: 'menu' });
    await ui.press({ key: 'menu' });
    await ui.unmount();
  }
});

test('a helper Halftime may not read is skipped, and the rest still works', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { session: RESEARCH, agents: { ag_fix: AGENTS.ag_fix! } });
  await start($);
  await measure($, 100, RESET, clock);
  expect(s.opened).toEqual(['halftime']);
});

/* ---------- fixes from review ---------- */

test('a session that only talked (no edits) can still get a course', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const long = 'The request goes through the router first, then the auth middleware checks the token, and only then the handler reads the database. '.repeat(4);
  const s = engine(on, { session: [user('how does a request reach the database here?'), claude(long), user('and where are errors handled?'), claude(long)] });
  await start($);
  await withCourse($, clock);
  expect(s.completes).toBe(1);
});

test('nothing to teach does not use up the window: later real work still gets its course', { options: { prebake: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const talk: Msg[] = [user('hi'), claude('Hello.')];
  const s = engine(on, { session: talk });
  await start($);
  await measure($, 86, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  expect(s.completes).toBe(0);
  talk.push(...SESSION); // the session goes on and real work happens in the same window
  await turns($, clock, ['d']);
  expect(s.completes).toBe(1);
});

test('a request the engine refuses says so and saves nothing', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const s = engine(on, { refuse: true });
  await start($);
  await withCourse($, clock);
  expect(s.toasts.some(t => /could not write the course/.test(t))).toBe(true);
  expect(s.store.get(`${ROOT}:courses`)).toBe(undefined);
});

test('with Sonnet set, every sentence that names the model says Sonnet', { options: { model: 'sonnet' } }, async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on);
  await start($);
  await $.command.run({ command: 'halftime', args: 'simulate ask', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } });
  const b = await band($);
  expect(await text(b)).toMatch(/1 small request to Claude Sonnet/);
  await b.unmount();
  await open($);
  const ui = await pane($);
  expect(await text(ui)).toMatch(/1 small request to Claude Sonnet\./);
  expect(await text(ui)).not.toMatch(/Haiku/);
  await ui.unmount();
  void clock;
});

test('a question whose window reset without a limit goes away', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  engine(on);
  await start($);
  await measure($, 90, RESET, clock);
  await turns($, clock, ['a', 'b', 'c']);
  expect(await asking($)).toBe(true);
  await measure($, 3, LATER, clock); // the window reset; you never answered
  expect(await asking($)).toBe(false);
});

test('a finished course leads to the score, even when the briefing was skipped', async ($, on) => {
  const clock = mock.clock(on, { now: T0 });
  const mine = await finishedRecord('session-1');
  engine(on, { store: { [`${ROOT}:courses`]: [{ ...mine, progress: { ...mine.progress, read: [] } }] } });
  await start($);
  await open($);
  await clock.settle();
  const ui = await pane($);
  expect(await text(ui)).toMatch(/See your score and badge/);
  await ui.unmount();
});
