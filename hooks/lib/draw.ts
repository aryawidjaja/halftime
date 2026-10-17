// Drawing the app map and request flows: SVG strings for the GUI surfaces,
// Raster cells for the terminal. Pure; theme unknown, so mid-tone colours only.

import type { Graph } from '../../types';

export type Highlight = {
  lit?: readonly string[];
  focus?: readonly string[];
  ripple?: { center: string; direct: readonly string[]; indirect: readonly string[] };
};

/** 0x00RRGGBB mid-tones that read on light and dark backgrounds; text = terminal default. */
export const PALETTE = { accent: 0xd97757, dim: 0x8a8a8a, text: 0x01000000, warn: 0xd99a2b, ok: 0x4caf6a, err: 0xd9534f };
/**
 * The terminal map is drawn on its own dark card. A plugin cannot read the theme, and
 * the pane's background follows Claude Code's theme while the terminal's default
 * colors follow the terminal's, so the two can disagree (dark theme in a light
 * terminal). A card with its own colors reads the same everywhere.
 */
export const CARD = { bg: 0x1f1e1d, label: 0xe4e0d8, edge: 0x8c8780, node: 0xc4bfb5, faint: 0x6e6a64 };
const hex = (c: number) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const r1 = (v: number) => Math.round(v * 10) / 10;
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"`;

type Role = 'hot' | 'lit' | 'direct' | 'indirect' | 'plain' | 'dim';

/** One role per node: ripple wins over focus, focus over lit. */
function roleOf(h: Highlight): (id: string) => Role {
  const { ripple, focus, lit = [] } = h;
  if (ripple) return id => id === ripple.center ? 'hot' : ripple.direct.includes(id) ? 'direct' : ripple.indirect.includes(id) ? 'indirect' : 'dim';
  if (focus?.length) return id => focus.includes(id) ? 'hot' : 'dim';
  return id => lit.includes(id) ? 'lit' : 'plain';
}

/** Raster `cells`: little-endian u32 triplets [codePoint, fg, bg], base64. */
export function encodeCells(cells: ReadonlyArray<readonly [number, number, number]>): string {
  const bytes = new Uint8Array(cells.length * 12), dv = new DataView(bytes.buffer);
  cells.forEach(([c, f, b], i) => { dv.setUint32(i * 12, c, true); dv.setUint32(i * 12 + 4, f, true); dv.setUint32(i * 12 + 8, b, true); });
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The app map as an SVG string (default 560x260). Node radius 5-12 by sqrt(lines added). */
export function mapSvg(g: Graph, h: Highlight, size = { width: 560, height: 260 }): string {
  const { width: W, height: H } = size, role = roleOf(h);
  const X = (x: number) => r1(14 + x * (W - 28)), Y = (y: number) => r1(10 + y * (H - 34));
  const max = Math.max(1, ...g.nodes.map(n => n.added));
  const rad = (a: number) => r1(5 + 7 * Math.sqrt(Math.max(0, a) / max));
  const at = new Map(g.nodes.map(n => [n.id, n]));
  const on = (id: string) => { const r = role(id); return r === 'hot' || r === 'lit' || r === 'direct'; };
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT} font-size="10"><title>App map: ${g.nodes.length} file${g.nodes.length === 1 ? '' : 's'}</title>`;
  for (const [a, b] of g.edges) {
    const p = at.get(a), q = at.get(b);
    if (!p || !q) continue;
    const c = on(a) && on(b) ? `${hex(PALETTE.accent)}" stroke-opacity=".5` : `${hex(PALETTE.dim)}" stroke-opacity=".35`;
    out += `<line x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(q.x)}" y2="${Y(q.y)}" stroke="${c}" stroke-width="1"/>`;
  }
  for (const n of g.nodes) {
    const x = X(n.x), y = Y(n.y), r = rad(n.added), ro = role(n.id);
    const col = hex(ro === 'hot' || ro === 'lit' ? PALETTE.accent : ro === 'direct' || ro === 'indirect' ? PALETTE.warn : PALETTE.dim);
    const op = ro === 'dim' ? ' opacity=".3"' : ro === 'indirect' ? ' opacity=".55"' : '';
    if (ro === 'hot') out += `<circle cx="${x}" cy="${y}" r="${r + 4}" fill="none" stroke="${col}" stroke-opacity=".35" stroke-width="3"/>`;
    if (ro === 'direct') out += `<circle cx="${x}" cy="${y}" r="${r + 3}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"${op}/>`;
    // Label below (above if it would fall off the bottom), anchored so it stays inside the box.
    const label = cut(n.label, Math.floor((W - 4) / 6)), w = label.length * 6;
    let lx = x, anchor = 'middle';
    if (x - w / 2 < 4) { anchor = 'start'; lx = Math.max(2, r1(x - r)); }
    else if (x + w / 2 > W - 4) { anchor = 'end'; lx = Math.min(W - 2, r1(x + r)); }
    const ly = y + r + 11 > H - 2 ? r1(y - r - 4) : r1(y + r + 11);
    const lc = ro === 'plain' || ro === 'dim' ? hex(PALETTE.dim) : col, bold = ro === 'hot' || ro === 'lit' ? ' font-weight="600"' : '';
    out += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${lc}"${bold}${ro === 'dim' ? ' opacity=".45"' : ''}>${esc(label)}</text>`;
  }
  return out + '</svg>';
}

