// Session notes: the free view, read straight from the session with no model request.
// Pure: the hooks module passes state in through Ctx.

import type { UiState } from '../types';
import { litOf, type Step } from './notes';
import { mapRaster, mapSvg, mapText, MAX_RASTER_NODES, type Highlight } from './lib/draw';
import { base, btn, clockTime, diffSource, home, nav, plural, row, section, setUi, todoButton, type Ctx } from './ui';

function stepAt(c: Ctx, ch: number, st: number): Step | undefined { return c.notes?.chapters[ch]?.steps[st]; }

/** Moves to a notes step and records it as read. */
const goStep = (c: Ctx, ch: number, st: number) => setUi(c, (u: UiState) => {
  const key = stepAt(c, ch, st)?.key;
  return { ...u, view: 'chapter', chapter: ch, step: st, read: key && !u.read.includes(key) ? [...u.read, key] : u.read };
});

/** The notes menu: each chapter, then replay and saved prompts. */
export function vNotes(c: Ctx) {
  const { Box, Text } = c.el;
  const n = c.notes!, L = c.L!, lit = litOf(n, c.u.read);
  return [
    <Text color="text">Session notes</Text>,
    <Text color="inactive">The facts, read straight from the session. No request to Claude.</Text>,
    map(c, { lit }),
    L.graph.edges.length ? <Text color="inactive">Your files, mapped{c.surface === 'terminal' && L.graph.nodes.length > MAX_RASTER_NODES ? ` (the ${MAX_RASTER_NODES} biggest of ${L.graph.nodes.length})` : ''}. Each lights up once you have read about it.</Text> : null,
    <Box flexDirection="column">
      {n.chapters.length ? n.chapters.map((ch, i) => row(c, `ch${i}`, String(i + 1), `${ch.steps.every(s => c.u.read.includes(s.key)) ? '✓ ' : ''}${ch.title}`, ch.note, goStep(c, i, 0)))
        : <Text color="inactive">Nothing to note yet: no requests, changes or helper reports in this session.</Text>}
      {L.changes.length ? row(c, 'replay', 'r', 'Replay the session', `${plural(L.changes.length, 'change')}, in order`, setUi(c, u => ({ ...u, view: 'replay' }))) : null}
      {row(c, 'prompts', 'p', 'Prompts for when Claude is back', c.saved.length ? `${c.saved.length} saved` : 'none yet', setUi(c, u => ({ ...u, view: 'prompts' })))}
    </Box>,
    nav(c, [btn(c, 'menu', '← Back', home(c), 'm')]),
  ];
}

export function map(c: Ctx, hl: Highlight) {
  // Files that do not use each other are dots with names: nothing to learn from the shape.
  if (c.L!.graph.nodes.length < 2 || !c.L!.graph.edges.length) return null;
  const { Code, Raster, Svg } = c.el;
  if (c.surface === 'terminal') {
    const cols = Math.max(20, Math.min(c.width, 96)), rows = Math.max(6, Math.min(14, Math.round(cols / 5)));
    const r = mapRaster(c.L!.graph, hl, cols, rows);
    return <Raster key="map" columns={r.columns} rows={r.rows} cells={r.cells} />;
  }
  // The VS Code extension can refuse pictures and show only the alt text, so it gets the text map.
  if (c.surface === 'vscode') return <Code key="map" source={mapText(c.L!.graph, hl, 72, 14)} language="text" />;
  return <Svg source={mapSvg(c.L!.graph, hl)} alt="Map of the files Claude changed and how they use each other" />;
}

function crumb(c: Ctx) {
  const { Text } = c.el;
  const ch = c.notes!.chapters[c.u.chapter]!;
  return <Text color="inactive">Chapter {c.u.chapter + 1} of {c.notes!.chapters.length} · {ch.title}   <Text color="claude">{ch.steps.map((_, i) => (i === c.u.step ? '●' : '○')).join(' ')}</Text></Text>;
}

function stepNav(c: Ctx) {
  const chs = c.notes!.chapters, ch = chs[c.u.chapter]!, last = c.u.step === ch.steps.length - 1;
  const toNotes = setUi(c, u => ({ ...u, view: 'notes' }));
  const next = last ? (c.u.chapter < chs.length - 1 ? goStep(c, c.u.chapter + 1, 0) : toNotes) : goStep(c, c.u.chapter, c.u.step + 1);
  const back = c.u.step > 0 ? goStep(c, c.u.chapter, c.u.step - 1) : toNotes;
  const done = last && c.u.chapter === chs.length - 1;
  // Done on the last page leads to the menu, so no Menu button beside it; no Back on the first page.
  return nav(c, [
    c.u.step > 0 ? btn(c, 'back', '← Back', back, 'b') : null,
    btn(c, 'next', done ? 'Done' : last ? 'Next chapter →' : 'Next page →', next, 'n'),
    done ? null : btn(c, 'menu', 'Notes', toNotes, 'm'),
  ]);
}

