# Halftime: plugin-engine API notes (Claude Code 2.1.295)

Sources:
- `R` = `plugin-authoring/reference.md`
- `d.ts:N` = `plugin-authoring/types/claude-code.d.ts`, line N
- `ex/` = `plugin-authoring/examples/`
- **[probed]** = checked by running `claude plugin validate` / `claude plugin test` against a scratch plugin.

The declaration file is the authority; this page is a map of it. The API is early access and may change between releases.

---

## 1. Manifest, layout, module environment

### Layout (three files plus tests)
```
halftime/
  .claude-plugin/plugin.json
  hooks/hooks.json            { "modules": ["./index.tsx"] }
  hooks/index.tsx             export const register: Register = (on, options) => {...}
  hooks/*.ts                  local helpers, imported by relative path
  types/index.d.ts            PluginState contract (named by "types")
  tests/*.test.ts(x)          run by `claude plugin test`
```

### `hooks/hooks.json` [probed]
- `modules` must be an **array**. A string fails with "expected array".
- It must hold **exactly one** module: "hooks.json `modules` names one hooks module per plugin; a second entry is refused".
- The path is relative to `hooks.json`.

### `plugin.json` fields [probed with `validate --strict`]
| field | notes |
|---|---|
| `name` | Plugin name. Also the `$.state` plugin key and the `pluginConfigs` key (`<name>@inline` under `--plugin-dir`). |
| `version` | Optional. `plugin.register` sees it (d.ts:7683). |
| `description`, `author: {name}`, `license`, `keywords`, `homepage`, `repository` | Accepted, no warnings. |
| `types` | `"./types/index.d.ts"`. A self-contained `.d.ts`: no imports. Validate reports "declares state: …" (R:66). |
| `dependencies` | An array of plugin names was accepted. Each dependency's contract is laid in `.claude-plugin/types/<plugin>/` (R:66). |
| `userConfig` | `{ <field>: { type, title, description, default?, options?, required?, sensitive?, min?, max? } }`. **`title` is required** (validate error without it). `type` is one of `"string" \| "number" \| "boolean" \| "directory" \| "file"`. `default` must be one of `options` when `options` is given. |
| `mcpServers` | Implied by `$.mcp.connect` ("servers this plugin's own manifest lists", d.ts:2720). Halftime does not need it. |
| **min-engine-version** | **Does not exist.** `engines` and `minEngineVersion` are "Unknown field … ignores it at load time". To gate on version, read `$.session.version()` (d.ts:2863) at runtime and degrade. |

- `register(on, options)`: `options: PluginOptions = Readonly<Record<string, string|number|boolean|readonly string[]>>` (d.ts:7658).
  - Values are stored in settings `pluginConfigs[<plugin>].options`.
  - A required field with no value fails the load.
  - A stored value outside `options` counts as unset.
  - Changing a value in `/config` reloads the module (R:74, d.ts:9301).

### Imports [probed]
- Local files: yes. `import { twice } from './util'` works.
  - Allowed suffixes: `.ts .tsx .jsx .js .mjs .cjs .mts .cts`. Every file is treated as an ES module.
  - There is no `require`.
- **npm packages: NO.** The validate error says a hooks module imports its own files by relative path and `"claude-code"`, nothing else.
- `import()` anywhere means the module **does not load** (R:14, d.ts:22).
- `import { atom, read, update, derive, memberOf } from 'claude-code'` are real runtime values (d.ts:14701-14735). Every other import from `'claude-code'` is a type and is empty at run time.

### Environment (d.ts:14742ff)
- No DOM, no Node, no `console`, no `setTimeout`/`setInterval`. Use `$.clock` for timers and `$.ui.log` for output.
- No `eval`, no `new Function`, no `WebAssembly`.
- Globals: `h`, `Fragment`, `AbortController`/`AbortSignal` (`.timeout`, `.any`), `TextEncoder`/`TextDecoder`, `URL`, `URLSearchParams`, `atob`/`btoa`, `structuredClone`, `crypto.{subtle.digest, randomUUID, getRandomValues}`, `performance.now`.
- ES built-ins (`Date`, `JSON`, `Map`, …) are available. Prefer `await $.clock.now()` over `Date.now()` so the mock clock can drive tests.
- Do not declare or import anything named `h` or `Fragment`, and add no `@jsx` pragma.
- JSX uses no intrinsic tags. Tags come from `$.ui.resolve(e)`.

### Budgets and failure (`HookBudget`, d.ts:5100)
- `ms: 10_000` per dispatch counts the hook's **own** time only.
  - The clock stops while a `next()` or `$` call is in flight.
  - `$.clock.sleep` is the exception: it is charged to the budget.
  - So `await $.model.complete(...)` costs no budget.
- `catchMs: 1_000` is the grace for a `.catch` handler.
- `lingerMs: 5_000` is how long a hook may keep running after `next.signal` aborts.
- `session.end`: one **1.5 s wall-clock bound** for the whole chain, `$` waits included (d.ts:11041). `next.budget.remainingMs` reads it.
- **On throw, timeout, or a wrong-shaped answer the hook is skipped** and the chain continues without it ("fail open"), unless `.catch(...)` answers in its place (R:78-79, d.ts:3946-3956).
  - The debug log and, in a hot-reload session, a dim transcript line name the skip.
  - Hooks on observe-only events (`turn.complete`, `session.measure`, `ui.render`) need no `.catch`. A failed render draws the engine's own (or nothing for `AbovePrompt`; a `Pane` is **closed**, R:130).
- Memory and CPU: the docs state no separate cap beyond the per-call size limits below. Keep work inside a dispatch small, and keep heavy computation out of `ui.render`.
- The engine may replace the worker mid-session. When that happens timers and module variables are gone; `$.state` survives a **hot reload**. A repeated `$.prompt.submit`/`$.command.run`/`$.agent.spawn` with the same input made *during the same `session.start` hook* is deduplicated. One made later (from a timer) is made again (R:162).

---

## 2. `register`, `on`, `next`, state, store

