// The app map: the code files Claude touched, linked by their local imports,
// laid out once with a small force simulation. Pure; the caller reads files.

import type { Change, Graph, GraphNode } from '../../types';
import { isOutside } from './extract';

const CODE = /\.(m?[jt]sx?|cjs|py|go|rb|rs|java|kt|swift|php|cs|vue|svelte)$/;
export const MAX_NODES = 18;

/** Relative import specifiers in a source file (JS/TS, Python, Go-style quotes ignored). */
export function importsOf(file: string, content: string): string[] {
  const out: string[] = [];
  if (/\.py$/.test(file)) {
    for (const m of content.matchAll(/^\s*from\s+(\.+[\w.]*)\s+import\s+(\([^)]*\)|[^\n]*)/gm)) {
      const spec = m[1]!;
      out.push(spec);
      // `from . import views` imports the module views (after the package itself).
      if (/^\.+$/.test(spec)) for (const n of (m[2] ?? '').replace(/[()]/g, '').split(',')) { const w = n.trim().match(/^\w+/)?.[0]; if (w) out.push(spec + w); }
    }
    return out;
  }
  const rel = `(\\.{1,2}(?:\\/[^'"]*)?)`; // './x', '../x', '.' or '..'
  const re = new RegExp(`(?:import|export)\\s[^'"]*?from\\s*['"]${rel}['"]|import\\s*\\(\\s*['"]${rel}['"]\\s*\\)|require\\(\\s*['"]${rel}['"]\\s*\\)|^\\s*import\\s+['"]${rel}['"]`, 'gm');
  for (const m of content.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3] ?? m[4])!);
  return out;
}

const dirOf = (f: string) => f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
const stem = (f: string) => f.replace(/\.(m?[jt]sx?|cjs|py|vue|svelte)$/, '').replace(/\/index$/, '').replace(/\/__init__$/, '');

function join(dir: string, spec: string): string {
  const parts = (dir ? dir.split('/') : []);
  for (const p of spec.split('/')) { if (p === '..') parts.pop(); else if (p !== '.' && p) parts.push(p); }
  return parts.join('/');
}

/** Resolves a relative specifier from `from` to one of `files`, or undefined. */
export function resolveImport(from: string, spec: string, files: string[]): string | undefined {
  let target: string;
  if (/\.py$/.test(from) && /^\.+/.test(spec)) {
    const dots = spec.match(/^\.+/)![0].length, rest = spec.slice(dots).replace(/\./g, '/');
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    target = rest ? join(dir, rest) : dir;
  } else target = join(dirOf(from), spec.replace(/\.(js|mjs|cjs)$/, ''));
  return files.find(f => stem(f) === stem(target) || stem(f) === target);
}

/** Short unique labels: the file name, with as many parent folders as it takes to tell files apart. */
export function labelsOf(files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let left = files;
  for (let d = 1; left.length; d++) {
    const tail = (f: string) => f.split('/').slice(-d).join('/');
    const count = new Map<string, number>();
    left.forEach(f => count.set(tail(f), (count.get(tail(f)) ?? 0) + 1));
    left = left.filter(f => {
      if (count.get(tail(f))! > 1 && d < f.split('/').length) return true;
      out[f] = tail(f);
      return false;
    });
  }
  return out;
}

/** Builds the map from the session's changes; `read` returns a file's text or undefined. */
export async function graphOf(changes: Change[], read: (file: string) => Promise<string | undefined>): Promise<Graph> {
  const added = new Map<string, number>();
  for (const c of changes) for (const f of c.files) if (CODE.test(f.file) && !isOutside(f.file)) added.set(f.file, (added.get(f.file) ?? 0) + f.added);
  const files = [...added.keys()].sort((a, b) => added.get(b)! - added.get(a)!).slice(0, MAX_NODES);
  const edges: Array<[string, string]> = [];
  const texts = await Promise.all(files.map(f => read(f).catch(() => undefined)));
  files.forEach((f, i) => {
    const text = texts[i];
    if (!text) return;
    for (const spec of importsOf(f, text.slice(0, 200_000))) {
      const to = resolveImport(f, spec, files);
      if (to && to !== f && !edges.some(([a, b]) => a === f && b === to)) edges.push([f, to]);
    }
  });
  const labels = labelsOf(files);
  const nodes: GraphNode[] = files.map(f => ({ id: f, label: labels[f] ?? f, added: added.get(f)!, x: 0, y: 0 }));
  layout(nodes, edges);
  return { nodes, edges };
}

/**
 * Places nodes in the unit square: springs along edges, repulsion between all
 * pairs, a pull to the center. Deterministic (seeded on a circle), O(n² · steps)
 * with n ≤ 18, so well under a millisecond.
 */
export function layout(nodes: GraphNode[], edges: Array<[string, string]>, steps = 220): void {
  const n = nodes.length;
  if (!n) return;
  const p = nodes.map((v, i) => ({ id: v.id, x: 0.5 + 0.35 * Math.cos((2 * Math.PI * i) / n), y: 0.5 + 0.35 * Math.sin((2 * Math.PI * i) / n), fx: 0, fy: 0 }));
  const at = new Map(p.map(q => [q.id, q]));
  const k = 0.9 / Math.sqrt(n + 1);
  for (let s = 0; s < steps; s++) {
    const t = 0.08 * (1 - s / steps) + 0.004;
    for (const a of p) a.fx = a.fy = 0;
    p.forEach((a, i) => {
      for (let j = i + 1; j < n; j++) {
        const b = p[j]!, dx = a.x - b.x, dy = a.y - b.y;
        const f = (k * k) / Math.max(dx * dx + dy * dy, 1e-4);
        a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
      }
    });
    for (const [ia, ib] of edges) {
      const a = at.get(ia), b = at.get(ib);
      if (!a || !b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-3, f = (d * d) / k;
      a.fx -= (dx / d) * f; a.fy -= (dy / d) * f; b.fx += (dx / d) * f; b.fy += (dy / d) * f;
    }
    for (const a of p) {
      a.fx += (0.5 - a.x) * 0.6; a.fy += (0.5 - a.y) * 0.6;
      const d = Math.sqrt(a.fx * a.fx + a.fy * a.fy) || 1;
      a.x = Math.min(0.95, Math.max(0.05, a.x + (a.fx / d) * Math.min(d, t)));
      a.y = Math.min(0.95, Math.max(0.05, a.y + (a.fy / d) * Math.min(d, t)));
    }
  }
  // Stretch to fill the box, so the map uses its space.
  const xs = p.map(q => q.x), ys = p.map(q => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  nodes.forEach((v, i) => {
    const q = p[i]!;
    v.x = n === 1 ? 0.5 : 0.06 + 0.88 * ((q.x - x0) / (x1 - x0 || 1));
    v.y = n === 1 ? 0.5 : 0.1 + 0.8 * ((q.y - y0) / (y1 - y0 || 1));
  });
}

/** Files that import `id`, directly (ring 1) and through one more file (ring 2). */
export function dependentsOf(g: Graph, id: string): { direct: string[]; indirect: string[] } {
  const users = (t: string) => g.edges.filter(([, b]) => b === t).map(([a]) => a);
  const direct = users(id);
  const indirect = [...new Set(direct.flatMap(users))].filter(f => f !== id && !direct.includes(f));
  return { direct, indirect };
}
