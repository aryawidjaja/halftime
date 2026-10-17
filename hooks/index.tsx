// Halftime: when a Claude usage limit hits, a side pane teaches you what Claude did
// in this session, as a short course on your own project. It never blocks Claude or
// you, spends no model requests unless you allow one small request (to Claude Haiku),
// and does nothing in the background (no timers, no polling) until a limit is hit.
//
// Every engine call lives in this file (the engine follows `$` only within one
// file); the other files are pure.
//
// The limit is a small state machine kept in session state:
//   none ──(a window reads 100%)──▶ confirmed ──(its reset time passes, nothing full)──▶ none
//   none ──(a turn dies on rate_limit near 100%)──▶ unconfirmed ──(2 min later: full? confirm : clear quietly)
// Every transition is claimed with `update`, so two events racing never both act.

import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import type { Course, CourseRecord, Lessons, Limit, Msg, Progress, UiState, Window } from '../types';
import { agentsIn, assembleLessons, commandsOf, rulesFrom, worthShowing } from './build';
import { digestOf, statsOf, type Kind } from './lib/digest';
import { shouldPrebake } from './lib/prebake';
import { attachCode, coursePrompt, parseReply, validateCourse } from './lib/teach';
import { MAX_COURSES, mergeLibrary, mergeReview, readLibrary, readReview, withReview } from './lib/store';
import { KIND, badgeSvg, finished } from './learn';
import { coursePage, pagePath } from './lib/web';
import { ANCHOR, clockTime, renderAsk, renderBand, renderPane, shareText, waitText, type Act, type Consent, type El } from './views';

type Engine = EngineInterface;

const PANE = 'halftime';

const UI0: UiState = {
  view: 'home', course: '', lesson: 0, card: 0, final: 0, review: 0, reviewPick: -1, deeper: [], shareTitle: false,
  chapter: 0, step: 0, read: [], showCode: [], replay: 0,
};

// Session state. Refs are spelled as literals here so the engine can check them against types/index.d.ts.
const windowsAtom = atom({ plugin: 'halftime', key: 'windows' } as const, []);
const limitAtom = atom({ plugin: 'halftime', key: 'limit' } as const, null);
const lessonsAtom = atom({ plugin: 'halftime', key: 'lessons' } as const, null);
const courseAtom = atom({ plugin: 'halftime', key: 'course' } as const, '');
const libraryAtom = atom({ plugin: 'halftime', key: 'library' } as const, []);
const reviewAtom = atom({ plugin: 'halftime', key: 'review' } as const, []);
const prebakedForAtom = atom({ plugin: 'halftime', key: 'prebakedFor' } as const, []);
const prebakingAtom = atom({ plugin: 'halftime', key: 'prebaking' } as const, false);
const uiAtom = atom({ plugin: 'halftime', key: 'ui' } as const, UI0);
const todosAtom = atom({ plugin: 'halftime', key: 'todos' } as const, []);
const permsAtStartAtom = atom({ plugin: 'halftime', key: 'permsAtStart' } as const, []);
const lastTurnAtAtom = atom({ plugin: 'halftime', key: 'lastTurnAt' } as const, 0);
const configDirAtom = atom({ plugin: 'halftime', key: 'configDir' } as const, '');
const bootedAtom = atom({ plugin: 'halftime', key: 'booted' } as const, false);
const fillPendingAtom = atom({ plugin: 'halftime', key: 'fillPending' } as const, false);
const turnsAtom = atom({ plugin: 'halftime', key: 'turns' } as const, 0);
const continuedForAtom = atom({ plugin: 'halftime', key: 'continuedFor' } as const, '');
const lastStopAtAtom = atom({ plugin: 'halftime', key: 'lastStopAt' } as const, 0);
const clearsAtom = atom({ plugin: 'halftime', key: 'clears' } as const, 0);
const offerAtom = atom({ plugin: 'halftime', key: 'offer' } as const, '');
const declinedAtom = atom({ plugin: 'halftime', key: 'declined' } as const, []);
const alwaysAtom = atom({ plugin: 'halftime', key: 'always' } as const, false);
const browserAtom = atom({ plugin: 'halftime', key: 'browser' } as const, []);

/**
 * How long after a reset Halftime waits for Claude Code's own auto-continue before
 * stepping in. Claude Code resumes up to about 90 s after the reset, so this leaves
 * a full minute of margin.
 */
const CONTINUE_GRACE_MS = 150_000;
/** A rate_limit error this close before the limit is read counts as the turn it cut off. */
const STOP_WINDOW_MS = 10 * 60_000;
/** How long an unconfirmed limit (a rate_limit error below 100%) waits for a second reading. */
const RECHECK_MS = 120_000;
/** Above this, Halftime does not ask any more: there is too little room left for you to answer in time. */
const ASK_BELOW = 95;
const CONTINUE_TEXT = 'Your usage limit has reset. Please continue the task you were working on when it was reached.';
const SETTINGS = ['.claude/settings.local.json', '.claude/settings.json'];