```ts
export type Register = (on: On, options: PluginOptions) => unknown          // d.ts:9301
type On = {                                                                   // d.ts:6771
  <P extends Pattern>(pattern: P, hook): Registration
  <P extends Pattern, const M>(pattern: P, matcher: M, hook): Registration
}
// hook: ($: EngineInterface, e: Frozen<Args<E>>, next: Next<E>) => Result | Promise<Result>   (d.ts:4805)
// Registration.catch(($, e, next & { error: HookFailure; called: boolean }) => ...)   one per registration (d.ts:9327)
```

- `Pattern` is an event name, a glob (`*`, `classic.*`), or a negation (`!tool.describe`).
- A matcher is an object narrowing `e`, for example `{ component: 'Pane', requestId: 'halftime' }` or `{ command: 'halftime' }`. Values must be literals. RegExp works for some fields (`{ path: /\.env$/ }`).
- `e` is deeply frozen. To rewrite, pass a copy: `next({ ...e, x })`. A hook that returns without calling `next` answers by itself.
- `next` members (d.ts:6535):
  - `next.signal`: AbortSignal for the dispatch.
  - `next.budget.{ms, remainingMs}`.
  - `next.origin: {plugin, tier}`.
  - `next.event`, `next.is(pattern, e)`, `next.trace`, `next.to(e, tier)`.
- A `$` call raises its own event through every **other** hook (the calling hook is skipped), so a hook never re-enters itself.

### `$.state`: session-scoped, versioned, drives redraws (d.ts:3384, 11986-12110)
- Contract in `types/index.d.ts` (shape from ex/pane-state.d.ts):
  ```ts
  export type Lesson = { file: string; why: string }
  declare module 'claude-code' {
    interface PluginState { halftime: { phase: 'idle'|'limited'|'resuming'; lessons: Lesson[]; isOpen: StateFamily<boolean> } }
  }
  ```
- Refs must spell `plugin` and `key` as **literals** in source. Validate lists the reads and writes. Only a family member's `id` may be computed.
- Calls:
  - `$.state.get(ref) → {value: T|undefined, version}`
  - `$.state.set(ref, value, {ifVersion?}) → {isSet, version}`
  - JSON data only, never `undefined`. Only the owner may write.
- Library (runtime values):
  - `atom(ref, initial, {shape?})` (d.ts:708) makes a typed ref that is never `undefined`.
  - `read($, atom|derived|ref)` (d.ts:9284).
  - `update($, atom, fn)` (d.ts:14585) reads, applies `fn`, and writes with `ifVersion`, retrying on a miss.
  - `derive(sources, fn)` (d.ts:3750) is cached by version.
  - `memberOf(family, e)` (d.ts:6041) picks the family member keyed by `e.requestId`.
- **Redraw contract:**
  - A `get`/`read` *during a `ui.render` hook* subscribes that instance. A later `set` redraws exactly those readers at the redraw rate, so there is no need to call `$.ui.invalidate`.
  - **`$.state.set` while drawing is denied.** Write from `onPress`, other events, or timers.
  - Never write a value captured at draw time; use `update` (R:118).
- Lifetime: survives a hot reload and is gone when the session ends. Persist with `$.store`.
- `atom(..., { shape: 'v2' })` with a key declared `Shaped<T>` (d.ts:11833) lets new code decline old data.

### `$.store`: cross-session key-value (d.ts:3351)
- Methods:
  - `get(key) → Promise<unknown>`
  - `set(key, value) → Promise<void>`
  - `delete(key)`
  - `keys() → string[]` (insertion order)
- One JSON file **per plugin** under the user's Claude config dir.
  - **Not scoped per project or session.** Namespace keys yourself, e.g. `` `${repo.root}:pending` ``.
- Limit: **4 MiB of JSON text in total**. `set` rejects functions and cycles. A Date round-trips as an ISO string and `undefined` fields drop.
- Survives sessions and reloads. In tests, `mock.store(on, entries?)`.

---

## 3. Events Halftime cares about

All hooks have the shape `($, e, next)`. Observe-only events: return `next(e)`.