export function vStep(c: Ctx) {
  const s = stepAt(c, c.u.chapter, c.u.step);
  if (!s) return vNotes(c);
  const body = s.kind === 'bug' ? vBug(c, s) : s.kind === 'approvals' ? vApprovals(c, s) : s.kind === 'files' ? vFiles(c, s) : s.kind === 'depends' ? vDepends(c, s) : vList(c, s);
  return [crumb(c), ...body, stepNav(c)];
}

function vBug(c: Ctx, s: Extract<Step, { kind: 'bug' }>) {
  const { Text, Code, Box } = c.el;
  const b = s.bug, open = c.u.showCode.includes(s.key);
  return [
    <Text color="text">{b.title}</Text>,
    <Text color="success">✓ Fixed by Claude{b.verified ? `, and ${b.verified} passed afterwards` : ''}</Text>,
    map(c, { focus: s.focus }),
    section(c, 'What happened', [<Text color="text">Claude ran <Text color="text">{b.failed}</Text> and it failed:</Text>, ...b.error.map(l => <Text color="inactive">  {l}</Text>)]),
    section(c, 'Why', <Text color="text">{b.why ?? 'Claude did not explain this one in words. The change below is what fixed it.'}</Text>),
    section(c, 'What Claude changed', [
      <Text color="text">{b.fix.map(f => `${f.file} (+${f.added} −${f.removed})`).join(', ')}</Text>,
      btn(c, 'code', open ? 'Hide the code' : 'Show the code', setUi(c, u => ({ ...u, showCode: open ? u.showCode.filter(k => k !== s.key) : [...u.showCode, s.key] })), 'c'),
      open ? <Box flexDirection="column">{b.fix.slice(0, 3).map(f => <Code source={diffSource(f)} format="diff" path={f.file} />)}</Box> : null,
    ]),
    section(c, 'Still open', [<Text color="text">If a later change brings this back, only a test will notice.</Text>, todoButton(c, `Add a test that would catch “${b.title}” if it comes back`, 'todo')], 'warning'),
  ];
}

const PKG_NOTE = 'Packages are code written by other people, and they run on your computer.';

function vApprovals(c: Ctx, s: Extract<Step, { kind: 'approvals' }>) {
  const { Text, Box } = c.el;
  const mark = { high: ['▲', 'error'], med: ['●', 'warning'], low: ['·', 'subtle'] } as const;
  const n = (r: string) => s.items.filter(a => a.risk === r).length;
  // Routine packages share one entry instead of repeating the same sentence.
  const pkgs = s.items.filter(a => a.kind === 'package' && a.risk === 'low');
  const shown = s.items.filter(a => !pkgs.includes(a));
  return [
    <Text color="text">What you said yes to in this session</Text>,
    <Text color="text">Every package, command and permission you approved. Most are routine.{n('high') ? ` The ${plural(n('high'), 'item')} marked ▲ ${n('high') === 1 ? 'needs' : 'need'} a decision from you.` : ''}</Text>,
    <Text color="inactive"><Text color="error">▲</Text> worth a look ({n('high')})   <Text color="warning">●</Text> good to know ({n('med')})   · routine ({n('low')})</Text>,
    <Box flexDirection="column">{shown.slice(0, 14).map((a, i) => (
      <Box flexDirection="column" key={`a${i}`}>
        <Text color="text"><Text color={mark[a.risk][1]}>{mark[a.risk][0]}</Text> <Text color="text">{a.what}</Text></Text>
        <Box paddingLeft={2} flexDirection="column"><Text color="inactive">{a.say}</Text>{a.todo ? todoButton(c, a.todo, `todo${i}`) : null}</Box>
      </Box>))}
      {shown.length > 14 ? <Text color="inactive">and {shown.length - 14} more routine items</Text> : null}
      {pkgs.length ? <Box flexDirection="column">
        <Text color="text"><Text color="subtle">·</Text> <Text color="text">Installed {plural(pkgs.length, 'package')}</Text></Text>
        <Box paddingLeft={2} flexDirection="column">
          {pkgs.map(a => <Text color="inactive">{a.what.replace(/^Installed /, '')}{a.say.startsWith(PKG_NOTE) ? '' : `: ${a.say.replace(` ${PKG_NOTE}`, '')}`}</Text>)}
          <Text color="inactive">{PKG_NOTE}</Text>
        </Box>
      </Box> : null}
    </Box>,
  ];
}

/** The request path as text: one line per stop, the current one explained. */

function vFiles(c: Ctx, s: Extract<Step, { kind: 'files' }>) {
  const { Text, Box } = c.el;
  const top = [...c.L!.graph.nodes].sort((a, b) => b.added - a.added).slice(0, 8);
  const max = Math.max(1, ...top.map(n => n.added));
  return [
    <Text color="text">The files Claude wrote, and how they connect</Text>,
    <Text color="text">Each dot is a file. A line means one file uses code from the other. Bigger dots are files with more new code.</Text>,
    map(c, { focus: s.focus }),
    <Box flexDirection="column">{top.map(n => <Text color="text">{n.label.padEnd(24).slice(0, 24)} <Text color="claude">{'█'.repeat(Math.max(1, Math.round((n.added / max) * 20)))}</Text> <Text color="inactive">{n.added} lines</Text></Text>)}</Box>,
  ];
}

