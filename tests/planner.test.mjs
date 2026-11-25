import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { planUnit, validateUnit, digest } from '../src/planner.mjs';
function fixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'release-fixture-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(resolve(cwd, '.release')); mkdirSync(resolve(cwd, 'app')); mkdirSync(resolve(cwd, 'other'));
  const unit = { schema: 1, unit: 'app', versioning: 'semantic-release', branch: 'main', tag_prefix: 'app-v', auto_on_main: true, prerelease: 'preview', paths: ['app/**'], ignore: ['**/*.md'] };
  writeFileSync(resolve(cwd, '.release/app.json'), JSON.stringify(unit) + '\n');
  const commit = (message, path = 'app/file') => { writeFileSync(resolve(cwd, path), message); git('add', '.'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  commit('chore: initialize'); git('tag', 'app-v1.0.0');
  return { cwd, git, commit, plan: (preview = false) => planUnit({ cwd, manifestPath: '.release/app.json', repository: 'fixture/app', preview }) };
}
test('semantic-release accumulates scoped changes, skips docs and preserves the checkout', async t => {
  const { cwd, git, commit, plan } = fixture(t);
  commit('feat(other): add another product', 'other/file');
  assert.equal((await plan()).status, 'unchanged');
  commit('docs(app): explain setup', 'app/README.md');
  assert.equal((await plan()).status, 'unchanged');
  commit('fix(app): preserve state');
  const patch = await plan(); assert.equal(patch.version, '1.0.1'); assert.match(patch.notes, /preserve state/);
  assert.equal(patch.manifest_sha, digest(readFileSync(resolve(cwd, '.release/app.json'))));
  commit('feat(app): add export');
  const minor = await plan(); assert.equal(minor.version, '1.1.0'); assert.match(minor.notes, /preserve state/); assert.match(minor.notes, /add export/); assert.doesNotMatch(minor.notes, /another product/);
  assert.equal(git('tag'), 'app-v1.0.0'); assert.equal(git('status', '--porcelain'), '');
  assert.equal(git('rev-parse', 'HEAD'), minor.source_sha);
  assert.match(minor.notes, /https:\/\/github.com\/fixture\/app/);
});
test('breaking headers and footers select major versions', async t => {
  const { commit, plan } = fixture(t);
  commit('fix(app)!: replace the API'); assert.equal((await plan()).version, '2.0.0');
  commit('feat(app): change defaults\n\nBREAKING CHANGE: clients must pass a mode'); assert.equal((await plan()).version, '2.0.0');
});
test('preview tags increment and a stable promotion consumes the same history', async t => {
  const { git, commit, plan } = fixture(t);
  commit('feat(app): add export');
  const first = await plan(true); assert.equal(first.version, '1.1.0-preview.1'); git('tag', '-a', first.tag, '-m', JSON.stringify({ ...first, kind: 'semantic-release' }));
  commit('fix(app): repair export');
  const second = await plan(true); assert.equal(second.version, '1.1.0-preview.2'); git('tag', '-a', second.tag, '-m', JSON.stringify({ ...second, kind: 'semantic-release' }));
  assert.equal((await plan(false)).version, '1.1.0');
  git('tag', 'app-v1.1.0');
  commit('fix(app): preserve selection'); assert.equal((await plan(true)).version, '1.1.1-preview.1');
});
test('unit policy, wrong checkout and shallow history fail closed', async t => {
  const { cwd, git, plan } = fixture(t);
  for (const change of [{ versioning: 'manual' }, { tag_prefix: '.*' }, { branch: '../bad' }, { paths: [] }, { ignore: ['../*'] }])
    assert.throws(() => validateUnit({ schema: 1, unit: 'app', versioning: 'semantic-release', branch: 'main', tag_prefix: 'v', auto_on_main: false, ...change }));
  await assert.rejects(planUnit({ cwd, manifestPath: '.release/app.json', repository: 'fixture/app', sourceSha: 'a'.repeat(40) }), /Checkout/);
  writeFileSync(resolve(cwd, '.git/shallow'), git('rev-parse', 'HEAD') + '\n'); await assert.rejects(plan(), /Full Git history/);
});
test('the shipped action plans without credentials or consumer mutations', t => {
  const { cwd, git, commit } = fixture(t); const sha = commit('fix(app): preserve state');
  git('update-ref', 'refs/remotes/origin/main', sha);
  const output = resolve(cwd, '.git/action-output'), receipt = resolve(cwd, '.git/receipt.json');
  execFileSync(process.execPath, [new URL('../src/action.mjs', import.meta.url).pathname], { cwd,
    env: { ...process.env, GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/app', GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output,
      RELEASE_DRY_RUN: 'true', RELEASE_MANIFEST_DIRECTORY: '.release', RELEASE_RECEIPT_FILE: receipt,
      RELEASE_TAG_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '' }, stdio: 'pipe' });
  assert.match(readFileSync(output, 'utf8'), /tags=\["app-v1.0.1"\]/);
  assert.equal(JSON.parse(readFileSync(receipt)).status, 'verified'); assert.equal(git('status', '--porcelain'), '');
});