| event | `e` | `next(e)` resolves | notes |
|---|---|---|---|
| `session.start` (d.ts:4352) | `SessionStartInput {cwd, surface: RenderSurface\|null, isInteractive}` (d.ts:11671) | `{cwd}` | Fires once per process before the first prompt and is **awaited**. Fires again on enable, worker respawn, or hot reload (never on `/clear`). **Register the command and re-arm timers here.** |
| `session.end` (d.ts:4417) | `SessionEndInput {reason, sessionId, resume}` (d.ts:11049) | `{sessionId}` | `reason`: `'clear'\|'resume'\|'logout'\|'prompt_input_exit'\|'other'`. 1.5 s total bound. `/clear` gives `session.end` with `reason:'clear'` and **no** `session.start` after it. |
| `session.measure` (d.ts:4404) | `SessionMeasureInput {context, rateLimits: SessionRateLimit[], cost?, changed: UsageUnit[]}` (d.ts:11095) | `{changed}` | Pushed after each main-thread turn and **when a rate-limit window moves a whole point, appears or leaves, or "the account's limit status changed"**. Bursts fold. |
| `turn.start` | `{text, turnId}` (d.ts:13374) | `{turnId}` | Observe. |
| `turn.complete` (d.ts:4448) | `TurnCompleteInput` (d.ts:13324): `{answer, durationMs, isAborted, turnId, agentId?, usage?: TurnUsage, reason}` plus `refusal` on a refusal | `{text, usage?}` | `TurnCompleteReason = 'answer'\|'aborted'\|'refusal'\|'error'` (d.ts:13330). `'error'` means "dead on an API error (retries exhausted, the context limit)". **It carries no error kind.** `usage` is absent on an API error. Fires for subagent turns too (`agentId` set); filter `e.agentId === undefined` for main. Returning `{text: X}` shows X beneath the answer. |
| `turn.step` (streaming) | `{turnId, index, model, effort?, messageCount, agentId?}` (d.ts:13430) | `TurnStepResult {answer, toolUses, stopReason: TurnStopReason, usage: TurnUsage\|null}` (d.ts:13490) | Async-generator hook only. `stopReason`/`usage` are null when the request failed. Not needed for Halftime. |
| `classic.StopFailure` | `StopFailureHookInput = BaseHookInput & {hook_event_name:'StopFailure', error: SDKAssistantMessageError, error_details?: string, last_assistant_message?: string}` (d.ts:12110) | `Pick<ClassicResult,'block'\|'preventContinuation'\|'stopReason'>` (d.ts:1386) | **The direct "turn died on an API error" signal with the kind.** `SDKAssistantMessageError` (d.ts:10453) includes `'rate_limit'`, `'overloaded'`, `'billing_error'`, `'server_error'`, `'max_output_tokens'`, `'unknown'`, …. `BaseHookInput` (d.ts:826) adds `session_id, transcript_path, cwd, prompt_id?, agent_id?`. Validate lists it as a *gating hook*: just `return next(e)`. [probed] |
| `classic.Notification` | `{message, title?, notification_type: string}` (d.ts:6692) | | Not enumerated. Do not rely on it for limits. |
| `prompt.submit` (d.ts:4091) | `PromptSubmitInput {text, attachments?, context?, turnId?, wait, origin: PromptOrigin}` (d.ts:9051) | `{text, context?, origin?}` or `{drop}` | Use it to spot a user prompt (`origin.kind==='composer'`) and cancel a pending auto-continue. Attach hidden model context with `next({...e, context:[...(e.context??[]), s]})`. A guard needs `.catch`. Resolves when the turn **starts**, not when it ends. |
| `command.run` (d.ts:4263) | `CommandRunInput {command, args, origin, presentation: {isFullscreen, columns}}` (d.ts:1792) | `{text?, context?, exitCode?, ref?}` (d.ts:1837) | See §6. |
| `ui.render` (d.ts:3982) | `RenderInput {surface, component, requestId, viewport?, props}` (d.ts:9715) | `RenderElement` | See §5. |
| `ui.press` (d.ts:4002) | `UiPressArgument {plugin, element, component, requestId, surface, link?}` (d.ts:14202) | `{element}` | Core runs the Button's `onPress` at the bottom. |
| `ui.input` (d.ts:4011) | `UiInputArgument {plugin, element, component, requestId, surface, kind:'change'\|'submit', value}` (d.ts:13944) | `{element, value}` | Core runs `onInput`/`onSubmit`. |
| `ui.select` | `{plugin, element, component, requestId, surface, value}` | `{element, value}` | Core runs `onSelect`. |
| `ui.focus` (d.ts:4061) | `UiFocusInput {component:'Pane'\|'AbovePrompt', requestId, plugin?, element?, origin}` (d.ts:13863) | `{deny?}` | `next(e)` moves the ring. Answering without `next` keeps it. |
| `ui.close` | `PaneCloseInput {id, origin:{kind:'plugin'\|'person'\|'unload'}}` (d.ts:7353) | void | Answering without `next` keeps the pane open (never on `unload`). |
| `ui.scroll` | `UiScrollInput` | | Engine-owned window over a tall tree. |

### Detecting the usage limit (no dedicated event exists)
1. **`classic.StopFailure` with `e.error === 'rate_limit'`.**
   - This is the only signal that carries the error kind.
   - `rate_limit` can also be a transient 429; `ModelApiError` doc (d.ts:6077) says "`rate_limit`, `overloaded` and `server_error` may clear on their own".
   - So confirm with step 2.
2. **`session.measure` / `$.session.usage()`.**
   - `rateLimits: SessionRateLimit[]`, where `SessionRateLimit = { kind: string /*'five_hour'|'seven_day'|'spend_limit'*/, percentUsed: number /*0-100, 1 dp; >100 only on spend limit*/, resetsAt?: string /*ISO 8601*/ }` (d.ts:11282).
   - `rateLimits` is **empty off a subscription** (API key or gateway) and before the first reading.
   - There is **no `status` / `isLimited` field.** "Limit status changed" triggers a measure but is not exposed, so treat `percentUsed >= 100` (or `StopFailure 'rate_limit'` plus a window near 100) as limited.
3. `turn.complete` with `reason === 'error'` is a fallback signal only (no kind).

**Unverified (cannot be probed without hitting a real limit):**
- whether the window reads exactly `100` when blocked;
- whether `resetsAt` is always present at that point.

Design for both: if `resetsAt` is missing, poll `$.session.usage()` on a slow `$.clock.every`.

### Does the engine auto-resume after a reset?
**No evidence that it does.**
- A `grep` of `d.ts` for `retry`, `resume` and `resetsAt` finds `resetsAt` only on `SessionRateLimit`.
- `turn.complete` 'error' is documented as "retries exhausted".
- The engine retries transient API errors within a turn. Nothing documents waiting for a usage window and continuing.

**Halftime must do this itself:** set `$.clock.after(resetsAt - now, …)` and then call `$.prompt.submit`.

`PromptOrigin` has `kind:'auto-continuation'` (d.ts:8865), but that is "a programmatic follow-up to a user's UI action", not a limit resume.

---

## 4. Session reads

- **`$.session.messages()`** → `Promise<SessionMessage[]>` (d.ts:2771, 11226).
  - Returns at most the **newest 4096** entries.
  - Progress rows, `$.ui.log` lines and notices are excluded.
  ```ts
  type SessionMessage = {                       // d.ts:11134
    role: 'user'|'assistant'; text: string /* text blocks joined, '' if none */;
    toolUses: ToolUseSummary[]; toolResults?: ToolResultSummary[]; handle?: string }
  type ToolUseSummary = {                       // d.ts:13147
    tool_use_id: string; tool: string /*'Edit','Write','Bash',...*/; input: Record<string, unknown>;
    result?: unknown /* the tool's stored record once answered; error text when errored */;
    text?: string /* what the model read; absent while in flight */; isError?: true;
    agentId?: string; durationMs?: number; meta?: Record<string, unknown> }
  type ToolResultSummary = { tool_use_id; text; isError: boolean; result?: unknown; meta? }   // d.ts:13078
  ```
  - Other forms:
    - `$.session.messages({ as: 'api' })` → `ApiMessage[]` (`{role, content}` blocks).
    - `$.session.messages({ agentId })` → `SessionMessage[] | {deny}`.
  - **Edit record** (`BuiltinToolResults.Edit`, d.ts:20424):
    - `{ filePath, oldString, newString, originalFile: string|null, structuredPatch: {oldStart, oldLines, newStart, newLines, lines: string[]}[], userModified, replaceAll, gitDiff?: {filename, status, additions, deletions, changes, patch, repository?}, staged? }`
  - **Write record** (d.ts:21326):
    - `{ type:'create'|'update', filePath, content, structuredPatch, originalFile: string|null, gitDiff?, userModified?, staged? }`
  - Inputs:
    - Edit: `{file_path, old_string, new_string, replace_all?}`
    - Write: `{file_path, content}` (d.ts:16260, 16774)
  - `structuredPatch` maps directly to `Code format='diff'` hunks (prefix `@@ -a,b +c,d @@`). No git is needed.
  - Headless (`-p`) runs may store records without their bulk, and subagent transcripts store none (`text` is always present).
  - **Cost gotcha:** each call copies the whole transcript, including `originalFile`/`content` of every Edit/Write. Call it **once** at limit time, never per render or per turn.