const optionsFrom = (o: Record<string, unknown>) => ({
  autoOpen: o.autoOpen !== false,
  prebake: o.prebake === true, // "always" from the settings; otherwise Halftime asks before its one request
  prebakeAt: typeof o.prebakeAt === 'number' ? o.prebakeAt : 85,
  autoContinue: o.autoContinue !== false,
  minWaitMs: (typeof o.minWaitMinutes === 'number' ? o.minWaitMinutes : 5) * 60_000,
  // The lightest model by default: a course costs about a twentieth of what Sonnet would.
  model: o.model === 'sonnet' ? 'sonnet' : 'haiku',
});
let opt = optionsFrom({});

// The countdown and reset timers. They live in the module and die on a reload;
// session.start re-arms them from state. One-shot work uses $.clock.after(0) untracked.
let timers: Array<{ cancel(): void }> = [];
let retrying = false;
const clearTimers = () => { timers.forEach(t => t.cancel()); timers = []; retrying = false; };

/** Windows that block you now. A spend limit is a budget, not a wait, so it never counts. */
const blocking = (ws: readonly Window[]) => ws.filter(w => w.kind !== 'spend_limit' && w.percentUsed >= 100);
/** When every one of these windows has reset: the latest reset among them (0 when none is known). */
const latestReset = (ws: readonly Window[]) => Math.max(0, ...ws.map(w => (w.resetsAt ? Date.parse(w.resetsAt) || 0 : 0)));
const toWindows = (rs: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt?: string }>): Window[] => rs.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }));