function vDepends(c: Ctx, s: Extract<Step, { kind: 'depends' }>) {
  const { Text } = c.el;
  const name = base(s.center), n = s.direct.length + s.indirect.length;
  return [
    <Text color="text">Which files depend on which</Text>,
    <Text color="text">Files use code from each other. When you ask Claude to change one file, every file that uses it can be affected. The file most others use is <Text color="text">{name}</Text>.</Text>,
    map(c, { ripple: { center: s.center, direct: s.direct, indirect: s.indirect } }),
    section(c, 'What this means for you', [
      <Text color="text">A change to {name} reaches {plural(n, 'other file')}: {[...s.direct, ...s.indirect].map(base).join(', ')}. After Claude changes it, try the parts of your app that use those files.</Text>,
      todoButton(c, `Add tests for ${s.center} so changes to it are checked automatically`, 'todo'),
    ]),
  ];
}

function vList(c: Ctx, s: Extract<Step, { kind: 'list' }>) {
  const { Text, Box } = c.el;
  const todos = s.items.filter(it => it.todo).length;
  return [
    <Text color="text">{s.title}</Text>,
    s.lead ? <Text color="inactive">{s.lead}</Text> : null,
    map(c, { focus: s.focus }),
    <Box flexDirection="column" gap={1}>{s.items.map((it, i) => (
      <Box key={`i${i}`} flexDirection="column">
        {it.title ? <Text color={it.dim ? 'inactive' : 'text'}>{it.title}</Text> : null}
        <Box paddingLeft={it.title ? 2 : 0} flexDirection="column">
          {it.lines.map(([label, text]) => <Text color={it.dim ? 'inactive' : 'text'}>{!it.title && !label ? '· ' : ''}{label ? <Text color="inactive">{label}: </Text> : null}{text}</Text>)}
          {it.todo ? todoButton(c, it.todo, `todo${i}`, todos === 1 ? 'a' : undefined) : null}
        </Box>
      </Box>))}
    </Box>,
  ];
}

export function vReplay(c: Ctx) {
  const { Text, Code, Box } = c.el;
  const ch = c.L!.changes[Math.min(c.u.replay, c.L!.changes.length - 1)];
  if (!ch) return [<Text color="inactive">Nothing was changed in this session yet.</Text>, nav(c, [btn(c, 'menu', 'Menu', home(c), 'm')])];
  const list = c.L!.changes.slice(Math.max(0, c.u.replay - 4), c.u.replay + 5);
  return [
    <Text color="text">Replay the session</Text>,
    <Text color="text">What Claude did, in order. Each entry starts with what you asked for.</Text>,
    <Box flexDirection="column">{list.map(x => btn(c, `ch${x.index}`, `${x.index === ch.index ? '›' : ' '} ${String(x.index + 1).padStart(2)}. ${x.ask}  (+${x.added})`, setUi(c, u => ({ ...u, replay: x.index }))))}</Box>,
    ch.said ? section(c, 'Claude said', <Text color="text">{ch.said}</Text>) : null,
    <Box flexDirection="column">{ch.files.slice(0, 4).map(f => <Code source={diffSource(f)} format="diff" path={f.file} />)}</Box>,
    ch.files.length > 4 ? <Text color="inactive">and {plural(ch.files.length - 4, 'more file')}</Text> : null,
    nav(c, [
      btn(c, 'up', '↑ Earlier', setUi(c, u => ({ ...u, replay: Math.max(0, u.replay - 1) })), 'k'),
      btn(c, 'down', '↓ Later', setUi(c, u => ({ ...u, replay: Math.min(c.L!.changes.length - 1, u.replay + 1) })), 'j'),
      btn(c, 'menu', 'Menu', home(c), 'm'),
    ]),
  ];
}

export function vPrompts(c: Ctx) {
  const { Text, Input, Box } = c.el;
  const at = c.lim?.resetsAt ? ` At ${clockTime(c.lim.resetsAt)}` : ' When Claude is free';
  return [
    <Text color="text">Prompts for when Claude is back</Text>,
    <Text color="text">Things you saved while reading, plus anything you add here.{at} the first one is placed in your prompt box. Nothing is sent until you press enter.</Text>,
    c.saved.length ? <Box flexDirection="column">{c.saved.map((t, i) => <Box flexDirection="row" gap={2}><Text color="text">{String(i + 1).padStart(2)}. {t}</Text>{btn(c, `rm${i}`, 'remove', () => c.act.removeTodo(i))}</Box>)}</Box>
      : <Text color="inactive">Nothing saved yet. Look for “Save this as a prompt” at the end of each lesson.</Text>,
    Input ? <Input key="add" placeholder="Type a prompt. Enter adds it to this list; nothing is sent." onSubmit={(v: string) => { if (v.trim()) c.act.saveTodo(v.trim()); }} /> : null,
    nav(c, [btn(c, 'menu', 'Menu', home(c), 'm')]),
  ];
}