- **`$.session.usage(args?)`** → `SessionUsage {startedAt, context: SessionContextUsage, rateLimits: SessionRateLimit[], cost?: {usd}}` (d.ts:2846, 11704).
  - The plain call is free.
  - `{breakdown:'full'}` sends token-count requests; avoid it.
  - `SessionContextUsage {tokens?, window, percent?, breakdown?}` (d.ts:10950).
- **`$.session.id()`** → `Promise<string>`. It is a **function, not a property**: the transcript file's name (d.ts:2796).
- Other session reads:
  - `$.session.cwd()` → absolute cwd.
  - `$.session.root()` → project root (moves with `/cd` or a worktree; not with a shell `cd`).
  - `$.session.repo()` → `SessionRepo {root, remote, internal, name} | null` (d.ts:11463), read fresh each call.
  - `$.session.model()`, `$.session.turns()`, `$.session.surfaces()`, `$.session.version()` → `{version, base?, builtAt?}`.
- `$.plugin.{name, root}`: the plugin dir, absolute (d.ts:2319). It is **not** a function.
- `$.session.append({ message: { type:'user'|'system', content:[{type:'text', text}] } })`: a real row (d.ts:2901, R:145). `user` means the model reads it (isMeta); `system` means a notice the model never reads.

---

## 5. `$.ui` and drawing

### Calls (d.ts:2333-2589)
- **`$.ui.open(pane: PaneOpenArgs): Promise<UiOpenResult>`** (d.ts:2500, 7390).
  - `PaneOpenArgs {id /*1-64 [A-Za-z0-9_-]*/, title?, focus?: true, closeOnEscape?: true, holdToasts?: true, rows?: number, columns?: number}`
  - **Placement rule:**
    - An open that answers the person's input (their command, prompt or **Button press**) is placed at **any width**.
    - An open the plugin makes **on its own** (from `session.measure`, `StopFailure`, a timer) waits **undrawn below 144 terminal columns**. The floor is 110 once the person has opened that id (this or an earlier session, until they close it by hand).
    - A `-p` run places all panes.
  - Result `UiOpenResult` (d.ts:14134): `{isPlaced: true}` or `{isPlaced: false, reason: string}`. The pane is still *open* and is seated when the terminal widens or the person opens it.
  - `focus` is a request: it is refused while the person has text in the composer or a dialog is up.
  - `holdToasts` holds **every** plugin's toasts. Use it only for a short dialog, **never for a pane that stays open**.
  - `rows`: inline height wanted. `columns`: docked width wanted.
  - One pane per id; reopening an open id only retitles.
  - **Halftime implication:** an auto-open on a narrow terminal will not show. Fall back to the `AbovePrompt` band (always drawn) with a Button that opens the pane (a press counts as asked, so any width works), and/or `$.ui.toast`, `$.ui.status`, `$.ui.notify`.
- `$.ui.close({id}): Promise<void>`. It raises `ui.close` with origin `plugin`, and rejects on a hook's `{deny}` (d.ts:2514).
- `$.ui.panes(): Promise<readonly UiPane[]>` with `UiPane {id, title, isShown, isFocused, isPlaced}` (d.ts:14167). This is the engine's record and survives a module reload.
- `$.ui.status(text|undefined): void`. One pinned line under the prompt per plugin; `undefined` clears it. The first 2000 chars are drawn.
- `$.ui.toast(text, {timeoutMs?=4000}): void`. A box top-right, or one line on the notification bar in non-fullscreen. It waits while a `holdToasts` pane shows. Each new toast replaces this plugin's previous one.
- `$.ui.log(text, {to?:'transcript'|'debug'}): void`. A dim transcript row, never sent to the model. `{to:'debug'}` goes to the debug log only.
- `$.ui.notify(text, {title?}): Promise<UiNotifyResult>` sends a native OS or terminal notification (d.ts:2465, 14079).
  - Result: `{isSent:true, channel:'iterm2'|'iterm2_with_bell'|'kitty'|'ghostty'|'terminal_bell'}` or `{isSent:false, reason:'disabled'|'no-channel'|'no-surface'|'refused'}`.
  - Useful for "your limit reset, Halftime resumed".
- `$.ui.notice(tool_use_id, text|undefined)`: a line under an open permission dialog only. Not relevant.
- `$.ui.invalidate(event: 'ui.render'|'prompt.section'|'prompt.context'|'prompt.attachment'|'tool.describe'|'command.describe'|'config.describe')` (d.ts:2360, 5564).
  - It re-runs this plugin's render hooks.
  - Rate: at most **10/s**, or 30/s in the terminal for a shown pane, expanded band and prompt hint. Faster calls fold together.
  - Not needed when drawing from `$.state`.
- `$.ui.resolve(e)` → `Elements[e.surface]`, a frozen table of constructors (d.ts:2397). It is a read, not a dispatch.
- `$.ui.focus({requestId, key})`, `$.ui.scroll({to, in, block})`, `$.ui.copy({text, surface})`, `$.ui.selection()`, `$.ui.ask(question, options)` (rejects in `-p`), and `$.ui.blit({requestId, key, cells|source})` (for Raster or Image, up to 120/s).
- **There is no `$.ui.redraw`.** Use state writes or `invalidate`.

