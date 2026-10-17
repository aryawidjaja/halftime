// A synthetic session: a habit-tracker Express + Prisma API built in six asks.
// Every secret here is an obvious fake.

import type { Msg } from '../types'

export const ROOT = '/repo'

let n = 0
const id = () => `tu_${++n}`
type Use = Msg['toolUses'][number]
export const user = (text: string): Msg => ({ role: 'user', text, toolUses: [] })
export const results = (...ids: string[]): Msg => ({ role: 'user', text: '', toolUses: [], toolResults: ids.map(tool_use_id => ({ tool_use_id, text: 'ok', isError: false })) })
export const claude = (text: string, ...toolUses: Use[]): Msg => ({ role: 'assistant', text, toolUses })
export const bash = (command: string, text = '', isError?: true): Use => ({ tool_use_id: id(), tool: 'Bash', input: { command }, text, ...(isError ? { isError } : {}) })
export const write = (file: string, content: string): Use => ({ tool_use_id: id(), tool: 'Write', input: { file_path: `${ROOT}/${file}`, content } })
export const edit = (file: string, old_string: string, new_string: string, isError?: true): Use => ({ tool_use_id: id(), tool: 'Edit', input: { file_path: `${ROOT}/${file}`, old_string, new_string }, ...(isError ? { isError } : {}) })
export const multi = (file: string, edits: Array<[string, string]>): Use => ({ tool_use_id: id(), tool: 'MultiEdit', input: { file_path: `${ROOT}/${file}`, edits: edits.map(([old_string, new_string]) => ({ old_string, new_string })) } })

/** Files as they end the session, for graphOf's read(). */
export const DISK: Record<string, string> = {
  'src/server.ts': `import './db.js'\nimport { app } from './app'\n\napp.listen(3000)\n`,
  'src/app.ts': `import express from 'express'\nimport rateLimit from 'express-rate-limit'\nimport { authRouter } from './routes/auth'\nimport { habitsRouter } from './routes/habits.js'\n\nexport const app = express()\napp.use(express.json())\napp.use(rateLimit({ windowMs: 60_000, max: 100 }))\napp.use('/auth', authRouter)\napp.use('/habits', habitsRouter)\n`,
  'src/db.ts': `import { PrismaClient } from '@prisma/client'\nexport const db = new PrismaClient()\n`,
  'src/routes/auth.ts': `import { Router } from 'express'\nimport bcrypt from 'bcrypt'\nimport { db } from '../db.js'\nimport { sign } from '../lib/token'\n\nexport const authRouter = Router()\n`,
  'src/lib/token.ts': `import jwt from 'jsonwebtoken'\nexport const sign = (id: string) => jwt.sign({ id }, process.env.JWT_SECRET!)\nexport const verify = (t: string) => jwt.verify(t, process.env.JWT_SECRET!)\n`,
  'src/middleware/requireAuth.ts': `import { verify } from '../lib/token.js'\nexport function requireAuth(req: any, res: any, next: any) { next() }\n`,
  'src/routes/habits.ts': `import { Router } from 'express'\nimport { db } from '../db'\nimport { requireAuth } from '../middleware/requireAuth'\n\nexport const habitsRouter = Router()\nhabitsRouter.get('/', requireAuth, async (req, res) => {\n  const { streak } = await import('../lib/streak')\n  res.json([])\n})\n`,
  'src/lib/streak.ts': `export function streak(days: Date[], tz: string): number {\n  const keys = days.map(d => d.toLocaleDateString('en-CA', { timeZone: tz }))\n  return new Set(keys).size\n}\n`,
  'src/lib/streak.test.ts': `import { streak } from './streak'\n`,
}

const STREAK_V1 = `export function streak(days: Date[], tz: string): number {\n  const keys = days.map(d => d.toISOString().slice(0, 10))\n  return new Set(keys).size\n}\n`

