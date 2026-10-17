import { test, expect } from 'claude-code/testing'
import { tidyPaths, wasSummarized, approvalsOf, bugsOf, changesOf, checkKey, cleanPrompt, deletedOf, diffOf, envNamesOf, fileChangeOf, firstSentences, isCheck, packagesOf } from '../hooks/lib/extract'
import { MAX_NODES, dependentsOf, graphOf, importsOf, labelsOf, resolveImport } from '../hooks/lib/graph'
import { parseReply, shouldPrebake } from '../hooks/lib/prebake'
import type { Change, Msg } from '../types'
import { DISK, ROOT, SESSION, bash, claude, edit, user, write } from './fixture'

const read = (f: string) => Promise.resolve(DISK[f])

/* ---------- extract: prompts, sentences, diffs ---------- */

test('cleanPrompt strips harness noise and keeps the ask', () => {
  expect(cleanPrompt('<system-reminder>\nline one\nline two\n</system-reminder>\nAdd   a route.')).toBe('Add a route.')
  expect(cleanPrompt('<command-name>/review</command-name><command-args>auth</command-args> please')).toBe('please')
  expect(cleanPrompt('<ide_opened_file>The user opened /repo/src/app.ts in the IDE.</ide_opened_file>Fix the login bug')).toBe('Fix the login bug')
  expect(cleanPrompt('<b>bold</b> ask')).toBe('bold ask')
  // Comparisons and generics are words, not tags.
  expect(cleanPrompt('only when x < 3 and y > 2')).toBe('only when x < 3 and y > 2')
  expect(cleanPrompt('return a Promise<User> here')).toBe('return a Promise<User> here')
  expect(cleanPrompt('<system-reminder>only noise</system-reminder>')).toBe('')
})

test('firstSentences takes one or two sentences, without markdown', () => {
  expect(firstSentences("I'll set up the server. Then the database. Then auth.")).toBe("I'll set up the server. Then the database.")
  expect(firstSentences('## Plan\n**I added** `JWT_SECRET` to the env file. It signs tokens. More.')).toBe('Plan I added JWT_SECRET to the env file. It signs tokens.')
  expect(firstSentences('Done.')).toBeUndefined()
  expect(firstSentences('Version 1.2 now lives in src/app.ts for real. Ok then.')).toBe('Version 1.2 now lives in src/app.ts for real. Ok then.')
  expect(firstSentences('```ts\nconst a = 1\n```\nThis sentence has no code in it at all.')).toBe('This sentence has no code in it at all.')
  const long = firstSentences('word '.repeat(200), 50)!
  expect(long.length).toBeLessThanOrEqual(50)
  expect(long.endsWith('…')).toBe(true)
})

test('diffOf keeps one line of head and tail context', () => {
  expect(diffOf('1\n2\n3\nx\n5\n6', '1\n2\n3\ny\n5\n6')).toEqual([
    { op: ' ', text: '3' }, { op: '-', text: 'x' }, { op: '+', text: 'y' }, { op: ' ', text: '5' }])
  expect(diffOf('a', 'a\nb')).toEqual([{ op: ' ', text: 'a' }, { op: '+', text: 'b' }])
  expect(diffOf('a\nb', 'b')).toEqual([{ op: '-', text: 'a' }, { op: ' ', text: 'b' }])
  expect(diffOf('x\ny\nx', 'x\nx')).toEqual([{ op: ' ', text: 'x' }, { op: '-', text: 'y' }, { op: ' ', text: 'x' }])
})