export const register: Register = (on, options) => {
  opt = optionsFrom(options);

  /* ---------- lifecycle ---------- */

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'halftime', description: 'Learn what Claude built in this session', argumentHint: '[simulate <minutes> | simulate ask | close]' });
    if (!(await read($, bootedAtom))) {
      // First start of this session: remember the permissions you began with, and
      // load what you saved in this project before.
      const root = await $.session.root();
      const [perms, saved, courses, review, always, id] = await Promise.all([
        rulesIn($, root),
        $.store.get(`${root}:todos`).catch(() => undefined),
        $.store.get(`${root}:courses`).catch(() => undefined),
        $.store.get(`${root}:review`).catch(() => undefined),
        $.store.get('always').catch(() => undefined),
        $.session.id().catch(() => ''),
      ]);
      await update($, permsAtStartAtom, () => perms);
      if (Array.isArray(saved)) await update($, todosAtom, () => saved.filter((x): x is string => typeof x === 'string'));
      const library = readLibrary(courses);
      await update($, libraryAtom, () => library);
      await update($, reviewAtom, () => readReview(review));
      // A resumed session finds the course it already has.
      const mine = id ? library.find(r => r.course.session === id) : undefined;
      if (mine) await update($, courseAtom, () => mine.course.id);
      await update($, alwaysAtom, () => always === true);
      await update($, bootedAtom, () => true);
    }
    // A reload or a new worker drops timers; put the countdown and reset timer back.
    const lim = await read($, limitAtom);
    if (lim?.confirmed) arm($, lim);
    return next(e);
  });

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // A new conversation: the limit (an account matter) still holds, but there is no
      // interrupted task to continue any more, and the lessons were about the old one.
      clearTimers();
      const lim = await update($, limitAtom, cur => (cur ? { ...cur, stoppedAt: 0 } : cur));
      await update($, clearsAtom, n => n + 1);
      await update($, lessonsAtom, () => null);
      await update($, courseAtom, () => '');
      await update($, uiAtom, () => UI0);
      await update($, turnsAtom, () => 0);
      await update($, offerAtom, () => '');
      if (lim?.confirmed) arm($, lim);
      else $.ui.status(undefined);
    } else {
      clearTimers();
      $.ui.status(undefined);
    }
    return next(e);
  });

  /* ---------- limit detection: observe, then act outside the event ---------- */

  // Pushed by the engine after every turn and whenever a window moves a point: no polling.
  on('session.measure', async ($, e, next) => {
    const r = await next(e);
    const ws = toWindows(e.rateLimits);
    await update($, windowsAtom, () => ws);
    const full = blocking(ws), lim = await read($, limitAtom), now = await $.clock.now();
    if (full.length) $.clock.after(0, () => { void onLimit($, full, 0); });
    else if (lim && !lim.confirmed) $.clock.after(0, () => { void clearUnconfirmed($); });
    else if (lim && ws.length && (!lim.resetsAt || now >= lim.resetsAt)) $.clock.after(0, () => { void onReset($, lim.resetsAt); });
    return r;
  });

  // The turn died on an API error. The work happens after the event, so the failed
  // turn finishes exactly as it would without Halftime.
  on('classic.StopFailure', async ($, e, next) => {
    const r = await next(e);
    if (e.error === 'rate_limit') {
      const at = await $.clock.now(), path = String(e.transcript_path ?? '').replace(/\\/g, '/'), cut = path.lastIndexOf('/projects/');
      if (cut > 0) await update($, configDirAtom, () => path.slice(0, cut));
      await update($, lastStopAtAtom, () => at);
      $.clock.after(0, () => { void onStop($, at); });
    }
    return r;
  });

  on('turn.start', async ($, e, next) => { const at = await $.clock.now(); await update($, lastTurnAtAtom, () => at); return next(e); });

  on('turn.complete', async ($, e, next) => {
    const r = await next(e);
    if (e.agentId !== undefined) return r;
    await update($, turnsAtom, n => n + 1);
    // A turn got an answer while Halftime thinks you are limited: access came back early
    // (a plan change or extra usage). onReset checks the usage reading before acting.
    const lim = await read($, limitAtom), now = await $.clock.now();
    if (e.reason === 'answer' && lim?.confirmed && !lim.simulated && now - lim.startedAt > 60_000) $.clock.after(0, () => { void onReset($, lim.resetsAt); });
    // A saved prompt waits for the first quiet moment after the reset.
    if (await read($, fillPendingAtom)) $.clock.after(0, () => { void fillFirstTodo($); });
    // Near the limit: prepare the lesson (you said Always) or ask once, while the conversation is still cached.
    if (e.reason === 'answer') $.clock.after(0, () => { void nearLimit($); });
    return r;
  });

  /* ---------- command, pane, band ---------- */

  on('command.run', { command: 'halftime' }, async ($, e) => {
    if (e.args.trim() === 'close') { await $.ui.close({ id: PANE }).catch(() => undefined); return { text: 'Halftime closed.' }; }
    // Try the whole limit flow without a real limit: countdown, band, pane, reset, continue.
    if (e.args.trim() === 'simulate ask') {
      await update($, offerAtom, () => 'simulated');
      return { text: 'Halftime is showing the question it asks near a limit, above your prompt. A request is made only if you press Prepare or Always.' };
    }
    const sim = e.args.trim().match(/^simulate(?:\s+(\d+))?$/);
    if (sim) {
      const min = Math.max(1, Math.min(60, Number(sim[1] ?? 3))), at = await $.clock.now();
      await onLimit($, [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(at + min * 60_000).toISOString() }], at, true, true);
      return { text: `Halftime is simulating a usage limit that resets in ${min} min. Nothing is sent to Claude.` };
    }
    const L = await read($, lessonsAtom), now = await $.clock.now();
    // Outside a limit the session keeps growing, so rebuild when the last build is stale.
    if (!L || (!(await read($, limitAtom))?.confirmed && now - L.builtAt > 120_000)) await rebuild($);
    await $.ui.open({ id: PANE, title: 'Halftime', focus: true }); // asked for, so it takes the keys (Esc returns to the prompt)
    return { text: `Halftime is open in a side pane.${await diffHint($, e.presentation?.columns)}` };
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [L, u, lim, saved, now, preparing, always, library, current, review, browser] = await Promise.all([
      read($, lessonsAtom), read($, uiAtom), read($, limitAtom), read($, todosAtom), $.clock.now(), read($, prebakingAtom), read($, alwaysAtom),
      read($, libraryAtom), read($, courseAtom), read($, reviewAtom), read($, browserAtom),
    ]);
    const width = (e.props as { bodyColumns?: number }).bodyColumns ?? 80;
    return renderPane($.ui.resolve(e) as unknown as El, e.surface, width,
      { L, u, lim: lim?.confirmed ? lim : null, saved, now, preparing, always: always || opt.prebake, library, current, review, browser, model: modelName() }, actFor($, e.surface)) as never;
  });

  // Drawn for every band draw in the session, so it bails out on one state read when no limit is active.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lim = await read($, limitAtom);
    if (!lim?.confirmed) {
      const offer = await read($, offerAtom);
      if (!offer) return next(e);
      const w = (await read($, windowsAtom)).find(x => keyOf(x) === offer);
      // The window this question was about has reset: the question goes with it.
      if (!w && offer !== 'simulated') { await update($, offerAtom, () => ''); return next(e); }
      return renderAsk($.ui.resolve(e) as unknown as El, w, actFor($, e.surface), modelName()) as never;
    }
    const [L, course] = await Promise.all([read($, lessonsAtom), currentCourse($)]);
    if (!(L && worthShowing(L)) && !course) return next(e);
    if ((await $.ui.panes()).some(p => p.id === PANE && p.isShown)) return next(e);
    return renderBand($.ui.resolve(e) as unknown as El, lim, actFor($, e.surface), course?.title) as never;
  });
};

/* ---------- the limit ---------- */

