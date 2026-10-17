// What every Halftime view shares: the element table, the callbacks a press can run,
// the drawing context, and small building blocks. Pure.

import type { Elements, RenderChildren } from 'claude-code';
import type { CourseRecord, FileChange, Lessons, Limit, Progress, ReviewItem, UiState } from '../types';
import type { Notes } from './notes';

// The element table differs per surface; views check the surface before using Svg, Raster or Input.
export type El = Elements['terminal'] & Elements['desktop'];

/** Your answer about the one course request: this once, always, not now; or the pane's switch off and on. */
export type Consent = 'once' | 'always' | 'no' | 'off' | 'on';

/** What a press can do. The hooks module implements each with the engine. */
export type Act = {
  ui: (fn: (u: UiState) => UiState) => void;
  /** Changes a course's progress (and saves it), then the view. */
  progress: (course: string, fn: (p: Progress) => Progress, ui?: (u: UiState) => UiState) => void;
  /** A missed question for the review deck, or one answered right in review (removed). */
  review: (item: ReviewItem, right: boolean) => void;
  saveTodo: (text: string) => void;
  removeTodo: (i: number) => void;
  share: (course: string) => void;
  /** Saves the course as a web page and opens it in your browser. */
  browser: (course: string) => void;
  open: () => void;
  prepare: () => void;
  consent: (c: Consent) => void;
};

/** The key of the header button every terminal screen draws; presses park the focus ring on it. */
export const ANCHOR = 'halftime-header';

export type PaneData = {
  L: Lessons | null; u: UiState; lim: Limit | null; saved: string[]; now: number; preparing: boolean; always: boolean;
  library: CourseRecord[]; current: string; review: ReviewItem[];
  /** Courses opened in the browser in this session. */
  browser: string[];
  /** The model that writes the course, as people know it ("Claude Haiku"). */
  model: string;
};

export type Ctx = PaneData & {
  act: Act; surface: string; el: El; width: number;
  /** The course on screen (this session's, or one opened from the library). */
  rec: CourseRecord | undefined;
  notes: Notes | null;
};

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function clockTime(ms: number): string {
  const d = new Date(ms);
  const hr = d.getHours(), m = d.getMinutes();
  return `${((hr + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${hr < 12 ? 'AM' : 'PM'}`;
}
export function waitText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
  return `${Math.round(min / 1440)} days`;
}

/** A unified-diff source the Code element draws with colors. */
export function diffSource(f: FileChange): string {
  const oldN = f.diff.filter(d => d.op !== '+').length, newN = f.diff.filter(d => d.op !== '-').length;
  return `@@ -1,${oldN} +1,${newN} @@\n` + f.diff.map(d => d.op + d.text).join('\n');
}

export const setUi = (c: Ctx, fn: (u: UiState) => UiState) => () => c.act.ui(fn);
export const home = (c: Ctx) => setUi(c, u => ({ ...u, view: 'home' }));

/** A plain button. Hotkeys only matter in the terminal; elsewhere people click. */
export function btn(c: Ctx, key: string, label: string, onPress: () => void, hotkey?: string) {
  const { Button, Text } = c.el;
  return <Button key={key} plain hotkey={hotkey} onPress={onPress}><Text color="text">{label}</Text></Button>;
}

/** The one main action of a screen: drawn as a primary button where buttons look like buttons. */
export function cta(c: Ctx, key: string, label: string, onPress: () => void, hotkey?: string) {
  const { Button, Text } = c.el;
  if (c.surface === 'terminal') return <Button key={key} plain hotkey={hotkey} onPress={onPress}><Text color="claude">{label}</Text></Button>;
  return <Button key={key} label={label} variant="primary" onPress={onPress} />;
}

/** A menu row: a name and a note. One button in the terminal (wraps as one line), a short button and a note elsewhere. */
export function row(c: Ctx, key: string, hot: string | undefined, name: string, note: string, onPress: () => void) {
  const { Box, Text, Button } = c.el;
  if (c.surface === 'terminal') return <Button key={key} plain hotkey={hot} onPress={onPress}><Text color="text">{name}</Text><Text color="inactive">{`  ${note}`}</Text></Button>;
  return <Box key={key} flexDirection="column">{btn(c, key, name, onPress, hot)}<Text color="inactive">{note}</Text></Box>;
}

export function nav(c: Ctx, items: Array<RenderChildren | null | false>) {
  const { Box } = c.el;
  return <Box flexDirection="row" flexWrap="wrap" columnGap={3}>{items.filter(Boolean) as RenderChildren[]}</Box>;
}

/** A titled block: the title in gray on its own line, the text under it. No markers, no weight, no box. */
export function section(c: Ctx, title: string, body: RenderChildren, color = 'inactive') {
  const { Box, Text } = c.el;
  return <Box flexDirection="column"><Text color={color}>{title}</Text>{body}</Box>;
}

/** A label and its text on one line: "Why  the reason". */
export function field(c: Ctx, name: string, text: string, color = 'inactive') {
  const { Text } = c.el;
  return <Text color="text"><Text color={color}>{name}  </Text>{text}</Text>;
}

/** Saves a prompt for when Claude is back. `hotkey` only where the page has one such button. */
export function todoButton(c: Ctx, text: string | undefined, key: string, hotkey: string | undefined = 'a') {
  if (!text) return null;
  const { Text, Button } = c.el;
  // Still a button once saved: pressing its key again does nothing, instead of leaving the pane.
  if (c.saved.includes(text)) return <Button key={key} plain hotkey={hotkey} onPress={() => undefined}><Text color="success">✓ Saved for when Claude is back</Text></Button>;
  return btn(c, key, '+ Save this as a prompt for when Claude is back', () => c.act.saveTodo(text), hotkey);
}

