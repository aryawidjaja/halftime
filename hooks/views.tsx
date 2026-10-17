// The Halftime pane and the line above the prompt. Pure: the hooks module reads state,
// passes it in with an `Act` of callbacks, and does every write itself. The screens
// live in learn.tsx (the course) and notesviews.tsx (the free session notes).

import type { Limit, Window } from '../types';
import { vBriefing, vFinal, vHome, vLesson, vLibrary, vReview, vScore } from './learn';
import { notesOf } from './notes';
import { vNotes, vPrompts, vReplay, vStep } from './notesviews';
import { ANCHOR, clockTime, type Act, type Ctx, type El, type PaneData } from './ui';

export { ANCHOR, clockTime, waitText, type Act, type Consent, type El, type PaneData } from './ui';
export { shareText } from './learn';

export function renderPane(el: El, surface: string, width: number, d: PaneData, act: Act) {
  const { Box, Text, Button } = el;
  if (!d.L && !d.library.length) return <Box flexDirection="column"><Text color="inactive">Reading this session…</Text></Box>;
  const rec = d.library.find(r => r.course.id === (d.u.course || d.current));
  const c: Ctx = { ...d, act, surface, el, width, rec, notes: d.L ? notesOf(d.L) : null };
  const v = d.u.view;
  const needsL = v === 'notes' || v === 'chapter' || v === 'replay';
  const body =
    needsL && !c.L ? vHome(c)
    : v === 'briefing' ? vBriefing(c)
    : v === 'lesson' ? vLesson(c)
    : v === 'final' ? vFinal(c)
    : v === 'score' ? vScore(c)
    : v === 'review' ? vReview(c)
    : v === 'library' ? vLibrary(c)
    : v === 'notes' ? vNotes(c)
    : v === 'chapter' ? vStep(c)
    : v === 'replay' ? vReplay(c)
    : v === 'prompts' ? vPrompts(c)
    : vHome(c);
  // In the terminal, a header every screen draws, under one key: the pane keeps the keyboard only
  // while its focus ring sits on something still drawn, so presses park the ring here first.
  // Elsewhere people click, so there is no header and no key hints.
  const header = surface === 'terminal' ? (
    <Button key={ANCHOR} plain onPress={() => act.ui(x => ({ ...x, view: 'home' }))}>
      <Text color="claude">Halftime</Text><Text color="inactive">{v === 'home' ? '  ·  esc returns to your prompt' : '  ·  m: menu  ·  esc returns to your prompt'}</Text>
    </Button>
  ) : null;
  return <Box flexDirection="column" gap={1}>{header}{body}</Box>;
}

/* ---------- the line above the prompt ---------- */

/** During a limit: when Claude is back, and the way into Halftime. */
export function renderBand(el: El, lim: Limit, act: Act, course?: string) {
  const { Box, Text, Button } = el;
  const back = lim.resetsAt ? `Claude is back at ${clockTime(lim.resetsAt)}.` : 'Claude is paused until your limit resets.';
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color="text"><Text color="claude">✻</Text> {back} {course ? `Your course is ready: ${course}.` : 'Meanwhile, learn what it did.'}</Text>
      <Button key="open" label="Open Halftime" variant="primary" onPress={act.open} />
    </Box>
  );
}

const windowName = (kind: string) => kind === 'five_hour' ? '5-hour' : kind.startsWith('seven_day') ? 'weekly' : 'usage';

/** Near a limit, once per window: may Halftime spend one small request on a course? Never blocks; ignoring it is fine. */
export function renderAsk(el: El, w: Window | undefined, act: Act, model = 'Claude Haiku') {
  const { Box, Text, Button } = el;
  const used = w ? `${Math.round(w.percentUsed)}% of your ${windowName(w.kind)} limit` : 'most of your usage limit';
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color="text"><Text color="claude">✻</Text> Halftime: you have used {used}. Write a short course on this session for the break? 1 small request to {model}.</Text>
      <Button key="once" label="Prepare" variant="primary" onPress={() => act.consent('once')} />
      <Button key="always" label="Always" onPress={() => act.consent('always')} />
      <Button key="no" label="Not now" onPress={() => act.consent('no')} />
    </Box>
  );
}