### `ui.render` for `Pane` and `AbovePrompt`
```ts
on('ui.render', { component: 'Pane', requestId: 'halftime' }, async ($, e, next) => {
  const { Box, Text, Button, Code, Markdown } = $.ui.resolve(e)
  ...return <Box flexDirection="column">...</Box>
})
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  if (e.props.hasSurvey || !(await read($, isLimited))) return next(e)   // yield the band
  ...
})
```
- `e.viewport?: {columns, rows, isFullscreen?}` (d.ts:10390). A width change re-runs the hook; a height change alone does not.
- `Pane` props (d.ts:10312): `{title, isFocused, bodyColumns, placement:'dock'|'inline', scroll:{offset, bodyRows}, view:{agentId?}}`.
  - **Size the tree to `e.props.bodyColumns`**, not `viewport.columns`.
  - Showing more rows than `scroll.bodyRows` scrolls; the person moves the window.
- `AbovePrompt` props (d.ts:10255): `{hasSurvey, isWorking, maxRows, bodyColumns, scroll, view}`.
  - Return `next(e)` to draw nothing.
  - A tree of at most `maxRows` rows shows whole.
- A render hook **must not write state**. Reads subscribe the instance.
- **Size limit:** the first **100,000 characters** of a tree's text (children, Code sources, Markdown, labels) are drawn. The rest is cut with a "how much is left out" note, and a cut `Code` is drawn plain. Draw only the part in view (R:130).
  - Other limits: an `Svg` source ≤131,072 chars, a `Link` href ≤2,048, keys and values ≤10,000.
- An invalid tree (an element the surface lacks, an unknown prop) is not drawn: the engine draws its own and logs `ui.render (<Component>): a hook returned a tree that does not validate`. **For a Pane, the pane is closed.**

### Element tables (`Elements`, d.ts:3802)
| surface | elements |
|---|---|
| terminal | Box, Text, Button, Input, Select, Link, Code, Markdown, Client, **Raster, Image** (no Svg) |
| desktop | Box, Text, Button, Input, Select, **Svg**, Link, Code, Markdown, Client |
| vscode | Box, Text, Button, Input, Select, Svg, Link, Code, Markdown |
| mobile | Box, Text, Button, Svg, Link, Code, Markdown (no Input or Select) |

Narrow on `e.surface` before using Svg, Raster, Image or Input. A plain `$.ui.resolve(e)` gives the union, so only the shared names type-check.

### Props
- **Box** (d.ts:901). Ink flex subset:
  - Layout: `flexDirection, flexGrow, flexShrink, flexWrap, alignItems, alignSelf, justifyContent, gap, columnGap, rowGap, width, height, minWidth, minHeight`.
  - Spacing: `margin*`, `padding*`.
  - Border: `borderStyle` (`single|double|round|bold|singleDouble|doubleSingle|classic|arrow|dashed|quote`; anything else means no border), `borderColor`, `borderDimColor`.
  - Other: `backgroundColor, overflow:'visible'|'hidden', display:'flex'|'none', position:'relative'|'absolute', top/left/right/bottom, key, hover`.
- **Text** (d.ts:12563): `color, backgroundColor, dimColor, bold, italic, underline, strikethrough, inverse, wrap:'wrap'|'end'|'middle'|'truncate'|'truncate-start'|'truncate-middle'|'truncate-end', hover`. **Text has no `key`.**
- **Color** (d.ts:1683) is `ThemeKey | string`. A raw string can be a name or hex (`"#ff8800"`).
  - `ThemeKey` (d.ts:12590): `'text'|'inverseText'|'inactive'|'subtle'|'suggestion'|'remember'|'success'|'error'|'warning'|'merged'|'claude'|'permission'|'planMode'|'autoAccept'|'promptBorder'|'bashBorder'|'ide'|'diffAdded'|'diffRemoved'|'diffAddedDimmed'|'diffRemovedDimmed'|'diffAddedWord'|'diffRemovedWord'`.
  - Prefer theme keys: they follow light and dark themes.
- **Button** (d.ts:1060): `{ key?, label?, hotkey?, action?, plain?, dimColor?, variant?:'primary'|'secondary', role?:'dismiss', autoFocus?, hover?, onPress: (e: UiPressArgument) => void }`.
  - `key` defaults to the label.
  - Children may be strings and `Text` only. With such children you must give `key` or `label`.
  - `hotkey` is **one digit or one lowercase letter** and presses the button while its site holds focus. Focus comes from ctrl+x tab, a click, or `open({focus})`. A bare digit in an empty composer presses a *band* Button.
  - `action` takes an engine keybinding name (`"app:cycleDiffBase"`).
  - Terminal look: `[ label ]`; with `plain`, `1: label`.
  - **How a press is delivered:** the `onPress` closure is the *bottom* of the `ui.press` chain and runs in the plugin's environment. Other hooks (yours included) see `ui.press` first, matchable by `{plugin, element}`. Use `onPress`. Write state from it with `update`.
- **Input** (d.ts:5471): `{ key (required), label?, placeholder?, value?, submitLabel?, autoFocus?, onInput?: (value, e) => void, onSubmit: (value, e) => void }`.
- **Select** (d.ts:10491): `{ key, label?, options: {value, label?}[], value?, autoFocus?, onSelect: (value, e) => void }`.
- **Code** (d.ts:1626): `{ source, language?, path?, startLine?, format?:'source'|'diff', wrap?:'wrap'|'truncate-end' }`.
  - `format:'diff'` needs `@@ -a,b +c,d @@` hunks. A `---`/`+++` pair is skipped. A source with no parsable hunk is drawn as plain code and logged.
  - Highlighting uses the engine's highlighter. `path` only infers the language; it never touches disk.
- **Markdown** (d.ts:5698): `{ key?, text, dimColor?, onLinkPress?: (link: PressedLink, e) => void, pressableLinks? }`.
  - A leaf. It draws like an assistant reply (headings, lists, tables, fences).
  - `key` is required with `onLinkPress`.
  - Not drawn around the approval dialog.
