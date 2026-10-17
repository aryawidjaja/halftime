import { test, expect } from 'claude-code/testing';
import { CARD, encodeCells, mapRaster, mapSvg, mapText, PALETTE } from '../hooks/lib/draw';
import type { Graph } from '../types';

/** Decodes Raster cells back to [codePoint, fg, bg] triplets. */
function decode(b64: string): Array<[number, number, number]> {
  const bin = atob(b64), dv = new DataView(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer), out: Array<[number, number, number]> = [];
  for (let i = 0; i < bin.length; i += 12) out.push([dv.getUint32(i, true), dv.getUint32(i + 4, true), dv.getUint32(i + 8, true)]);
  return out;
}
const two: Graph = {
  nodes: [{ id: 'a.ts', label: 'a.ts', added: 10, x: 0, y: 0 }, { id: 'b.ts', label: 'b.ts', added: 40, x: 1, y: 1 }],
  edges: [['a.ts', 'b.ts']],
};
const big: Graph = {
  nodes: Array.from({ length: 18 }, (_, i) => ({ id: `src/feature${i}/component${i}.tsx`, label: `component${i}.tsx`, added: 10 * i, x: (i % 6) / 5, y: Math.floor(i / 6) / 2 })),
  edges: Array.from({ length: 30 }, (_, i) => [`src/feature${i % 18}/component${i % 18}.tsx`, `src/feature${(i * 7 + 1) % 18}/component${(i * 7 + 1) % 18}.tsx`] as [string, string]),
};

test('encodeCells writes little-endian u32 triplets', () => {
  const s = encodeCells([[0x41, 0x00d97757, 0x01000000], [0x25cf, 1, 2]]);
  const bin = atob(s);
  expect(bin.length).toBe(24);
  expect([...bin.slice(0, 12)].map(c => c.charCodeAt(0))).toEqual([0x41, 0, 0, 0, 0x57, 0x77, 0xd9, 0, 0, 0, 0, 1]);
  expect(decode(s)).toEqual([[0x41, 0xd97757, 0x01000000], [0x25cf, 1, 2]]);
});

test('raster has columns*rows*12 bytes and its own card background everywhere', () => {
  for (const [c, r] of [[40, 12], [10, 4], [512, 256]] as const) {
    const out = mapRaster(two, {}, c, r);
    expect(atob(out.cells).length).toBe(c * r * 12);
    expect(decode(out.cells).every(([, , bg]) => bg === CARD.bg)).toBe(true);
  }
});

test('raster places glyphs and labels for a 2-node graph', () => {
  const C = 30, R = 8, cells = decode(mapRaster(two, { lit: ['a.ts'] }, C, R).cells);
  const at = (x: number, y: number) => cells[y * C + x]!;
  expect(at(1, 1)).toEqual([0x25cf, PALETTE.accent, CARD.bg]); // lit a at the top-left margin
  expect(at(C - 2, R - 2)).toEqual([0x25cf, CARD.node, CARD.bg]); // unread b: a solid light dot, so the map reads before you start
  expect(String.fromCharCode(...[3, 4, 5, 6].map(x => at(x, 1)[0]!))).toBe('a.ts'); // right of a
  expect(String.fromCharCode(...[C - 7, C - 6, C - 5, C - 4].map(x => at(x, R - 2)[0]!))).toBe('b.ts'); // left of b (would overflow)
  expect(cells.some(([c, f]) => c === 0xb7 && f === CARD.edge)).toBe(true); // edge dots
  expect(cells.every(([c]) => c >= 0x20 && c < 0x10000 && c !== 0x7f)).toBe(true);
});

test('raster handles empty, single, tiny and wide-char inputs', () => {
  expect(atob(mapRaster({ nodes: [], edges: [] }, {}, 10, 4).cells).length).toBe(480);
  const one = decode(mapRaster({ nodes: [{ id: 'x', label: '日本&<emoji😀-very-long-name.ts', added: 1, x: 0.5, y: 0.5 }], edges: [] }, { focus: ['x'] }, 10, 4).cells);
  expect(one).toHaveLength(40);
  expect(one.filter(([c]) => c === 0x25cf)).toHaveLength(1);
  expect(one.every(([c]) => c === 0x25cf || (c >= 0x20 && c < 0x7f))).toBe(true);
  expect(one.some(([c]) => c === 0x7e)).toBe(false); // a label that does not fit is left out, never cut
  const r = decode(mapRaster(big, { ripple: { center: big.nodes[0]!.id, direct: [big.nodes[1]!.id], indirect: [] } }, 12, 4).cells);
  expect(r).toHaveLength(48);
});

test('svg is well-formed-ish, escaped, theme-free', () => {
  const g: Graph = { nodes: [{ id: 'a', label: 'a&b<c>.ts', added: 5, x: 0, y: 1 }, { id: 'b', label: 'b.ts', added: 0, x: 1, y: 0 }], edges: [['a', 'b']] };
  const s = mapSvg(g, { lit: ['a', 'b'] });
  expect(s.startsWith('<svg')).toBe(true);
  expect(s.endsWith('</svg>')).toBe(true);
  expect(s).toMatch(/viewBox="0 0 560 260"/);
  expect(s).toContain('<title>');
  expect(s).toContain('a&#38;b&#60;c&#62;.ts');
  expect(s).not.toContain('a&b');
  expect(s).not.toContain('var(');
  expect(s).toContain('stroke="#d97757" stroke-opacity=".5"'); // lit-lit edge
  expect(s).toContain('text-anchor="start"'); // left-edge label
  expect(s).toContain('text-anchor="end"'); // right-edge label
  expect(mapSvg({ nodes: [], edges: [] }, {})).toMatch(/^<svg.*<\/svg>$/);
});

test('svg for 18 nodes stays small', () => {
  for (const h of [{}, { focus: [big.nodes[3]!.id] }, { ripple: { center: big.nodes[0]!.id, direct: [big.nodes[1]!.id], indirect: [big.nodes[2]!.id] } }])
    expect(mapSvg(big, h).length).toBeLessThan(20_000);
});


test('raster labels never overlap: a label that does not fit whole is left out', () => {
  const crowd: Graph = { nodes: ['alpha.ts', 'beta.ts', 'gamma.ts', 'delta.ts'].map((l, i) => ({ id: l, label: l, added: 10 - i, x: 0.4 + i * 0.05, y: 0.5 })), edges: [] };
  const C = 40, R = 6, cells = decode(mapRaster(crowd, {}, C, R).cells);
  const row = cells.slice(Math.round(0.5 * (R - 3)) * C + C, Math.round(0.5 * (R - 3)) * C + 2 * C).map(([c]) => String.fromCharCode(c)).join('');
  const shown = ['alpha.ts', 'beta.ts', 'gamma.ts', 'delta.ts'].filter(l => cells.map(([c]) => String.fromCharCode(c)).join('').includes(l));
  expect(shown).toContain('alpha.ts'); // the biggest file keeps its label
  expect(row.includes('~')).toBe(false);
});

test('the text map draws the same dots and labels, trimmed', () => {
  const t = mapText(two, {}, 30, 8).split('\n');
  expect(t[0]).toBe(' ● a.ts');
  expect(t[t.length - 1]!).toMatch(/b\.ts.?●$/);
  expect(t.every(l => l === l.trimEnd())).toBe(true);
});