export const SESSION: Msg[] = [
  // 1. server
  user('<system-reminder>\nThe user opened src/server.ts in the IDE.\n</system-reminder>\nSet up an Express server for a habit tracker API, in TypeScript.'),
  claude("I'll set up an Express server with a JSON body parser. Then we can add the database. The port is 3000.",
    bash('npm install express', 'added 64 packages in 2s'),
    write('package.json', '{\n  "name": "habits",\n  "scripts": { "test": "vitest run" }\n}\n'),
    write('src/server.ts', `import { app } from './app'\n\napp.listen(3000)\n`),
    write('src/app.ts', `import express from 'express'\n\nexport const app = express()\napp.use(express.json())\n`)),
  results('tu_1', 'tu_2', 'tu_3', 'tu_4'),
  claude('The server is ready on port 3000.'),

  // 2. schema
  user('Add a Prisma schema for users, habits and check-ins.'),
  claude("I'll add a Prisma schema with three models: User, Habit and CheckIn.",
    bash('npm install prisma @prisma/client@^5.14.0', 'added 6 packages'),
    write('prisma/schema.prisma', 'model User {\n  id    String @id\n  email String @unique\n}\n'),
    write('src/db.ts', DISK['src/db.ts']!),
    bash('npx prisma migrate dev --name init', 'Your database is now in sync with your schema.')),

  // A question: no edits, so no change for it.
  user('What does @unique do?'),
  claude('It tells the database that no two rows may share the same email address.'),

  // 3. auth (an Edit that errored must be ignored)
  user('Add auth: sign up and log in, with hashed passwords and JWT.'),
  claude("I'll hash passwords with bcrypt and sign tokens with jsonwebtoken. Then I'll protect the habit routes. Tokens last a day.",
    bash('npm install bcrypt jsonwebtoken', 'added 12 packages'),
    write('src/routes/auth.ts', DISK['src/routes/auth.ts']!),
    write('src/lib/token.ts', DISK['src/lib/token.ts']!),
    write('src/middleware/requireAuth.ts', DISK['src/middleware/requireAuth.ts']!),
    edit('src/app.ts', 'this text is not in the file', 'whatever', true),
    edit('src/app.ts', `import express from 'express'\n`, `import express from 'express'\nimport { authRouter } from './routes/auth'\n`)),
  user('[Request interrupted by user]'),

  // 4. habit routes
  user('<system-reminder>todo list is empty</system-reminder>Now add habit routes: create, list and check in.'),
  claude('Adding the habit routes behind the auth check.',
    write('src/routes/habits.ts', DISK['src/routes/habits.ts']!),
    multi('src/app.ts', [
      [`import { authRouter } from './routes/auth'\n`, `import { authRouter } from './routes/auth'\nimport { habitsRouter } from './routes/habits.js'\n`],
      [`app.use(express.json())\n`, `app.use(express.json())\napp.use('/auth', authRouter)\napp.use('/habits', habitsRouter)\n`],
    ])),

  // 5. streak, with a failing test, a fix and a passing rerun
  user('Show the current streak for each habit, and add a test for it.'),
  claude("I'll count the distinct days that have a check-in.",
    write('src/lib/streak.ts', STREAK_V1),
    write('src/lib/streak.test.ts', DISK['src/lib/streak.test.ts']!),
    bash('npm test', 'FAIL src/lib/streak.test.ts\n  ✕ streak › counts late-night check-ins\n    Expected: 3\n    Received: 2\n\nTests: 1 failed, 4 passed, 5 total', true)),
  results('tu_17', 'tu_18', 'tu_19'),
  claude('The test failed because the day was written in UTC. A check-in at 11pm in New York landed on the next day.',
    edit('src/lib/streak.ts', `  const keys = days.map(d => d.toISOString().slice(0, 10))\n`, `  const keys = days.map(d => d.toLocaleDateString('en-CA', { timeZone: tz }))\n`)),
  claude('Running the tests again.',
    bash('npm test', 'PASS src/lib/streak.test.ts\nTests: 5 passed, 5 total')),

  // 6. reset, env, more packages
  user('Reset the database, add the env file, and add rate limiting and input validation.'),
  claude("I'll reset the local database and write the env file.",
    bash('npx prisma migrate reset --force', 'Database reset successful'),
    write('.env', 'JWT_SEC' + 'RET=fake-dev-value\nDATABASE_URL=postgresql://fake:' + 'fake@localhost:5432/habits_dev\nPORT=3000\n'),
    write('.env.example', 'JWT_SECRET=\nDATABASE_URL=\nAPI_KEY=\n'),
    bash('npm install express-rate-limit zod', 'added 2 packages'),
    edit('src/app.ts', `import express from 'express'\n`, `import express from 'express'\nimport rateLimit from 'express-rate-limit'\n`)),
]