/** Width-1 printable glyphs only: anything outside printable ASCII becomes '?'. */
const glyphs = (s: string) => [...s].map(c => { const p = c.codePointAt(0)!; return p >= 0x20 && p < 0x7f ? p : 0x3f; });

/** The app map as Raster cells: edges as dotted lines, nodes as ●/○, labels beside nodes. */
/** A text grid holds fewer files legibly than a picture: the biggest ones, plus any the lesson points at. */
export const MAX_RASTER_NODES = 12;

type Grid = { columns: number; rows: number; grid: Array<[number, number, number]> };

function mapGrid(full: Graph, h: Highlight, columns: number, rows: number): Grid {
  const C = Math.min(512, Math.max(1, columns | 0)), R = Math.min(256, Math.max(1, rows | 0)), role = roleOf(h);
  const marked = new Set([...(h.lit ?? []), ...(h.focus ?? []), ...(h.ripple ? [h.ripple.center, ...h.ripple.direct, ...h.ripple.indirect] : [])]);
  const keep = new Set([...[...full.nodes].sort((a, b) => b.added - a.added).slice(0, MAX_RASTER_NODES).map(n => n.id), ...(marked.size <= MAX_RASTER_NODES ? full.nodes.filter(n => marked.has(n.id) && (h.focus?.includes(n.id) || h.ripple)).map(n => n.id) : [])]);
  const g: Graph = { nodes: full.nodes.filter(n => keep.has(n.id)), edges: full.edges.filter(([a, b]) => keep.has(a) && keep.has(b)) };
  const grid: Array<[number, number, number]> = Array.from({ length: C * R }, () => [0x20, CARD.label, CARD.bg]);
  const put = (x: number, y: number, ch: number, fg: number) => { if (x >= 0 && y >= 0 && x < C && y < R) grid[y * C + x] = [ch, fg, CARD.bg]; };
  // 1-cell margin: x,y in [0,1] land on columns 1..C-2 and rows 1..R-2.
  const cell = new Map(g.nodes.map(n => [n.id, [1 + Math.round(n.x * Math.max(0, C - 3)), 1 + Math.round(n.y * Math.max(0, R - 3))] as const]));
  const taken = new Set([...cell.values()].map(([x, y]) => y * C + x));
  for (const [a, b] of g.edges) {
    const p = cell.get(a), q = cell.get(b);
    if (!p || !q) continue;
    // Bresenham, endpoints left for the nodes.
    let [x, y] = p; const [x1, y1] = q, dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1;
    let err = dx + dy, step = 0;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      // Every other cell: a light dotted line that does not crowd the labels.
      if (step++ % 2 && !taken.has(y * C + x)) put(x, y, 0xb7, CARD.edge);
    }
  }
  const look = (ro: Role): [number, number, number] => // [glyph, node fg, label fg]
    ro === 'hot' || ro === 'lit' ? [0x25cf, PALETTE.accent, PALETTE.accent] : ro === 'direct' ? [0x25cf, PALETTE.warn, PALETTE.warn]
      : ro === 'indirect' ? [0x25cb, PALETTE.warn, PALETTE.warn] : ro === 'dim' ? [0x25cb, CARD.faint, CARD.faint] : [0x25cf, CARD.node, CARD.label];
  for (const n of g.nodes) { const [x, y] = cell.get(n.id)!, [ch, fg] = look(role(n.id)); put(x, y, ch, fg); }
  // Labels go to the right of a node, else to its left, and only whole: a label that
  // would touch another node or label is left out rather than cut. Bigger files first.
  const labelled = new Set<number>(), free = (i: number) => !taken.has(i) && !labelled.has(i);
  for (const n of [...g.nodes].sort((a, b) => b.added - a.added)) {
    const [x, y] = cell.get(n.id)!, [, , fg] = look(role(n.id)), text = glyphs(n.label);
    const fits = (x0: number) => x0 >= 0 && x0 + text.length <= C && text.every((_, i) => free(y * C + x0 + i)) && free(y * C + x0 - 1) && free(y * C + x0 + text.length);
    const x0 = fits(x + 2) ? x + 2 : fits(x - 1 - text.length) ? x - 1 - text.length : -1;
    if (x0 < 0) continue;
    text.forEach((ch, i) => { put(x0 + i, y, ch, fg); labelled.add(y * C + x0 + i); });
  }
  return { columns: C, rows: R, grid };
}

export function mapRaster(full: Graph, h: Highlight, columns: number, rows: number): { columns: number; rows: number; cells: string } {
  const { columns: C, rows: R, grid } = mapGrid(full, h, columns, rows);
  return { columns: C, rows: R, cells: encodeCells(grid) };
}

/** The same map as plain text, for a surface whose pictures may not draw. Trailing blanks trimmed. */
export function mapText(full: Graph, h: Highlight, columns: number, rows: number): string {
  const { columns: C, grid } = mapGrid(full, h, columns, rows);
  const lines: string[] = [];
  for (let i = 0; i < grid.length; i += C) lines.push(String.fromCodePoint(...grid.slice(i, i + C).map(([c]) => c)).trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n');
}