- **Link** (d.ts:5642): `{ href, label? }`. href ≤2048. A remote surface needs `https:`.
- **Svg** (d.ts:12272), not on terminal: `{ source: string /*'<svg…>' ≤131072 chars*/, alt: string /*required*/, width?: number /*CSS px*/, height?: number, isInteractive?: boolean }`.
- **Raster** (d.ts:9245), terminal only: `{ key, columns /*1-512*/, rows /*1-256*/, cells: string }`.
  - `cells` is padded base64 of `columns*rows` little-endian u32 triplets `[codePoint, fg, bg]`.
  - Colors are `0x00RRGGBB`, or `0x01000000` for the terminal default.
  - Each glyph must be a printable width-1 BMP char.
  - Up to 1024 colour pairs. Repaint without a render with `$.ui.blit`.
  - Use it for a sparkline or heat map; never a Box per cell.
- **Image** (d.ts:5315), terminal only, kitty graphics protocol (kitty, Ghostty): `{ key?, source: ImageSource, columns /*1-255*/, rows /*1-255*/, alt /*required*/ }`.
  - `ImageSource` is one of: `{png: base64}`, `{rgba, width, height}` (≤2 MiB decoded), `{file, format:'png', generation?}`, `{file, format:'rgba'|'rgb', width, height, generation?}`, `{shm, …}`.
- **Client** (desktop and terminal): a surface module drawn by a literal `module` path. Halftime does not need it.

---

## 6. Slash command

```ts
on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'halftime', description: 'Open the Halftime lesson pane', argumentHint: '[resume|off]' })
  return next(e)
})
on('command.run', { command: 'halftime' }, async ($, e) => {
  await $.ui.open({ id: 'halftime', title: 'Halftime' })        // asked, so placed at any width
  return { text: 'Halftime opened.' }                          // the row the model also reads
})
```
- `CommandSpec {name /*[A-Za-z0-9_-] ≤64*/, description, argumentHint?, immediate?: true}` (d.ts:1886).
  - Registration is session-scoped, so register in `session.start`.
  - Re-registering replaces the command; a built-in's name is refused.
  - `immediate` runs mid-turn instead of waiting for the turn to end.
- `CommandRunInput {command, args /*'' when none*/, origin: PromptOrigin, presentation: {isFullscreen, columns /*80 headless*/}}` (d.ts:1792, 1761).
- Return `CommandRunResult {text?, context?: readonly string[], exitCode?}` (d.ts:1837).
  - `text` is the transcript row, **which the model also reads**.
  - `context` holds hidden notes only the model reads, recorded after the row.
- A hook that answers its own registered command by literal name is listed by validate as "answers its own command" (not a gate), so no `.catch` is needed.
- Custom output row: hook `ui.render` with `{ component:'CommandOutput', props:{ command:'halftime' } }` (props `{command, args, text, isErrored, onScreen?}`, d.ts:10035).
- `$.command.run({command, args?})` runs any command as if typed, queued until idle. It rejects inside a hook the turn is waiting on.

---

## 7. Clock, process, fs

### `$.clock` (d.ts:3426)
```ts
now(): Promise<number>                         // epoch ms
sleep(ms, { signal? }): Promise<void>          // CHARGED to the hook budget; avoid in hooks
after(ms, fn): Timer                           // TimerCall = (ms: number, fn: () => void) => Timer   (d.ts:12626)
every(ms /*>=1*/, fn): Timer                   // Timer = { cancel(): void }                         (d.ts:12615)
```
- **There is no `$.clock.at`.** Compute `Date.parse(resetsAt) - await $.clock.now()` and call `after`.
- `after` and `every` return the Timer **synchronously**. `fn` runs in the plugin's environment when the `clock.after` dispatch resolves; another hook can refuse it.
- **Survival:** a hot reload or worker respawn **cancels pending timers** (d.ts:3424-3431, R:73,162). Store the due time in `$.state` and `$.store`, and **re-arm in `session.start`**, which re-fires on reload and respawn. If the process quits, nothing fires; on the next `session.start`, read `$.store` and offer to continue.
- Maximum delay is not stated for `after`. `ModelCompleteRequest.timeoutMs` cites "what a timer holds (2147483647)", about 24.8 days. Seven days (604,800,000 ms) is under that.
- In tests, `mock.clock(on, {now})` with `advance(ms)`, `set(ms)` and `settle()`.

### `$.process.run(argv, init?)` (d.ts:3515)
- `ProcessRunInit {cwd? /*default: session cwd*/, env?, stdin?, timeoutMs? /*default 30 s, max 10 min*/}` (d.ts:7999).
- Result `ProcessRunResult {exitCode /*signal→1*/, stdout, stderr, isStdoutTruncated, isStderrTruncated}` (d.ts:8026).
  - Each stream is capped at 4 MiB.
- Uses argv with **no shell**. It rejects if the command cannot start or times out. A non-zero exit resolves normally.
- **Git runs with repo hooks off.**
- Example: `await $.process.run(['git','diff','--numstat','HEAD'], { cwd: root, timeoutMs: 5000 })`.
- Mind the 4 MiB cap: use `--numstat` / `--stat` first, then fetch per-file diffs on demand.
- `$.process.spawn({argv, cwd, env, input})` streams output. Not needed here.

### `$.fs` (d.ts:3223)
- Paths are relative to the session cwd or absolute.
- **Reads and writes over 4 MiB reject.** Network locations are refused.
- Calls:
  - `read(path, {as?:'text'|'bytes'})` → `string` or `{base64}`; rejects on a missing file.
  - `write(path, text)` creates directories as needed.
  - `list(path?)` → `FsEntry[] {name, kind:'file'|'dir'|'other', size, mtimeMs, isLink}` (d.ts:4916). `size` and `mtimeMs` are 0 for non-files.
  - `exists(path)`.
  - `stat(path, {resolve?})` → `{kind, size, mtimeMs, isLink, realPath?}`.
  - `ancestors({names, of?, below?})`.
- Plugin assets live under `$.plugin.root`.

---

## 8. Prompt: submit and fill