/* ---------- a research session like a real long one: summarized, mostly done by helper agents ---------- */
// An invented project: a spam filter for support tickets.

export const SUMMARY = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   - Make the ticket spam filter stop flagging real customer tickets.
   - Back every change with the labelled March tickets, not guesses.

2. Key Technical Concepts:
   - **Decision threshold**: the score above which a ticket counts as spam.
   - Precision (of flagged tickets, how many were spam): the main score.
     - Used with recall to judge every change.

3. Files and Code Sections:
   - \`src/filter.py\`
     \`\`\`python
     def is_spam(t): return score(t) > 0.5
     \`\`\`

4. Errors and fixes:
   - **Short tickets flagged as spam**: the filter scored one-line tickets too high.
     - Fixed by ignoring the length feature under 20 words.
   - Emoji-only tickets crashed the tokenizer → added an empty-text guard.

5. Problem Solving:
   Solved the refund-request false positives; the false-positive rate is now 2.1%.
   The remaining misses are all on forwarded emails.

6. All user messages:
   - "can you fix the rest carefully"

7. Pending Tasks:
   1. Handle forwarded emails.
   2. Fix the code: re-run the benchmark on the April tickets.

8. Current Work:
   Measuring the refund-request tickets again.

9. Optional Next Step:
   Run the benchmark.`

const agent = (description: string, agentId: string, text: string): Use => ({ tool_use_id: `tu_${agentId}`, tool: 'Agent', input: { description, prompt: 'Do the task.' }, text, agentId })

export const RESEARCH: Msg[] = [
  user(SUMMARY),
  user('can you fix the rest carefully and thoroughly?'),
  claude('I will split this across helper agents.',
    agent('Literature review on ticket spam', 'ag_lit', 'Found three papers. Character n-grams beat word counts on short texts. Forwarded headers should be stripped before scoring.'),
    agent('Threshold fixes: short tickets', 'ag_fix', 'Async agent launched successfully. The agent is working in the background.'),
    agent('Benchmark on March tickets', 'ag_bench', 'Async agent launched successfully. The agent is working in the background.'),
    agent('Label cleanup', 'ag_label', 'Async agent launched successfully. The agent is working in the background.')),
  user(`<task-notification>\n<task-id>x1</task-id>\n<tool-use-id>tu_ag_fix</tool-use-id>\n<status>completed</status>\n<summary>Agent "Threshold fixes" finished</summary>\n<result>Short tickets are now scored without the length feature. All 14 filter tests pass.</result>\n</task-notification>`),
  user(`Another Claude session sent a message: <agent-message from="ag_bench">\n[Subagent hand-back] The text below is the final report. The report follows:\n  ## Benchmark\n  Precision rose from 0.71 to 0.83 on the March tickets. Two kinds still fail because they are forwarded emails.\n</agent-message>`),
  claude('The threshold and benchmark helpers reported back. Refund requests are no longer flagged, and precision improved from 0.71 to 0.83 because short tickets are now scored fairly.'),
]

/** Each helper's own transcript, as $.session.messages({ agentId }) returns it. */
export const AGENTS: Record<string, Msg[]> = {
  ag_fix: [
    user('Fix short tickets.'),
    claude('Running the filter tests.', bash('pytest tests/test_filter.py', 'FAILED tests/test_filter.py::test_short - AssertionError: 1 != 0\n1 failed, 13 passed', true)),
    claude('The length feature pushed one-line tickets over the threshold. Dropping it under 20 words.', edit('src/filter.py', 'return score(t) > 0.5', 'return score(t, use_length=len(t.split()) >= 20) > 0.5')),
    claude('Rerunning.', bash('pytest tests/test_filter.py', '14 passed')),
  ],
  ag_bench: [user('Benchmark.'), claude('Running the benchmark.', bash('python bench.py --month march', 'precision 0.83'))],
  ag_lit: [user('Review.'), claude('Searching.')],
}