/** A full window was read. Claims the transition, so a racing event cannot act twice. */
async function onLimit($: Engine, full: readonly Window[], stoppedAt: number, simulated = false, focus = false) {
  const now = await $.clock.now(), resetsAt = latestReset(full);
  // The usage reading can arrive after the failed turn: adopt a stop from just before.
  const lastStop = await read($, lastStopAtAtom);
  if (!stoppedAt && lastStop && now - lastStop < STOP_WINDOW_MS) stoppedAt = lastStop;
  const seen = { fresh: false, moved: false };
  const lim = await update($, limitAtom, (cur): Limit => {
    const same = !!cur?.confirmed && (!resetsAt || cur.resetsAt === resetsAt);
    seen.fresh = !cur?.confirmed;
    seen.moved = !!cur?.confirmed && !same; // another window filled up: the reset moved later
    if (cur && same && cur.stoppedAt >= stoppedAt) return cur; // nothing new: no write, no redraw
    return {
      kinds: full.map(w => w.kind),
      resetsAt: resetsAt || cur?.resetsAt || 0,
      startedAt: cur?.confirmed ? cur.startedAt : now,
      stoppedAt: Math.max(cur?.stoppedAt ?? 0, stoppedAt),
      confirmed: true,
      // A real limit arriving during a simulation makes it real.
      simulated: simulated && (cur ? !!cur.simulated : true),
    };
  });
  if (!lim) return;
  if (seen.moved) { arm($, lim); $.ui.toast(`Another usage limit was reached. Claude is back at ${clockTime(lim.resetsAt)}.`); return; }
  if (!seen.fresh) return;
  await update($, offerAtom, () => '');
  arm($, lim);
  if (!lim.simulated && lim.resetsAt && lim.resetsAt - now < opt.minWaitMs) return;
  // Build once per limit. Reading the transcript copies it, so never more often.
  const lessons = await rebuild($);
  if (!worthShowing(lessons) && !(await currentCourse($))) return;
  if (!opt.autoOpen) { $.ui.toast('Usage limit reached. Type /halftime to learn what Claude built while you wait.'); return; }
  const opened = await $.ui.open({ id: PANE, title: 'Halftime', ...(focus ? { focus: true as const } : {}) });
  $.ui.toast(opened.isPlaced ? `Usage limit reached. Halftime opened beside your session.${await diffHint($)}` : 'Usage limit reached. Open Halftime from the line above your prompt, or type /halftime.');
}

/**
 * Claude Code's diff panel shares the terminal's side dock and can cover a plugin's pane
 * while the pane still reports itself shown, so Halftime cannot tell. It says how to
 * uncover it instead, only in a terminal wide enough for that panel (110 columns).
 */
async function diffHint($: Engine, columns?: number): Promise<string> {
  if (columns !== undefined && columns < 110) return '';
  return (await $.session.surfaces()).includes('terminal') ? ' Not seeing it? The diff panel may be covering it: type /diff to hide that panel.' : '';
}

/**
 * A turn died on rate_limit. That is either the limit or a passing 429. At 100% it is
 * the limit; just below, Halftime waits for a second reading before showing anything.
 */
async function onStop($: Engine, at: number) {
  const ws = toWindows((await $.session.usage()).rateLimits);
  const full = blocking(ws);
  if (full.length) return onLimit($, full, at);
  const top = ws.filter(w => w.kind !== 'spend_limit').sort((a, b) => b.percentUsed - a.percentUsed)[0];
  if (!top || top.percentUsed < 98) return;
  await update($, limitAtom, (cur): Limit | null => cur ?? { kinds: [top.kind], resetsAt: latestReset([top]), startedAt: at, stoppedAt: at, confirmed: false });
  $.clock.after(RECHECK_MS, async () => {
    const again = blocking(toWindows((await $.session.usage()).rateLimits));
    if (again.length) await onLimit($, again, at);
    else await clearUnconfirmed($);
  });
}

async function clearUnconfirmed($: Engine) {
  await update($, limitAtom, cur => (cur && !cur.confirmed ? null : cur));
}

/** The status-line countdown (once a minute) and the reset timer. Only while limited. */
function arm($: Engine, lim: Limit) {
  clearTimers();
  const show = async () => {
    const now = await $.clock.now();
    $.ui.status(lim.resetsAt ? `Halftime · Claude is back at ${clockTime(lim.resetsAt)} (${waitText(lim.resetsAt - now)})` : 'Halftime · waiting for your usage limit to reset');
  };
  void show();
  timers.push($.clock.every(60_000, () => { void show(); }));
  void $.clock.now().then(now => {
    if (lim.resetsAt) timers.push($.clock.after(Math.max(1_000, lim.resetsAt - now + 5_000), () => { void onReset($, lim.resetsAt); }));
    // No reset time reported: check the free usage reading every 5 minutes.
    else timers.push($.clock.every(5 * 60_000, () => { void onReset($, 0); }));
  });
}