- **`$.prompt.submit(input: PromptSubmitArgs): Promise<PromptSubmitResult>`** (d.ts:2949, 9013).
  - `PromptSubmitArgs = { text, attachments?, asUser?: true }`.
  - It raises `prompt.submit` through every other hook with `origin {kind:'plugin', name, asUser?}`.
  - **It queues a prompt that starts its own turn once the session is idle.** It is never folded into a running turn. It resolves when that turn **starts**, not when it ends (R:162).
  - So it **can** wake a quiet session while the user is away. That is the auto-continue path.
  - Framing: without `asUser`, the model reads "The <plugin> plugin sent a message: …". `asUser: true` reads bare, but the transcript still names the plugin.
  - `@file` mentions and pasted images are **not** expanded for a plugin prompt.
  - A `prompt.submit` hook (another plugin's, or a settings `UserPromptSubmit`) may `{drop}` it. Check `result.drop`.
  - Restrictions:
    - The calling hook is skipped for its own submit.
    - Dedup applies only within the same `session.start` hook run.
    - A repeat from a timer is a new prompt, so guard with your own `$.state` flag.
- `$.prompt.fill({text, mode?:'replace'|'append'|'insert', decorations?})` → `PromptFilled {isFilled, refusal?:'no_composer'|'dialog', text, cursor}` (d.ts:2974, 8613).
  - Writes the **draft only**; nothing is sent.
  - `isFilled:false` under a dialog or headless.
  - Gentler alternative to auto-submit: pre-fill "continue" and let the user press Enter.
- `$.prompt.suggest({text})` → `{isShown}`. A dim Tab-to-take hint. Not shown while the box holds text, a turn runs, or headless.
- `$.prompt.read()` → `{text, cursor}` (never rejects). Check it before filling, so you don't clobber a draft.
- `$.turn.abort({turnId})` cancels the running turn (from `turn.start`'s id).

---

## 9. Model calls

- **`$.model.complete(request: ModelCompleteRequest, options?: {signal?}): Promise<ModelCompleteResult>`** (d.ts:2618, 6170).
  ```ts
  type ModelCompleteRequest = {
    model: string                                   // alias 'haiku' | full id, allowlist-checked like --model
    prompt: string | readonly ModelTextBlock[]       // ModelTextBlock = { text; cache?: true }  (d.ts:6388)
    system?: string | readonly ModelTextBlock[]      // after the CLI's identity block
    maxTokens?: number                               // default 1024; max min(model limit, 64000)
    effort?: 'low'|'medium'|'high'|'xhigh'|'max'
    timeoutMs?: number                               // whole call; resolves 'aborted' on expiry
  }
  ```
  - No tools, no history.
  - It never rejects over what the provider did. Only a request the engine refuses to send rejects (blocked model, bad `maxTokens`).
- **`ModelCompleteResult`** (d.ts:6244) has four arms:
  - `{isAnswered:true, text, usage}`
  - `{isAnswered:false, reason:'api-error', status: number|null, error: ModelApiError, usage}`
  - `{isAnswered:false, reason:'empty-reply', usage}`
  - `{isAnswered:false, reason:'aborted', usage}`
- **`ModelUsage`** (d.ts:6423): `{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`. All four are always present.
- **`$.model.fork({ prompt }): Promise<ModelForkResult>`** (d.ts:2637, 6341, 6363).
  - Replays **the main thread's last request** (same model, system prompt, tools, messages) with `prompt` appended.
  - It is **tool-less** (every tool is denied) and the fork's own tail is not cached.
  - The API serves the prefix from the **prompt cache** if the entry is warm (5-minute TTL), so it is cheap. After the entry lapses, or after `/model`, the prefix is billed afresh.
  - Result: the `ModelCompleteResult` arms plus `{isAnswered:false, reason:'nothing-to-fork'}` (before the first response, after `/clear`).
  - `usage.cache_read_input_tokens` says how much was served from cache. Near 0 means you paid for the whole transcript.
  - `aborted` happens when the turn whose hook forked is interrupted.
  - **Halftime's "one pre-generated call while warm":**
    - Fork from `turn.complete` (main loop only, `reason==='answer'`), when the window is high (e.g. `percentUsed >= 85-90` from `session.measure`) and not yet done this window.
    - Do not `await` it inside the hook in a way that delays the chain. Use `const r = await next(e); void forkOnce($); return r`, or a `$.clock.after(0, …)`.
    - Persist the text to `$.state` and `$.store`.
  - **Cost:** fork tokens (cache reads included) **count against the same subscription limit.** Do it once per window.
- **`$.model.classify(text, labels /*≥2*/, {model?})` → `string | undefined`** (d.ts:2656). It uses the small fast model by default. **It rejects** on a failed request, abort, or empty reply.
- **Abort:** pass your own `AbortController().signal` in `options.signal` (for `complete`), or use `timeoutMs`. Inside a hook, `next.signal` aborts with the dispatch, and a dispatch abort also cuts `complete`/`fork`.
- `$` call time does not count against the hook budget (d.ts:5100).

---

## 10. Testing kit

- Run: `claude plugin test <dir>`. It runs every `*.test.ts` / `*.test.tsx` in an environment like the hooks' (no fs, network, or process). Exit code 1 on failure. The default per-test timeout is 5000 ms (`{timeoutMs}`).
- Validate: `claude plugin validate [--strict] [--json] <dir>`. It reports hooks, `$` calls, state reads and writes, gating hooks, and refusals.
- Imports: `import { test, expect, mock, describe, tier } from 'claude-code/testing'` (d.ts:14874).
- `test(name, body)` or `test(name, { options?, plugins?, timeoutMs? }, body)`.
  - `body: ($: Engine, on: On) => unknown` (d.ts:15921-15960).
  - The test's `$` is the **engine side**. You *raise* events: `$.session.measure(e)`, `$.turn.complete(e)`, `$.classic.StopFailure({...})`, `$.command.run(...)`, `$.ui.mount(...)`, `$.ui.press(...)`.
  - The test's `on` hooks sit **beneath** the plugin and act as the engine's bottom.
- `mock.clock(on, {now?})` → `{now, advance, set, settle, sleep}`. Also `mock.store(on, entries?)`, `mock.env(on, vars)`, `mock.session(on).appended()` (d.ts:15440).
- `$.ui.mount({ plugin, surface, component, props, requestId?, viewport? })` (d.ts:15800) → `Mounted`, with:
  - `drawn()`
  - `find({type?, key?, text?: string|RegExp})` → `{type, key, props, text, children}`
  - `findAll`, `press({key})`, `input({key, text, kind?})`, `select({key, value})`, `redraw(props?)`, `unmount()`
- **Gotchas [probed]:**
  1. **Every `$` noun call the plugin makes needs a bottom** registered by the test (`ui.open`, `ui.toast`, `ui.close`, `ui.status`, `prompt.submit`, `process.run`, `session.messages`, …). This applies *even to the event you raise* (`session.measure`, `turn.complete`, `classic.StopFailure`). Otherwise the test fails with: `HooksError: no implementation for session.measure`.
     - Exceptions: `$.state`, render `invalidate` and `session.append` are answered by the kit.
     - Noun calls answer with `{ value: … }` (OpEventResult = `ValueOrDeny`, d.ts:14675).
     - Engine events answer with their own result (`{changed}`, `{text}`, `{}`).
  2. **Register all test `on(...)` hooks before the first `$` call.** Otherwise: `on("ui.toast") after the test first called $`.
  3. `Text` has no `key`. Find it by `{ type: 'Text', text: /re/ }`.
  4. Mount `Pane` props must be complete: `{title, isFocused, bodyColumns, placement, scroll:{offset, bodyRows}, view:{}}`.

### Minimal working test (passes on 2.1.295) [probed]
```tsx
// hooks/index.tsx (excerpt)
const hits = atom({ plugin: 'probe', key: 'n' } as const, 0)
on('session.measure', async ($, e, next) => {
  const hit = e.rateLimits.find(r => r.percentUsed >= 100)
  if (hit) {
    await update($, hits, v => v + 1)
    const opened = await $.ui.open({ id: 'probe', title: 'Probe' })
    if (!opened.isPlaced) $.ui.toast('widen')
    if (hit.resetsAt) $.clock.after(Math.max(0, Date.parse(hit.resetsAt) - (await $.clock.now())),
      () => { void $.prompt.submit({ text: 'continue' }) })
  }
  return next(e)
})
on('ui.render', { component: 'Pane', requestId: 'probe' }, async ($, e) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  return <Box flexDirection="column"><Text>{`hits ${await read($, hits)}`}</Text>
    <Button key="close" label="Close" onPress={() => $.ui.close({ id: 'probe' })} /></Box>
})
```
```tsx
// tests/probe.test.tsx
import { test, expect, mock } from 'claude-code/testing'
test('limit hit opens pane, resumes at reset', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  const opened: string[] = [], submitted: string[] = [], closed: string[] = []
  on('ui.open', (_$, e) => { opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('prompt.submit', (_$, e) => { submitted.push(e.text); return { text: e.text } })
  await $.session.measure({ context: { window: 200000 }, changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-17T11:00:00Z' }] })
  expect(opened).toEqual(['probe'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'probe', surface, component: 'Pane', requestId: 'probe',
      props: { title: 'Probe', isFocused: false, bodyColumns: 60, placement: 'dock',
               scroll: { offset: 0, bodyRows: 20 }, view: {} } })
    expect((await ui.find({ type: 'Text', text: /hits/ }))?.text).toBe('hits 1')
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
  await clock.advance(60 * 60 * 1000)
  expect(submitted).toEqual(['continue'])
  expect(closed).toEqual(['probe', 'probe'])
})
// StopFailure / turn.complete raised the same way:
//   on('classic.StopFailure', () => ({})); await $.classic.StopFailure({ error: 'rate_limit', error_details: '…' })
//   on('turn.complete', (_$, e) => ({ text: e.answer }))
//   await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't1', reason: 'error' })
```

### tsc setup (d.ts:66-80)
```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```
- When the engine loads the mod from a folder it hot-reloads (the mods folder, or an interactive `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS`), it lays `.claude-plugin/types/{claude-code, claude-code-tools, claude-code-mcp, <deps>}/index.d.ts` plus a `tsconfig.json` to extend.
- Otherwise, keep the header tsconfig outside the mod folder and point it at a copy of `claude-code.d.ts`.
- `lib` must not include DOM: its `Text` would shadow the element.
- `tsc` is **not installed** on this machine. `claude plugin test` strips types and does not typecheck.

### Dev loop
- `claude --plugin-dir ./halftime --debug`. An interactive session hot-reloads on save.
  - A save made during the session's own turn reloads when the turn ends.
  - `register` re-runs in a fresh environment and timers drop.
- `CLAUDE_CODE_PLUGIN_DIRS` does the same for desktop and SDK sessions (watching needs `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` when headless).
- Skipped hooks and refused trees show as dim transcript lines while hot-reloading, and always in the debug log.

---

## 11. Performance notes

- `ui.render` runs once per input value (props, viewport width), plugin load, invalidate, or a write to state it read.
  - A repaint reuses the cached answer, so a render hook is cheap only if *it* is cheap.
  - Precompute lessons and diffs in an event or timer, store them in `$.state`, and keep render a pure read-and-layout.
- Redraw rate: state writes and invalidates fold to at most 10/s (30/s for the shown pane or band on the terminal). Don't write state in a tight loop. Batch into one `update`.
- An `AbovePrompt` hook runs for **every** band draw in the session. Bail fast with `return next(e)` when not limited.
- The 100k-char text cap per tree: paginate long diffs and lessons, drawing only `scroll.bodyRows` worth or a page.
- `session.measure` is pushed (no polling); `$.session.usage()` plain is free; `$.session.messages()` is heavy (copies the transcript with file contents).
- `$.process.run` defaults to 30 s. Set `timeoutMs` low for `git` and run it once per limit event.
- Size caps: `$.store` 4 MiB total, `$.fs` 4 MiB per read, `process.run` 4 MiB per stream.
- Hooks fail open, so a broken Halftime never blocks the user or Claude. Prompt and command guards are not needed. Don't hook `tool.call` or `prompt.submit` with heavy work.

---

## Does-not-exist list
- No `$.clock.at`, no `$.ui.redraw`, no `session.id` property (it is `$.session.id()`).
- No dedicated `rateLimit` or `limitReached` event, and no `status` field on `SessionRateLimit`.
- No engine auto-resume after a usage-limit reset.
- No min-engine-version manifest field.
- No npm imports, no dynamic `import()`.
- No `console`, no `setTimeout`.
- No Svg on the terminal; no Raster or Image off the terminal.
- No `key` on Text.