/** What Claude Haiku might reply for SESSION: three lessons (one a choice to guess), two final questions. */
export const COURSE_REPLY = {
  title: 'Building the habit tracker API',
  briefing: {
    issue: 'You wanted a small habit-tracker API: login, habits, streaks and a rate limit.',
    fixed: ['Login with signed tokens works', 'Streaks count days in your time zone'],
    holding: ['No test sends 101 requests to prove the rate limit'],
    trivia: 'The streak test failed first because days were counted in UTC, not your time zone.',
  },
  lessons: [
    {
      topic: 'Time zones in streaks', summary: 'Why a day depends on where you are',
      what: { title: 'A calendar day starts at a different moment in each time zone', body: 'Midnight in New York is 4 or 5 AM in UTC. Counting days in UTC moves late check-ins to the next day.', analogy: 'Like a shop that closes at a different hour in every city.', breaks: 'Shops can choose; time zones are fixed by place.' },
      where: { body: 'The streak function turns each check-in into a calendar date before counting.', file: 'src/lib/streak.ts' },
      did: { kind: 'choice', problem: 'An evening check-in in New York counted as the next day.', options: ['Count days in UTC', "Count days in the user's time zone", 'Store dates without times'], picked: 1, chose: "Count days in the user's time zone.", why: 'A streak is about the user\'s own days.', cost: 'Every check-in needs the user\'s time zone.' },
      takeaway: 'Count calendar days in the user\'s time zone, never in UTC.',
      next: 'Add a test for a check-in at 11:30 PM in Tokyo',
      check: { ask: 'Why did the streak test fail at first?', options: ['Days were counted in UTC', 'The database was empty', 'The token expired'], right: 0, why: 'UTC moved a late check-in to the next day.' },
    },
    {
      topic: 'JWT login', summary: 'How the API knows who you are',
      what: { title: 'A JWT is a signed note that says who you are', body: 'The server signs a small token at login. Each request sends it back, and the signature proves nobody changed it.' },
      where: { body: 'The token helpers sign at login and check on every habits request.', file: 'src/lib/token.ts' },
      did: { kind: 'step', what: 'Claude signed tokens with a secret from the environment.', why: 'A secret in the code would be shared with anyone who sees it.', evidence: 'JWT_SECRET is read from the environment' },
      takeaway: 'Keep signing secrets out of the code.',
      check: { ask: 'What proves a JWT was not changed?', options: ['Its signature', 'Its length', 'The time it was sent'], right: 0, why: 'Changing it breaks the signature.' },
    },
    {
      topic: 'Rate limiting', summary: 'Stopping one client from flooding the API',
      what: { title: 'A rate limit caps how many requests one client may send', body: 'After 100 requests in 15 minutes, the API answers 429 until the window passes.' },
      where: { body: 'The limiter runs on the habits routes before login is checked.', file: 'src/app.ts' },
      did: { kind: 'step', what: 'Claude limited the habits routes to 100 requests per 15 minutes.', why: 'To protect the API from one noisy client.' },
      takeaway: 'Behind a proxy, set trust proxy, or every user shares one limit.',
      check: { ask: 'What does the API answer over the limit?', options: ['429', '404', '500'], right: 0, why: '429 means too many requests.' },
    },
  ],
  final: [
    { ask: 'Why count streak days in the user\'s time zone?', options: ['A streak is about their own days', 'UTC is slower', 'It saves storage'], right: 0, why: 'Days belong to the user\'s clock.' },
    { ask: 'Where does the signing secret live?', options: ['In the environment', 'In the code', 'In the token'], right: 0, why: 'So it is not shared with the code.' },
  ],
};
