// Halftime's data and state contract. Self-contained: no imports.

/** One transcript row, as `$.session.messages()` returns it (the fields Halftime reads). */
export type Msg = {
  role: 'user' | 'assistant';
  text: string;
  toolUses: ReadonlyArray<{ tool_use_id: string; tool: string; input: Record<string, unknown>; text?: string; isError?: true; agentId?: string }>;
  toolResults?: ReadonlyArray<{ tool_use_id: string; text: string; isError: boolean }>;
};

export type DiffLine = { op: '+' | '-' | ' '; text: string };
export type FileChange = { file: string; added: number; removed: number; diff: DiffLine[] };

/** One user request and the files Claude changed for it. */
export type Change = { index: number; ask: string; said?: string; files: FileChange[]; added: number };

/** A failing check Claude fixed: the failure, Claude's words, the fix, the passing run. */
export type Bug = { title: string; failed: string; error: string[]; why?: string; fix: FileChange[]; verified?: string; changeIndex: number };

export type Risk = 'high' | 'med' | 'low';
export type Approval = { risk: Risk; kind: 'package' | 'command' | 'secret' | 'permission' | 'migration'; what: string; say: string; todo?: string };

export type GraphNode = { id: string; label: string; added: number; x: number; y: number };
export type Graph = { nodes: GraphNode[]; edges: Array<[string, string]> };

export type QuizItem = { ask: string; options: string[]; right: number; why: string };

/* ---------- the course: written once per limit window by one small request ---------- */

/** What Claude did with a lesson's topic: a choice you guess first, or a step with its reason. */
export type Did =
  | { kind: 'choice'; problem: string; options: string[]; picked: number; chose: string; why: string; cost: string }
  | { kind: 'step'; what: string; why: string; evidence?: string };

/** One topic of the project, taught in four cards and a check. */
export type Lesson = {
  topic: string;
  summary: string;
  what: { title: string; body: string; analogy?: string; breaks?: string; more?: string };
  /** `code` is the session's own diff for `file`, attached by Halftime (not written by the model). */
  where: { body: string; file?: string; code?: string };
  did: Did;
  takeaway: string;
  /** A prompt you could send Claude next. */
  next?: string;
  check: QuizItem;
};

/** Counted from the session, never written by the model. */
export type Stats = { messages: number; commands: number; helpers: number; files: number; failed: number };

export type Course = {
  id: string;
  /** The Claude Code session it was written for. */
  session?: string;
  title: string;
  /** The kind of session (build, fix, ml, research, ...), as Halftime detected it. */
  kind: string;
  createdAt: number;
  model: string;
  briefing: { issue: string; fixed: string[]; holding: string[]; trivia?: string };
  lessons: Lesson[];
  final: QuizItem[];
  stats: Stats;
  usage?: { input: number; output: number };
};

/**
 * Where you are in a course. `read` holds card keys (`l0.what`); `answers` holds the
 * option you picked per question key (`l0.check`, `l0.guess`, `f2`). An answered
 * question is never asked again, so reading a finished course again shows answers.
 */
export type Progress = { read: string[]; answers: Record<string, number>; finishedAt?: number };
export type CourseRecord = { course: Course; progress: Progress };

/** A question you missed, asked again at a later break until you get it right. */
export type ReviewItem = QuizItem & { topic: string; from: string };

/** Everything the pane draws, built once per limit (or per /halftime). */
export type Lessons = {
  project: string;
  builtAt: number;
  changes: Change[];
  bugs: Bug[];
  approvals: Approval[];
  graph: Graph;
  counts: { messages: number; edits: number; commands: number };
  /** The conversation was summarized earlier, so only what came after is visible. */
  summarized: boolean;
  /** The summary Claude Code wrote of the earlier conversation, by section; empty when there is none. */
  earlier: Earlier;
  /** Tasks Claude handed to helper agents, in order. */
  helpers: Helper[];
  /** The first sentences of Claude's latest reply: where things stand. */
  latest?: string;
  /** The kind of session, detected from what ran (see kindOf). */
  kind: string;
  /** Claude's substantial explanations (400+ characters): a session can teach without any edit. */
  talk: number;
};

