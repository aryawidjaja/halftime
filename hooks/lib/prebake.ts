// The one optional model request: reading its reply, mixing answer positions, and
// when to make it. Pure.

/**
 * Pulls the first JSON object out of a reply, tolerating fences or stray text
 * (even text with braces). Scans for the `}` that balances each `{`, skipping
 * strings; tries at most a few starts, so it stays linear.
 */
export function parseReply(text: string): unknown {
  let from = text.indexOf('{');
  for (let tries = 0; from >= 0 && tries < 8; tries++, from = text.indexOf('{', from + 1)) {
    let depth = 0, inStr = false, end = -1;
    for (let i = from; i < text.length && end < 0; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) end = i;
    }
    if (end >= 0) try { return JSON.parse(text.slice(from, end + 1)); } catch { /* try the next { */ }
  }
  return undefined;
}

/**
 * Turns the options so the right one sits at a position set by the question's text:
 * stable across redraws, and not wherever the model happened to put it (usually first).
 */
export function mix(options: readonly string[], right: number, seed: string): { options: string[]; right: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const turn = h % options.length, out = [...options.slice(turn), ...options.slice(0, turn)];
  return { options: out, right: (right - turn + options.length) % options.length };
}

/**
 * Whether to spend the one call now. Only right after a turn (the cache is
 * warm), only near the limit, once per limit window, and only when the
 * session built enough to teach.
 */
export function shouldPrebake(o: { enabled: boolean; percentUsed: number; threshold: number; windowKey: string; doneFor?: string; turns: number; inFlight: boolean }): boolean {
  return o.enabled && !o.inFlight && o.percentUsed >= o.threshold && o.percentUsed < 100 && o.doneFor !== o.windowKey && o.turns >= 3;
}