/** The reset time passed. Acts only if no window is still full, and only once per limit. */
async function onReset($: Engine, expected: number) {
  const now = await $.clock.now();
  const full = blocking(toWindows((await $.session.usage()).rateLimits));
  if (full.length) {
    // Still full: another window, or the clock is ahead of the server. Look again shortly.
    if (latestReset(full) > now) return onLimit($, full, 0);
    if (expected && !retrying) { retrying = true; timers.push($.clock.after(60_000, () => { retrying = false; void onReset($, expected); })); }
    return;
  }
  const claim: { was: Limit | null } = { was: null };
  await update($, limitAtom, cur => {
    claim.was = cur && cur.confirmed && cur.resetsAt === expected ? cur : null;
    return claim.was ? null : cur;
  });
  const was = claim.was;
  if (!was) return;
  clearTimers();
  $.ui.status(undefined);
  $.ui.toast(was.simulated ? 'The simulated limit is over. Claude is back.' : 'Your usage limit has reset. Claude is back.');
  const hasTodos = (await read($, todosAtom)).length > 0;
  await update($, fillPendingAtom, () => hasTodos);
  if (was.stoppedAt && opt.autoContinue) {
    const clears = await read($, clearsAtom);
    $.clock.after(Math.max(now, was.resetsAt) + CONTINUE_GRACE_MS - now, () => { void continueIfNeeded($, was, clears); });
  }
  else await fillFirstTodo($);
}

/**
 * Claude Code continues by itself after a reset (on by default). Halftime steps in
 * only when that did not happen: no turn started since the turn that the limit cut
 * off, you are not typing, you did not turn the built-in option off, and Halftime
 * has not already continued this limit.
 */
async function continueIfNeeded($: Engine, was: Limit, clears: number) {
  if ((await read($, clearsAtom)) !== clears) return; // a new conversation has nothing to continue
  if ((await read($, lastTurnAtAtom)) > was.stoppedAt) return;
  if (await autoContinueDisabled($)) return;
  if ((await $.prompt.read()).text.trim()) return;
  const key = `${was.resetsAt || was.startedAt}`;
  const claim = { mine: false };
  await update($, continuedForAtom, cur => { claim.mine = cur !== key; return key; });
  if (!claim.mine) return;
  if (was.simulated) { $.ui.toast('Simulation: this is when Halftime would ask Claude to continue the interrupted task. Nothing was sent.'); return; }
  await $.prompt.submit({ text: CONTINUE_TEXT });
}

async function autoContinueDisabled($: Engine): Promise<boolean> {
  const root = await $.session.root(), dir = await read($, configDirAtom);
  const files = [...SETTINGS.map(f => `${root}/${f}`), ...(dir ? [`${dir}/settings.json`] : [])];
  for (const t of await Promise.all(files.map(f => readText($, f)))) {
    try { if (t && (JSON.parse(t) as { autoContinueAtUsageLimit?: unknown }).autoContinueAtUsageLimit === false) return true; } catch { /* not disabled */ }
  }
  return false;
}

/** Puts the first saved prompt in the composer: never over a draft, never sent. */
async function fillFirstTodo($: Engine) {
  if (!(await read($, fillPendingAtom)) || (await read($, limitAtom))?.confirmed) return;
  const [first] = await read($, todosAtom);
  if (!first || (await $.prompt.read()).text.trim()) return;
  if ((await $.prompt.fill({ text: first })).isFilled) {
    await update($, fillPendingAtom, () => false);
    $.ui.toast('Your first saved prompt is in the prompt box. Press enter to send it.');
  }
}

/* ---------- the one optional model request ---------- */

const keyOf = (w: Window) => `${w.kind}:${w.resetsAt ?? ''}`;
/** The model as people know it, for every sentence that names it. */
const modelName = () => (opt.model === 'sonnet' ? 'Claude Sonnet' : 'Claude Haiku');

/**
 * After a turn, near the limit: write the course if you said Always, else ask once per
 * window. Never during a limit, never twice for a window, and only once the session has
 * done enough to teach.
 */
async function nearLimit($: Engine) {
  const ws = await read($, windowsAtom);
  if (blocking(ws).length || (await read($, limitAtom))) return;
  const near = ws.filter(x => x.kind !== 'spend_limit' && x.percentUsed >= opt.prebakeAt && x.percentUsed < 100);
  const keys = near.map(keyOf), done = await read($, prebakedForAtom);
  if (!shouldPrebake({ enabled: true, percentUsed: Math.max(0, ...near.map(x => x.percentUsed)), threshold: opt.prebakeAt, windowKey: keys[0] ?? '',
    doneFor: keys.some(k => done.includes(k)) ? keys[0] : '', inFlight: await read($, prebakingAtom), turns: await read($, turnsAtom) })) return;
  if (opt.prebake || (await read($, alwaysAtom))) { await prepareCourse($, keys, false); return; }
  const declined = await read($, declinedAtom), askable = near.filter(x => x.percentUsed < ASK_BELOW).map(keyOf);
  if (!askable.length || keys.some(k => declined.includes(k))) return;
  await update($, offerAtom, cur => cur || askable[0]!);
}