/** One entry of a summary section: a line, or a bold label with the points under it. */
export type Point = { head: string; points: string[] };
export type Earlier = { asked?: Point[]; ideas?: Point[]; errors?: Point[]; solved?: Point[]; open?: Point[]; now?: Point[] };
/** `report` is what the helper reported; `last`, its latest words when it had not reported yet. */
export type Helper = { task: string; report?: string; last?: string; files: number; running: boolean };

export type Window = { kind: string; percentUsed: number; resetsAt?: string };

/**
 * The limit Halftime is waiting out. `resetsAt` is the latest reset among the
 * full windows (0 when unknown); `stoppedAt` is when a turn died on it (0 if
 * none did); `confirmed` once a reading showed a window at 100%; `simulated`
 * for `/halftime simulate`, which never sends anything to Claude.
 */
export type Limit = { kinds: string[]; resetsAt: number; startedAt: number; stoppedAt: number; confirmed: boolean; simulated?: boolean };

export type View =
  | 'home' | 'briefing' | 'lesson' | 'final' | 'score' | 'review' | 'library'
  | 'notes' | 'chapter' | 'replay' | 'prompts';

export type UiState = {
  view: View;
  /** The course on screen: this session's, or one from the library. */
  course: string;
  lesson: number;
  /** 0 what · 1 where · 2 what Claude did · 3 takeaway · 4 check. */
  card: number;
  final: number;
  review: number;
  /** The option picked on the review card on screen; -1 before you pick. */
  reviewPick: number;
  /** Cards whose "Go deeper" is open. */
  deeper: string[];
  /** Share text includes the course title (off by default: it can reveal your project). */
  shareTitle: boolean;
  /** Session notes navigation. */
  chapter: number;
  step: number;
  read: string[];
  showCode: string[];
  replay: number;
};

declare module 'claude-code' {
  interface PluginState {
    halftime: {
      /** Latest rate-limit windows from session.measure. */
      windows: Window[];
      /** Set while a usage limit is active. */
      limit: Limit | null;
      /** Built lessons for this session. */
      lessons: Lessons | null;
      /** Id of this session's course in the library; '' until one is written. */
      course: string;
      /** This project's courses, newest first (mirrors the plugin store). */
      library: CourseRecord[];
      /** Questions you missed in earlier courses of this project. */
      review: ReviewItem[];
      /** Windows (kind:resetsAt) a course was already written for. One request covers every window it was near in. */
      prebakedFor: string[];
      /** True while the course request is in flight. */
      prebaking: boolean;
      /** Pane navigation and answers. */
      ui: UiState;
      /** Prompts saved for when Claude is back. */
      todos: string[];
      /** Permission rules that existed when the session started. */
      permsAtStart: string[];
      /** Epoch ms of the last turn that started (to tell whether Claude already continued). */
      lastTurnAt: number;
      /** Where Claude Code keeps settings (derived from the transcript path). */
      configDir: string;
      /** False until session.start has run once in this session (it re-fires on reloads). */
      booted: boolean;
      /** Fill the first saved prompt into the composer when Claude is next idle. */
      fillPending: boolean;
      /** Main-thread turns that finished in this session (gates the preparation request). */
      turns: number;
      /** The limit (its resetsAt) Halftime already sent its one fallback continue for. */
      continuedFor: string;
      /** When a turn last died on a rate_limit error (a usage reading can lag behind it). */
      lastStopAt: number;
      /** How many times the conversation was cleared; a pending continue checks it did not change. */
      clears: number;
      /** The window (kind:resetsAt) Halftime is asking about preparing a lesson for; '' when not asking. */
      offer: string;
      /** Windows you answered "Not now" for: no more asking until the next one. */
      declined: string[];
      /** You chose "Always" (kept across sessions in the plugin store; mirrored here for drawing). */
      always: boolean;
      /** Courses opened in the browser in this session: the pane says their answers are kept there. */
      browser: string[];
    };
  }
}