test('fileChangeOf counts lines, caps the diff, and ignores non-edit tools', () => {
  expect(fileChangeOf('Write', { file_path: '/repo/a.ts', content: 'a\nb\n' }, ROOT)).toMatchObject({ file: 'a.ts', added: 2, removed: 0 })
  expect(fileChangeOf('Write', { file_path: '/repo/a.ts', content: '' }, ROOT)).toMatchObject({ added: 0 })
  const big = fileChangeOf('Write', { file_path: '/repo/big.ts', content: Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') }, ROOT)!
  expect(big.added).toBe(30)
  expect(big.diff).toHaveLength(14)
  expect(fileChangeOf('Edit', { file_path: '/elsewhere/x.ts', old_string: 'a', new_string: 'b' }, ROOT)?.file).toBe('/elsewhere/x.ts')
  expect(fileChangeOf('Edit', { file_path: '/repository/x.ts', old_string: 'a', new_string: 'b' }, ROOT)?.file).toBe('/repository/x.ts')
  expect(fileChangeOf('Read', { file_path: '/repo/a.ts' }, ROOT)).toBeUndefined()
  expect(fileChangeOf('Bash', { command: 'ls' }, ROOT)).toBeUndefined()
  expect(fileChangeOf('Edit', {}, ROOT)).toBeUndefined()
})

/* ---------- changesOf ---------- */

test('changesOf: one change per request with edits, cleaned asks, merged files', () => {
  const ch = changesOf(SESSION, ROOT)
  expect(ch.map(c => c.ask)).toEqual([
    'Set up an Express server for a habit tracker API, in TypeScript.',
    'Add a Prisma schema for users, habits and check-ins.',
    'Add auth: sign up and log in, with hashed passwords and JWT.',
    'Now add habit routes: create, list and check in.',
    'Show the current streak for each habit, and add a test for it.',
    'Reset the database, add the env file, and add rate limiting and input validation.',
  ])
  expect(ch.map(c => c.index)).toEqual([0, 1, 2, 3, 4, 5])
  expect(ch[0]!.said).toBe("I'll set up an Express server with a JSON body parser. Then we can add the database.")
  expect(ch[3]!.said).toBe('Adding the habit routes behind the auth check.')
  expect(ch[0]!.files.map(f => f.file)).toEqual(['package.json', 'src/server.ts', 'src/app.ts'])
  expect(ch.flatMap(c => c.files).every(f => !f.file.startsWith('/'))).toBe(true)
  // The errored Edit is ignored: app.ts got one line in the auth change.
  expect(ch[2]!.files.find(f => f.file === 'src/app.ts')).toMatchObject({ added: 1, removed: 0 })
  // MultiEdit diffs both edits.
  expect(ch[3]!.files.find(f => f.file === 'src/app.ts')).toMatchObject({ added: 3, removed: 0 })
  // Write then Edit of streak.ts merge into one entry.
  const streak = ch[4]!.files.filter(f => f.file === 'src/lib/streak.ts')
  expect(streak).toHaveLength(1)
  expect(streak[0]).toMatchObject({ added: 5, removed: 1 })
  expect(ch.map(c => c.added)).toEqual([11, 6, 12, 12, 6, 7])
  for (const c of ch) expect(c.added).toBe(c.files.reduce((n, f) => n + f.added, 0))
})

test('changesOf: interrupts, tool results and noise-only prompts are not requests', () => {
  const msgs: Msg[] = [
    user('Write the file.'),
    claude('', write('a.ts', 'a')),
    user('[Request interrupted by user for tool use]'),
    user('<system-reminder>noise</system-reminder>'),
    { role: 'user', text: 'tool output', toolUses: [], toolResults: [{ tool_use_id: 'x', text: 'ok', isError: false }] },
    claude('More edits for the same ask, still request one.', write('b.ts', 'b')),
  ]
  const ch = changesOf(msgs, ROOT)
  expect(ch).toHaveLength(1)
  expect(ch[0]!.files.map(f => f.file)).toEqual(['a.ts', 'b.ts'])
  expect(ch[0]!.said).toBe('More edits for the same ask, still request one.')
  // Edits before any visible request (after a summary) are kept, not dropped.
  expect(changesOf([claude('no prompt yet', write('a.ts', 'a'))], ROOT).map(c => c.ask)).toEqual(['Work continued from earlier in this session'])
})

/* ---------- bugsOf ---------- */

test('bugsOf finds the failing test, the fix and the passing rerun', () => {
  const bugs = bugsOf(SESSION, ROOT)
  expect(bugs).toHaveLength(1)
  const b = bugs[0]!
  expect(b.title).toBe('The test failed because the day was written in UTC')
  expect(b.failed).toBe('npm test')
  expect(b.verified).toBe('npm test')
  expect(b.error).toContain('✕ streak › counts late-night check-ins')
  expect(b.error).toContain('Expected: 3')
  expect(b.error).toContain('Received: 2')
  expect(b.why).toMatch(/^The test failed because the day was written in UTC\./)
  expect(b.fix.map(f => f.file)).toEqual(['src/lib/streak.ts'])
  expect(b.fix[0]).toMatchObject({ added: 1, removed: 1 })
  // changeIndex points into changesOf's list (the question with no edits is not a change).
  const ch = changesOf(SESSION, ROOT)
  expect(ch[b.changeIndex]!.ask).toMatch(/streak/)
})

const failRun = (cmd: string, out = 'FAIL x.test.ts\n  ✕ adds\n  Expected: 1\n  Received: 2') => bash(cmd, out, true)

test('bugsOf: no bug when the check never passes', () => {
  expect(bugsOf([user('fix it'), claude('', failRun('npm test')), claude('Because of x.', edit('a.ts', 'a', 'b')), claude('', failRun('npm test'))], ROOT)).toEqual([])
})

test('bugsOf: no bug when a failure has no edits before the pass', () => {
  expect(bugsOf([user('run'), claude('', failRun('npm test')), claude('', bash('npm test', 'Tests: 3 passed'))], ROOT)).toEqual([])
  // An errored edit is not a fix.
  expect(bugsOf([user('run'), claude('', failRun('npm test')), claude('', edit('a.ts', 'a', 'b', true)), claude('', bash('npm test', 'ok'))], ROOT)).toEqual([])
})

test('bugsOf keys different checks separately', () => {
  const bugs = bugsOf([
    user('make it green'),
    claude('', failRun('cd /repo && npm run lint', 'src/a.ts\n  3:1  error  Unexpected var  no-var\n✖ 1 problem')),
    claude('The linter wants const, not var.', edit('src/a.ts', 'var a = 1', 'const a = 1')),
    claude('', bash('cd /repo && npm test', 'Tests: 4 passed')),
    claude('', bash('npm run lint 2>&1 | tail -5', '')),
  ], ROOT)
  expect(bugs).toHaveLength(1)
  expect(bugs[0]).toMatchObject({ failed: 'npm run lint', verified: 'npm run lint', title: 'The linter wants const, not var' })
  expect(bugs[0]!.error.some(l => l.includes('Unexpected var'))).toBe(true)
})

test('bugsOf: a passing run that reports "0 failed" is a pass', () => {
  const bugs = bugsOf([
    user('fix the parser'),
    claude('', failRun('cargo test', "test parse ... FAILED\nthread 'parse' panicked\ntest result: FAILED. 2 passed; 1 failed")),
    claude('The parser skipped the last token.', edit('src/parse.rs', 'i < n - 1', 'i < n')),
    claude('', bash('cargo test', 'test result: ok. 3 passed; 0 failed; 0 ignored')),
  ], ROOT)
  expect(bugs).toHaveLength(1)
  expect(bugs[0]!.fix[0]!.file).toBe('src/parse.rs')
})

test('bugsOf prefers a sentence that names a cause, and keeps the first one', () => {
  const run = (...words: string[]) => bugsOf([
    user('fix login'),
    claude('', failRun('npm test')),
    ...words.map(w => claude(w)),
    claude('', edit('src/auth.ts', 'a', 'b')),
    claude('', bash('npm test', 'Tests: 2 passed')),
  ], ROOT)[0]!
  const b = run('Let me look at the auth code first.', 'I see. Login failed because JWT_SECRET was read before the env file loaded.', 'It also broke because of a typo.')
  expect(b.title).toBe('Login failed because JWT_SECRET was read before the env file loaded')
  expect(b.why).toBe('Login failed because JWT_SECRET was read before the env file loaded.')
  // No cause anywhere: the first words after the failure.
  expect(run('Let me look at the auth code first. Then fix it.').why).toBe('Let me look at the auth code first. Then fix it.')
  // Words after the fix do not count.
  expect(bugsOf([user('x'), claude('', failRun('npm test')), claude('', edit('a.ts', 'a', 'b')),
    claude('It failed because of the old import path.'), claude('', bash('npm test', 'ok'))], ROOT)[0]!.why).toBeUndefined()
})

test('bugsOf ignores git commands even when they mention tests', () => {
  expect(bugsOf([
    user('commit it'),
    claude('', bash('git commit -m "fix tests"', 'husky - pre-commit hook exited with code 1\nError: lint failed', true)),
    claude('The hook failed because of a lint error.', edit('src/a.ts', 'var', 'const')),
    claude('', bash('git commit -m "fix tests"', '[main 1a2b3c] fix tests')),
  ], ROOT)).toEqual([])
})

test('isCheck: test, build, lint and type-check runs, not paths or heredoc text', () => {
  for (const c of ['npm test', 'cd /repo && npm test', 'npm test 2>&1 | tail -20', 'CI=1 npx vitest run', 'pnpm run test:unit', 'yarn lint',
    'python -m pytest -q', 'uv run pytest', './gradlew build', 'go test ./...', 'cargo clippy', 'make test', 'prettier --check .', 'npx tsc --noEmit',
    'node_modules/.bin/jest', 'bun run build', "cat > ci.sh <<'EOF'\necho hi\nEOF\nnpm run lint"])
    expect([c, isCheck(c)]).toEqual([c, true])
  for (const c of ["cat >> services/x/tests/handlers/test_a.py <<'EOF'\ndef test_a():\n    assert check() && build()\nEOF",
    "python - <<'EOF'\nimport json  # check the test output\nprint('tests ok'); run_tests()\nEOF", "cat > ci.sh <<'EOF'\nnpm test && npm run build\nEOF",
    'ls tests/', 'prettier --write .', 'go run main.go', 'git commit -m "add tests"', 'npm install', 'node scripts/test.js', 'python tests/test_a.py',
    'echo test', 'cd tests', 'export TEST=1', 'source test.env', 'cat build.log'])
    expect([c, isCheck(c)]).toEqual([c, false])
})

test('checkKey keys on the check segment', () => {
  expect(checkKey('cd /repo && npm test')).toBe('npm test')
  expect(checkKey('npm test 2>&1 | tail -5')).toBe('npm test')
  expect(checkKey('CI=1 npm test -- streak')).toBe('npm test')
  expect(checkKey("cat > a.sh <<'EOF'\nnpm test\nEOF\nnpm run lint")).toBe('npm run lint')
  expect(checkKey('cd api && go test ./...')).toBe('go test ./...')
})

test('deletedOf: recursive rm targets, scratch dropped', () => {
  expect(deletedOf('rm -rf viz34 viz34.tgz')).toEqual(['viz34'])
  expect(deletedOf('sudo rm -r legacy/ && rm -fr docs/old; rm -Rf vendor')).toEqual(['legacy/', 'docs/old', 'vendor'])
  expect(deletedOf('rm file.txt')).toEqual([])
  expect(deletedOf('git rm -r --cached secrets')).toEqual([])
  expect(deletedOf('rm -rf -- "src/old"')).toEqual(['src/old'])
  expect(deletedOf('rm -rf old > /dev/null 2>&1')).toEqual(['old'])
  for (const c of ['rm -rf /tmp/fcache_smoke', 'rm -rf $SP/code_s21', 'rm -rf e6_cache', 'rm -rf $S/cache_test_*', 'find . -name "*.pyc" -exec rm -rf {} + 2>/dev/null',
    'find . -exec rm -rf {} \;', 'rm -rf -- "$p"', 'rm -rf ${TMPDIR}/z /private/tmp/x /var/folders/ab/T/y',
    'rm -rf node_modules dist build .next out coverage __pycache__ .pytest_cache .DS_Store a.tar b.zip src/.cache/'])
    expect([c, deletedOf(c)]).toEqual([c, []])
})

test('approvalsOf groups deletions into one entry, and none when all were scratch', () => {
  const scratch = ['rm -rf /tmp/fcache_smoke', 'rm -rf $SP/code_s21', 'rm -rf e6_cache', 'rm -rf $S/cache_test_*', 'find . -exec rm -rf {} + 2>/dev/null', 'rm -rf -- "$p"', 'rm -rf viz34.tgz']
  expect(approvalsOf([claude('', ...scratch.map(c => bash(c)))]).filter(a => a.kind === 'command')).toEqual([])
  const a = approvalsOf([claude('', ...scratch.map(c => bash(c)), bash('rm -rf old1 old2 old3'), bash('sudo rm -r legacy/'), bash('rm -fr docs/old && rm -Rf vendor'),
    bash('rm -rf old1'), bash('rm -rf important', '', true), bash('rm -rf viz34'))])
  expect(a).toEqual([{ risk: 'high', kind: 'command', what: 'Deleted 7 folders or files for good',
    say: 'Removed: old1, old2, old3, legacy/, docs/old, and 2 more. They do not go to the trash.' }])
})

/* ---------- packages, env, approvals ---------- */

const names = (cmd: string) => packagesOf(cmd).map(p => p.name)

test('packagesOf reads names from every installer, dropping flags and versions', () => {
  expect(names('npm install bcrypt jsonwebtoken')).toEqual(['bcrypt', 'jsonwebtoken'])
  expect(names('npm i -D typescript@5.4.2 @types/node')).toEqual(['typescript', '@types/node'])
  expect(names('yarn add react@^18.2.0 zod@latest')).toEqual(['react', 'zod'])
  expect(names('bun add hono')).toEqual(['hono'])
  expect(packagesOf('pnpm add -g @scope/cli@1.0.0')).toEqual([{ name: '@scope/cli', global: true }])
  expect(packagesOf('npm install --global vercel')).toEqual([{ name: 'vercel', global: true }])
  expect(packagesOf('npm i lodash')[0]!.global).toBe(false)
  expect(names('pip install requests==2.31.0 "flask>=2.0" -r requirements.txt')).toEqual(['requests', 'flask'])
  expect(names('pip3 install -e . "fastapi[all]"')).toEqual(['fastapi'])
  expect(names('uv add httpx')).toEqual(['httpx'])
  expect(names('uv pip install pydantic')).toEqual(['pydantic'])
  expect(names('cargo add serde --features derive')).toEqual(['serde'])
  expect(names('go get github.com/gin-gonic/gin@v1.9.1')).toEqual(['github.com/gin-gonic/gin'])
  expect(names('brew install --cask docker')).toEqual(['docker'])
  expect(names('npm install zod 2>&1 | tail -5')).toEqual(['zod'])
  expect(names('npm install && npm run build')).toEqual([])
  expect(names('npm test')).toEqual([])
  expect(names('npm install a && pip install b')).toEqual(['a', 'b'])
})

test('envNamesOf returns names, never values', () => {
  const text = 'JWT_SEC' + 'RET=fake-value-123\n# COMMENTED=1\nexport API_' + 'KEY="fake-key"\n  PORT = 3000\nlower=1\n'   // split so secret scanners don't flag the test
  const got = envNamesOf(text)
  expect(got).toEqual(['JWT_SECRET', 'API_KEY', 'PORT'])
  expect(JSON.stringify(got).includes('fake')).toBe(false)
})

test('approvalsOf on the session: high first, migration todo, secrets, packages', () => {
  const a = approvalsOf(SESSION, { root: ROOT })
  const order = { high: 0, med: 1, low: 2 }
  for (let i = 1; i < a.length; i++) expect(order[a[i - 1]!.risk]).toBeLessThanOrEqual(order[a[i]!.risk])
  expect(a[0]).toMatchObject({ risk: 'high', kind: 'migration', what: 'Erased a database (prisma migrate reset)' })
  expect(a[0]!.todo).toBeDefined()
  const secrets = a.filter(x => x.kind === 'secret').map(x => x.what)
  expect(secrets).toEqual(['Created a secret (JWT_SECRET in .env)', 'Created a secret (DATABASE_URL in .env)'])
  expect(JSON.stringify(a).includes('fake-dev-secret')).toBe(false)
  expect(a.filter(x => x.kind === 'package').map(x => x.what)).toEqual(
    ['express', 'prisma', '@prisma/client', 'bcrypt', 'jsonwebtoken', 'express-rate-limit', 'zod'].map(n => `Installed ${n}`))
  expect(a.find(x => x.what === 'Changed the database structure (prisma migrate dev)')?.risk).toBe('low')
})

test('approvalsOf: dangerous commands, dedupe, describe, errors skipped', () => {
  const a = approvalsOf([
    claude('', bash('rm -rf src/legacy && npm run build'), bash('git push --force origin main'), bash('git push origin main'),
      bash('npm install zod'), bash('npm install zod'), bash('rm -rf /', '', true), bash('npm i -g vercel')),
  ], { describe: p => (p === 'zod' ? 'Checks that data has the right shape.' : undefined) })
  expect(a.map(x => [x.risk, x.what])).toEqual([
    ['high', 'Force-pushed to git'], ['high', 'Deleted 1 folder or file for good'],
    ['med', 'Installed vercel for the whole computer'],
    ['low', 'Pushed to git'], ['low', 'Installed zod'],
  ])
  expect(a.find(x => x.what === 'Installed zod')!.say).toMatch(/^Checks that data has the right shape\. Packages are/)
})

test('approvalsOf: secrets in .env variants but not in example files', () => {
  const a = approvalsOf([claude('',
    write('.env.local', 'STRIPE_KEY=fake\n'), write('config/.env.example', 'OTHER_SECRET=\n'), write('.env.sample', 'SAMPLE_TOKEN=\n'),
    edit('.env', 'PORT=1', 'PORT=1\nSESSION_SECRET=fake'), write('notenv.txt', 'A_SECRET=fake'))], { root: ROOT })
  expect(a.map(x => x.what)).toEqual(['Created a secret (STRIPE_KEY in .env.local)', 'Created a secret (SESSION_SECRET in .env)'])
})

test('approvalsOf: new permissions, broad ones high', () => {
  const a = approvalsOf([], { newPermissions: ['Bash(npm run test:*)', 'Bash(*)', 'Bash(npm:*)', 'Bash(rm -rf:*)', 'Bash', 'Read(src/**)', 'Bash(*)'] })
  const risk = Object.fromEntries(a.map(x => [x.what.replace(/^Let Claude run | without asking$/g, ''), x.risk]))
  expect(risk).toEqual({ 'Bash(*)': 'high', 'Bash(npm:*)': 'high', 'Bash(rm -rf:*)': 'high', Bash: 'high', 'Bash(npm run test:*)': 'med', 'Read(src/**)': 'med' })
  expect(a).toHaveLength(6)
  expect(a.every(x => x.kind === 'permission')).toBe(true)
})

/* ---------- graph ---------- */

test('importsOf finds relative JS/TS imports of every shape', () => {
  const src = [
    `import { a } from './a'`,
    `import b from "../b.js"`,
    `import type { T } from './types'`,
    `import {\n  x,\n  y,\n} from './multi'`,
    `export * from './re'`,
    `export { z } from './z'`,
    `const m = await import('./dyn')`,
    `const r = require('./req')`,
    `import './side.css'`,
    `import cfg from '..'`,
    `import express from 'express'`,
    `const s = require('fs')`,
  ].join('\n')
  expect(importsOf('src/x.ts', src)).toEqual(['./a', '../b.js', './types', './multi', './re', './z', './dyn', './req', './side.css', '..'])
})

test('importsOf reads python relative imports', () => {
  const py = 'from .models import User\nfrom ..core.db import session\nfrom . import views, utils as u\nfrom . import (\n    forms,\n    admin,\n)\nimport os\nfrom app.x import y\n'
  expect(importsOf('app/api/views.py', py)).toEqual(['.models', '..core.db', '.', '.views', '.utils', '.', '.forms', '.admin'])
})

test('resolveImport handles extensions, index files, parents and python dots', () => {
  const files = ['src/index.ts', 'src/app.ts', 'src/routes/index.ts', 'src/lib/token.ts', 'src/ui/Button.tsx', 'app/__init__.py', 'app/models.py', 'app/views.py', 'app/core/db.py']
  expect(resolveImport('src/app.ts', './lib/token', files)).toBe('src/lib/token.ts')
  expect(resolveImport('src/app.ts', './lib/token.js', files)).toBe('src/lib/token.ts')
  expect(resolveImport('src/app.ts', './lib/token.ts', files)).toBe('src/lib/token.ts')
  expect(resolveImport('src/app.ts', './routes', files)).toBe('src/routes/index.ts')
  expect(resolveImport('src/routes/index.ts', '../app', files)).toBe('src/app.ts')
  expect(resolveImport('src/routes/index.ts', '..', files)).toBe('src/index.ts')
  expect(resolveImport('src/routes/index.ts', '../ui/Button.jsx', files)).toBe('src/ui/Button.tsx')
  expect(resolveImport('src/app.ts', './missing', files)).toBeUndefined()
  expect(resolveImport('app/api.py', '.models', files)).toBe('app/models.py')
  expect(resolveImport('app/api/routes.py', '..core.db', files)).toBe('app/core/db.py')
  expect(resolveImport('app/api.py', '.', files)).toBe('app/__init__.py')
  expect(resolveImport('app/api.py', '.views', files)).toBe('app/views.py')
})

test('labelsOf: file names, longer only where needed, always unique', () => {
  expect(labelsOf(['src/routes/index.ts', 'src/lib/index.ts', 'src/app.ts'])).toEqual(
    { 'src/routes/index.ts': 'routes/index.ts', 'src/lib/index.ts': 'lib/index.ts', 'src/app.ts': 'app.ts' })
  const deep = labelsOf(['api/x/index.ts', 'admin/x/index.ts', 'y.ts'])
  expect(deep).toEqual({ 'api/x/index.ts': 'api/x/index.ts', 'admin/x/index.ts': 'admin/x/index.ts', 'y.ts': 'y.ts' })
  expect(labelsOf([])).toEqual({})
})

test('graphOf maps the code files and their imports', async () => {
  const g = await graphOf(changesOf(SESSION, ROOT), read)
  expect(g.nodes.map(n => n.id).sort()).toEqual(Object.keys(DISK).sort())
  expect(g.nodes.find(n => n.id === 'src/app.ts')).toMatchObject({ label: 'app.ts', added: 9 })
  const want: Array<[string, string]> = [
    ['src/server.ts', 'src/db.ts'], ['src/server.ts', 'src/app.ts'],
    ['src/app.ts', 'src/routes/auth.ts'], ['src/app.ts', 'src/routes/habits.ts'],
    ['src/routes/auth.ts', 'src/db.ts'], ['src/routes/auth.ts', 'src/lib/token.ts'],
    ['src/middleware/requireAuth.ts', 'src/lib/token.ts'],
    ['src/routes/habits.ts', 'src/db.ts'], ['src/routes/habits.ts', 'src/middleware/requireAuth.ts'], ['src/routes/habits.ts', 'src/lib/streak.ts'],
    ['src/lib/streak.test.ts', 'src/lib/streak.ts'],
  ]
  expect(g.edges).toHaveLength(want.length)
  for (const e of want) expect(g.edges).toContainEqual(e)
  for (const n of g.nodes) {
    expect(n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1).toBe(true)
  }
  expect(await graphOf(changesOf(SESSION, ROOT), read)).toEqual(g)
})

test('graphOf caps nodes, skips self edges and unreadable files', async () => {
  const many: Change[] = [{ index: 0, ask: 'x', added: 0, files: Array.from({ length: 25 }, (_, i) => ({ file: `src/f${i}.ts`, added: i + 1, removed: 0, diff: [] })) }]
  many[0]!.files.push({ file: 'README.md', added: 999, removed: 0, diff: [] })
  const g = await graphOf(many, f => (f === 'src/f24.ts' ? Promise.resolve(`import './f24'\nimport './f23'`) : f === 'src/f23.ts' ? Promise.reject(new Error('gone')) : Promise.resolve(undefined)))
  expect(g.nodes).toHaveLength(MAX_NODES)
  expect(g.nodes[0]!.id).toBe('src/f24.ts')
  expect(g.nodes.some(n => n.id === 'src/f0.ts' || n.id === 'README.md')).toBe(false)
  expect(g.edges).toEqual([['src/f24.ts', 'src/f23.ts']])
  for (const n of g.nodes) expect(Number.isFinite(n.x) && n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1).toBe(true)
  const one = await graphOf([{ index: 0, ask: 'x', added: 1, files: [{ file: 'a.py', added: 1, removed: 0, diff: [] }] }], () => Promise.resolve(''))
  expect(one.nodes[0]).toMatchObject({ x: 0.5, y: 0.5 })
  expect(await graphOf([], read)).toEqual({ nodes: [], edges: [] })
})

test('dependentsOf: direct importers, then importers of those', async () => {
  const g = await graphOf(changesOf(SESSION, ROOT), read)
  const t = dependentsOf(g, 'src/lib/token.ts')
  expect(t.direct.sort()).toEqual(['src/middleware/requireAuth.ts', 'src/routes/auth.ts'])
  expect(t.indirect.sort()).toEqual(['src/app.ts', 'src/routes/habits.ts'])
  const db = dependentsOf(g, 'src/db.ts')
  expect(db.direct.sort()).toEqual(['src/routes/auth.ts', 'src/routes/habits.ts', 'src/server.ts'])
  expect(db.indirect).toEqual(['src/app.ts'])
  expect(dependentsOf(g, 'src/server.ts')).toEqual({ direct: [], indirect: [] })
})

/* ---------- prebake ---------- */

test('parseReply tolerates fences and stray text, rejects garbage', () => {
  expect(parseReply('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  expect(parseReply('Sure! {"a":{"b":[1,2]}} Hope that helps {:)}')).toEqual({ a: { b: [1, 2] } })
  expect(parseReply('{"s":"a } brace and \\" quote {"}')).toEqual({ s: 'a } brace and " quote {' })
  expect(parseReply('I use {braces} first, then {"a":1}')).toEqual({ a: 1 })
  expect(parseReply('no json here')).toBeUndefined()
  expect(parseReply('{not json}')).toBeUndefined()
  expect(parseReply('{"a":')).toBeUndefined()
  expect(parseReply('')).toBeUndefined()
  expect(parseReply('an unclosed { then {"a":1}')).toEqual({ a: 1 })
})

test('shouldPrebake gates on every condition', () => {
  const ok = { enabled: true, percentUsed: 90, threshold: 85, windowKey: '2026-10-15T11:00:00Z', doneFor: '', turns: 3, inFlight: false }
  expect(shouldPrebake(ok)).toBe(true)
  expect(shouldPrebake({ ...ok, percentUsed: 85 })).toBe(true)
  expect(shouldPrebake({ ...ok, doneFor: undefined })).toBe(true)
  expect(shouldPrebake({ ...ok, enabled: false })).toBe(false)
  expect(shouldPrebake({ ...ok, inFlight: true })).toBe(false)
  expect(shouldPrebake({ ...ok, percentUsed: 84.9 })).toBe(false)
  expect(shouldPrebake({ ...ok, percentUsed: 100 })).toBe(false)
  expect(shouldPrebake({ ...ok, doneFor: ok.windowKey })).toBe(false)
  expect(shouldPrebake({ ...ok, turns: 2 })).toBe(false)
})

/* ---------- found on a real transcript ---------- */

test('injected user rows are not requests: skills, agent reports, notices', () => {
  const msgs: Msg[] = [
    user('Add a health check endpoint'),
    claude('Adding it.', write('src/health.ts', 'export const ok = true\n')),
    user('Base directory for this skill: /x\n\n# Some skill'),
    user('Another Claude session sent a message: [Subagent hand-back] done'),
    claude('Updating the route.', edit('src/health.ts', 'export const ok = true', 'export const ok = 1')),
  ]
  const ch = changesOf(msgs, ROOT)
  expect(ch).toHaveLength(1)
  expect(ch[0]!.ask).toBe('Add a health check endpoint')
  expect(ch[0]!.files[0]!.added).toBe(2)
})

test('lowercase "(fail)" test output counts as a failure', () => {
  const msgs: Msg[] = [
    user('Fix the parser'),
    claude('Running tests.', bash('bun test', '(fail) parses dates [1ms]\n 3 pass\n 1 fail')),
    claude('The parser fails because it splits on spaces.', edit('src/parse.ts', 'split(" ")', 'split(/\\s+/)')),
    claude('Again.', bash('bun test', ' 4 pass\n 0 fail')),
  ]
  const bugs = bugsOf(msgs, ROOT)
  expect(bugs).toHaveLength(1)
  expect(bugs[0]!.title).toMatch(/splits on spaces/)
})

test('npx -y is listed as an approval; files outside the project stay off the map', async () => {
  const ap = approvalsOf([claude('', bash('npx -y -p typescript@5.6.3 tsc -p .'))], { root: ROOT })
  expect(ap[0]!.risk).toBe('med')
  const g = await graphOf([{ index: 0, ask: 'x', files: [{ file: '/tmp/scratch.ts', added: 5, removed: 0, diff: [] }, { file: 'src/a.ts', added: 3, removed: 0, diff: [] }], added: 8 }], read)
  expect(g.nodes.map(n => n.id)).toEqual(['src/a.ts'])
})

test('tidyPaths keeps home folders out of view and shortens project paths', () => {
  expect(tidyPaths('use the logo at /Users/someone/work/app/assets/logo.mov please', '/Users/someone/work/app')).toBe('use the logo at assets/logo.mov please')
  expect(tidyPaths('see /Users/someone/Downloads/brief.pdf', '/repo')).toBe('see …/brief.pdf')
  expect(tidyPaths('nothing to change here', '/repo')).toBe('nothing to change here')
})

test('a cause explained only in the summary after the passing run still names the bug', () => {
  const msgs: Msg[] = [
    user('Add streak counting and a New York test'),
    claude('', write('src/lib/streak.ts', 'export const streak = () => 1\n'), bash('npm test 2>&1 | tail -30', ' FAIL  src/lib/streak.test.ts\n AssertionError: expected 1 to be 2', true)),
    claude('', write('src/lib/streak.ts', 'export const streak = () => 2\n'), bash('npm test 2>&1 | tail -15', ' Test Files  2 passed (2)')),
    claude('Streak counting now works. - **First run:** the test failed with `expected 1 to be 2`. The cause is the one I gave above: the UTC date puts Tuesday 9 PM New York check-in on Wednesday. - **Fix:** days are counted in the user time zone.'),
  ]
  const [b] = bugsOf(msgs, ROOT)
  expect(b!.title).toBe('The UTC date puts Tuesday 9 PM New York check-in on Wednesday')
  expect(b!.why).toMatch(/UTC date puts/)
})

test('edits after a summary still count, under a "continued" request', () => {
  const msgs: Msg[] = [
    user('This session is being continued from a previous conversation that ran out of context. Summary: ...'),
    claude('Picking up where we left off.', edit('src/a.ts', 'let a = 1', 'const a = 1')),
  ]
  const ch = changesOf(msgs, ROOT)
  expect(ch).toHaveLength(1)
  expect(ch[0]!.ask).toBe('Work continued from earlier in this session')
  expect(wasSummarized(msgs)).toBe(true)
})