/** Your answer to the question above the prompt, or the switch in the pane. */
async function consent($: Engine, c: Consent) {
  const offer = await read($, offerAtom);
  await update($, offerAtom, () => '');
  if (c === 'no') { if (offer) await update($, declinedAtom, d => [...d, offer].slice(-20)); return; }
  if (c === 'off') {
    await $.store.delete('always').catch(() => undefined);
    await update($, alwaysAtom, () => false);
    $.ui.toast(opt.prebake ? 'Halftime writes courses without asking because prebake is on in /config. Turn it off there.' : 'Halftime will ask before writing a course.');
    return;
  }
  if (c === 'always' || c === 'on') {
    await $.store.set('always', true).catch(() => undefined);
    await update($, alwaysAtom, () => true);
    if (c === 'on') { $.ui.toast('Halftime will write a course before each limit, in 1 small request. Turn it off in the pane.'); return; }
  }
  const ws = await read($, windowsAtom);
  const keys = offer && offer !== 'simulated' ? ws.filter(x => keyOf(x) === offer || x.percentUsed >= opt.prebakeAt).map(keyOf) : [];
  await prepareCourse($, keys.length ? keys : offer ? [offer] : [], true);
}

/**
 * The one model request. It sends a compact digest of the session (secrets removed),
 * never the whole conversation, to the lightest model at low effort, so the cost is
 * small and the same however long the session is. Claims `keys` (the windows it
 * covers) first, so a turn finishing meanwhile cannot start a second one. Never while
 * a real limit holds: the request would only fail.
 */
async function prepareCourse($: Engine, keys: readonly string[], asked: boolean) {
  const lim = await read($, limitAtom);
  if (lim?.confirmed && !lim.simulated) { if (asked) $.ui.toast('Claude is paused by your usage limit. A course can be written after the reset.'); return; }
  const claim = { mine: false };
  await update($, prebakingAtom, cur => { claim.mine = !cur; return true; });
  if (!claim.mine) return;
  try {
    const { msgs, L } = await readSession($);
    await update($, lessonsAtom, () => L);
    // Checked before the window is claimed, so later real work in this window still gets its course.
    if (!worthShowing(L)) { if (asked) $.ui.toast('Nothing to teach yet: Claude has not done any work in this session.'); return; }
    if (keys.length) await update($, prebakedForAtom, cur => [...cur, ...keys.filter(k => !cur.includes(k))].slice(-20));
    const [library, now, sid] = await Promise.all([read($, libraryAtom), $.clock.now(), $.session.id().catch(() => '')]);
    const taught = [...new Set(library.flatMap(r => r.course.lessons.map(l => l.topic)))];
    const r = await $.model.complete({ model: opt.model, prompt: coursePrompt(digestOf(L, msgs), L.kind as Kind, taught), maxTokens: 64_000, effort: 'low', timeoutMs: 330_000 });
    if (!r.isAnswered) { if (asked) $.ui.toast(`Claude could not write the course (${r.reason}). Nothing was spent beyond that request.`); return; }
    const course = validateCourse(parseReply(r.text), { kind: L.kind, createdAt: now, model: opt.model, stats: statsOf(L) });
    if (!course) { if (asked) $.ui.toast('The course came back incomplete, so nothing was saved. You can try again from the pane.'); return; }
    const full: Course = { ...attachCode(course, L), ...(sid ? { session: sid } : {}), usage: { input: r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens, output: r.usage.output_tokens } };
    await update($, libraryAtom, cur => [{ course: full, progress: { read: [], answers: {} } }, ...cur.filter(x => x.course.id !== full.id)].slice(0, MAX_COURSES));
    void saveLibrary($);
    await update($, courseAtom, () => full.id);
    await update($, uiAtom, (u): UiState => ({ ...u, course: '', view: 'home' }));
    if (asked) $.ui.toast(`Your course is ready: ${full.title}. ${full.lessons.length} lessons, in the Halftime pane.`);
  } catch (err) {
    // The engine refuses a request it will not send (a blocked model, a cap above the model's): say so, keep everything else.
    if (asked) $.ui.toast(`Claude could not write the course (${err instanceof Error ? err.message : 'refused'}). Nothing was saved.`);
  } finally {
    await update($, prebakingAtom, () => false);
  }
}

/** This session's course, if one was written. */
async function currentCourse($: Engine): Promise<Course | undefined> {
  const id = await read($, courseAtom);
  return id ? (await read($, libraryAtom)).find(r => r.course.id === id)?.course : undefined;
}

// Store writes run one after another and write the latest state, so a slow early write
// can never land after a later one.
let saving: Promise<unknown> = Promise.resolve();

/**
 * Saves the course library, merged with what another session in this project saved
 * meanwhile, so neither erases the other's courses or answers; this session then sees
 * the merged library too. Over the store's size cap, the oldest courses go first.
 */
