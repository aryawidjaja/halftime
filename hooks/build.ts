// Assembles the lessons for this session from one transcript read and a few
// small file reads. Pure: the hooks module does the reading and passes it in.

import type { Lessons, Msg } from '../types';
import { approvalsOf, bugsOf, changesOf, earlierOf, helpersOf, latestOf, packagesOf, wasSummarized } from './lib/extract';
import { graphOf } from './lib/graph';
import { kindOf } from './lib/digest';

export const MAX_DESCRIBE = 12;

/** Permission rules allowed in the given settings files' text. */
export function rulesFrom(texts: ReadonlyArray<string | undefined>): string[] {
  const rules = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    try {
      const allow = (JSON.parse(t) as { permissions?: { allow?: unknown } }).permissions?.allow;
      if (Array.isArray(allow)) for (const r of allow) if (typeof r === 'string') rules.add(r);
    } catch { /* unreadable: no rules */ }
  }
  return [...rules];
}

/** Commands Claude ran, and the packages they installed (the ones worth describing). */
export function commandsOf(msgs: readonly Msg[]): { commands: string[]; packages: string[] } {
  const commands = msgs.flatMap(m => m.toolUses.filter(u => u.tool === 'Bash').map(u => String(u.input.command ?? '')));
  const packages = [...new Set(commands.flatMap(c => packagesOf(c).map(p => p.name)))].filter(n => /^(@[\w.-]+\/)?[\w.-]+$/.test(n)).slice(0, MAX_DESCRIBE);
  return { commands, packages };
}

/** Helper agents Claude started, by agent id, with their task: the ones whose work Halftime reads. */
export function agentsIn(msgs: readonly Msg[], max = 30): Array<{ id: string; task: string }> {
  const seen = new Map<string, string>();
  for (const m of msgs) for (const u of m.toolUses) if (u.agentId && (u.tool === 'Agent' || u.tool === 'Task')) seen.set(u.agentId, String(u.input.description ?? 'a task'));
  return [...seen].slice(-max).map(([id, task]) => ({ id, task }));
}

export async function assembleLessons(o: {
  msgs: readonly Msg[];
  /** Each helper agent's own transcript, by agent id. */
  agents?: ReadonlyMap<string, { task: string; msgs: readonly Msg[] }>;
  root: string;
  now: number;
  permsAtStart: readonly string[];
  rulesNow: readonly string[];
  descriptions: ReadonlyMap<string, string>;
  read: (file: string) => Promise<string | undefined>;
}): Promise<Lessons> {
  const agents: ReadonlyMap<string, { task: string; msgs: readonly Msg[] }> = o.agents ?? new Map();
  const changes = changesOf(o.msgs, o.root, agents);
  const helperMsgs = [...agents.values()].map(a => a.msgs);
  const info = (id: string) => {
    const ms = agents.get(id)?.msgs ?? [];
    return { files: new Set(ms.flatMap(m => m.toolUses.filter(u => !u.isError && (u.tool === 'Edit' || u.tool === 'Write' || u.tool === 'MultiEdit')).map(u => String(u.input.file_path ?? '')))).size, last: latestOf(ms, '', 12) };
  };
  const { commands } = commandsOf(o.msgs);
  const newPermissions = o.rulesNow.filter(r => !o.permsAtStart.includes(r));
  return {
    project: o.root,
    builtAt: o.now,
    changes: changes.slice(-40).map((c, index) => ({ ...c, index })),
    // Helpers' failed-then-passing checks teach debugging as well as the main thread's do.
    bugs: [...bugsOf(o.msgs, o.root), ...helperMsgs.flatMap(m => bugsOf(m, o.root))],
    approvals: approvalsOf(o.msgs, { root: o.root, newPermissions, describe: n => o.descriptions.get(n) }),
    graph: await graphOf(changes, o.read),
    counts: { messages: o.msgs.length + helperMsgs.reduce((n, m) => n + m.length, 0), edits: changes.reduce((n, c) => n + c.files.length, 0), commands: commands.length + helperMsgs.reduce((n, m) => n + commandsOf(m).commands.length, 0) },
    summarized: wasSummarized(o.msgs),
    earlier: earlierOf(o.msgs, o.root),
    helpers: helpersOf(o.msgs, info, o.root),
    latest: latestOf(o.msgs, o.root),
    kind: kindOf(o.msgs, helperMsgs),
    talk: [o.msgs, ...helperMsgs].flat().filter(m => m.role === 'assistant' && m.text.length >= 400).length,
  };
}

/** Whether a session has anything to teach: changes, helpers' work, failures, an earlier summary, or real explanations. */
export const worthShowing = (l: Lessons) => l.changes.length > 0 || l.helpers.length > 0 || l.bugs.length > 0 || Object.keys(l.earlier).length > 0 || l.talk >= 2;