function saveLibrary($: Engine) {
  saving = saving.then(async () => {
    const root = await $.session.root();
    const stored = readLibrary(await $.store.get(`${root}:courses`).catch(() => undefined));
    const lib = await update($, libraryAtom, cur => mergeLibrary(stored, cur));
    for (let n = lib.length; n >= 1; n--) {
      if (await $.store.set(`${root}:courses`, lib.slice(0, n)).then(() => true, () => false)) return;
    }
  }).catch(() => undefined);
  return saving;
}

/** Questions answered right in this session: a merge with another session's deck must not bring them back. */
const cleared = new Set<string>();

function saveReview($: Engine) {
  saving = saving.then(async () => {
    const root = await $.session.root();
    const stored = readReview(await $.store.get(`${root}:review`).catch(() => undefined));
    const list = await update($, reviewAtom, cur => mergeReview(stored, cur, cleared));
    await $.store.set(`${root}:review`, list).catch(() => undefined);
  }).catch(() => undefined);
  return saving;
}

/**
 * Shares a finished course: on the clipboard where the surface allows it, otherwise as
 * a text file and a badge image in your Downloads folder (or home folder).
 */
async function shareCourse($: Engine, id: string, surface: string) {
  const [lib, u] = await Promise.all([read($, libraryAtom), read($, uiAtom)]);
  const rec = lib.find(r => r.course.id === id);
  if (!rec) return;
  const text = shareText(rec, u.shareTitle);
  const copied = await $.ui.copy({ text, surface: surface as never }).catch(() => ({ isCopied: false }));
  if (copied.isCopied) { $.ui.toast('Copied. Paste it wherever you like to share.'); return; }
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'));
  if (!home) { $.ui.toast(text); return; }
  const downloads = `${home}/Downloads`;
  const dir = (await $.fs.exists(downloads).catch(() => false)) ? downloads : home;
  const name = `halftime-${new Date(rec.course.createdAt).toISOString().slice(0, 10)}-${rec.course.id.slice(-6)}`;
  try {
    await $.fs.write(`${dir}/${name}.txt`, text + '\n');
    await $.fs.write(`${dir}/${name}.svg`, badgeSvg(rec, u.shareTitle));
    $.ui.toast(`Saved to ${dir}: ${name}.txt and a badge image, ${name}.svg.`);
  } catch {
    $.ui.toast(text);
  }
}

/**
 * Saves a course as one web page under Claude Code's folder and opens it in your default
 * browser. The page starts from your progress here, then keeps its own; nothing is sent anywhere.
 */
async function openInBrowser($: Engine, id: string) {
  const [lib, lim, saved, dir, root] = await Promise.all([read($, libraryAtom), read($, limitAtom), read($, todosAtom), read($, configDirAtom), $.session.root()]);
  const rec = lib.find(r => r.course.id === id);
  if (!rec) return;
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'));
  const base = dir || (home ? `${home}/.claude` : '');
  if (!base) { $.ui.toast('Halftime could not find a folder to save the course page in.'); return; }
  const project = root.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || 'your project';
  const path = pagePath(base, project, rec);
  try {
    await $.fs.write(path, coursePage(rec, { project, kind: KIND[rec.course.kind] ?? 'Session', resetsAt: lim?.confirmed ? lim.resetsAt : undefined, saved }));
  } catch {
    $.ui.toast('Halftime could not save the course page. The course is still here in the pane.'); return;
  }
  await update($, browserAtom, cur => (cur.includes(id) ? cur : [...cur, id]));
  const opened = await openFile($, path);
  $.ui.toast(opened ? 'Opened in your browser. Answers there stay in the browser; this pane keeps its own.' : `Saved the course page. Open it in your browser: ${path}`);
}

/** Opens a file with the system's own command: open (macOS), xdg-open (Linux), start (Windows). */
async function openFile($: Engine, path: string): Promise<boolean> {
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  const os = windows ? 'Windows' : (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim() ?? '';
  // Each command written out in full, so anyone reading this can see exactly what runs.
  // Windows: explorer.exe opens the file in the default browser, no shell involved. It reports exit code 1
  // even when it worked, so there it counts as opened once it ran.
  if (windows) return !!(await $.process.run(['explorer.exe', path.replace(/\//g, '\\')], { timeoutMs: 15_000 }).catch(() => undefined));
  const r = os === 'Darwin' ? await $.process.run(['open', path], { timeoutMs: 15_000 }).catch(() => undefined)
    : await $.process.run(['xdg-open', path], { timeoutMs: 15_000 }).catch(() => undefined);
  return !!r && r.exitCode === 0;
}

/* ---------- lessons and the pane's actions ---------- */

async function readText($: Engine, path: string, maxBytes = 400_000): Promise<string | undefined> {
  const st = await $.fs.stat(path).catch(() => undefined);
  if (!st || st.kind !== 'file' || st.size > maxBytes) return undefined;
  return $.fs.read(path).catch(() => undefined);
}

async function rulesIn($: Engine, root: string): Promise<string[]> {
  return rulesFrom(await Promise.all(SETTINGS.map(f => readText($, `${root}/${f}`))));
}

/** One transcript read (plus each helper's), a few small file reads, no model calls. */
async function readSession($: Engine): Promise<{ msgs: Msg[]; L: Lessons }> {
  const [msgs, root, now, booted] = await Promise.all([$.session.messages() as Promise<Msg[]>, $.session.root(), $.clock.now(), read($, bootedAtom)]);
  const rulesNow = await rulesIn($, root);
  // Without a snapshot from the start of the session, report no permission as new.
  const permsAtStart = booted ? await read($, permsAtStartAtom) : rulesNow;
  // Helper agents often do most of the work; read each one's transcript too (at most 30).
  const agents = new Map<string, { task: string; msgs: Msg[] }>();
  await Promise.all(agentsIn(msgs).map(async a => {
    const got = await $.session.messages({ agentId: a.id }).catch(() => undefined);
    if (Array.isArray(got)) agents.set(a.id, { task: a.task, msgs: got as Msg[] });
  }));
  const { packages } = commandsOf(msgs);
  const described = await Promise.all(packages.map(async n => {
    const text = await readText($, `${root}/node_modules/${n}/package.json`, 200_000);
    try { const d = text && (JSON.parse(text) as { description?: unknown }).description; return typeof d === 'string' ? [n, d] as const : undefined; } catch { return undefined; }
  }));
  const L = await assembleLessons({
    msgs, agents, root, now, permsAtStart, rulesNow,
    descriptions: new Map(described.filter((x): x is readonly [string, string] => !!x)),
    read: f => readText($, `${root}/${f}`),
  });
  return { msgs, L };
}

/** Reads the session afresh and starts the pane at its home. Keeps your sharing choice. */
async function rebuild($: Engine): Promise<Lessons> {
  const { L } = await readSession($);
  await update($, lessonsAtom, () => L);
  await update($, uiAtom, (u): UiState => ({ ...UI0, shareTitle: u.shareTitle }));
  return L;
}

/** Saves this session's list, keeping prompts another session in this project saved. */
async function saveTodos($: Engine, list: readonly string[], removed?: string) {
  const key = `${await $.session.root()}:todos`;
  const prev = await $.store.get(key).catch(() => undefined);
  const others = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string' && !list.includes(x) && x !== removed) : [];
  await $.store.set(key, [...list, ...others]).catch(() => undefined);
}

/** The callbacks the pane's buttons run. */
function actFor($: Engine, surface: string): Act {
  // Park the focus ring on the header before a press redraws the pane, so the button
  // that was pressed can disappear without handing the keyboard back to the prompt.
  // Only the terminal draws that header; elsewhere waiting on the focus call delays every press.
  const keep = surface === 'terminal' ? () => $.ui.focus({ requestId: PANE, key: ANCHOR }).catch(() => undefined) : () => Promise.resolve();
  return {
    ui: fn => { void keep().then(() => update($, uiAtom, fn)); },
    progress: (id, fn, ui) => { void keep().then(() => onProgress($, id, fn, ui)); },
    review: (item, right) => {
      if (right) cleared.add(item.ask); else cleared.delete(item.ask);
      void update($, reviewAtom, cur => withReview(cur, item, right)).then(() => saveReview($));
    },
    saveTodo: text => { void keep().then(() => update($, todosAtom, l => (l.includes(text) ? l : [...l, text]))).then(l => saveTodos($, l)); },
    removeTodo: i => {
      const gone = { text: '' };
      void keep().then(() => update($, todosAtom, l => { gone.text = l[i] ?? ''; return l.filter((_, j) => j !== i); })).then(l => saveTodos($, l, gone.text));
    },
    share: id => { void shareCourse($, id, surface); },
    browser: id => { void openInBrowser($, id); },
    open: () => { void $.ui.open({ id: PANE, title: 'Halftime', focus: true }); },
    prepare: () => { void prepareCourse($, [], true); },
    consent: c => { void consent($, c); },
  };
}

/** Applies a progress change, marks the course finished once every question is answered, and saves. */
async function onProgress($: Engine, id: string, fn: (p: Progress) => Progress, ui?: (u: UiState) => UiState) {
  const done = { now: false };
  const at = await $.clock.now();
  await update($, libraryAtom, cur => cur.map((r): CourseRecord => {
    if (r.course.id !== id) return r;
    const next = { ...r, progress: fn(r.progress) };
    if (!next.progress.finishedAt && finished(next)) { done.now = true; next.progress = { ...next.progress, finishedAt: at }; }
    return next;
  }));
  if (ui) await update($, uiAtom, ui);
  if (done.now) $.ui.toast('★ Course complete. Your score and badge are in the pane.');
  void saveLibrary($);
}
