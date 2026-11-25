import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, renameSync, symlinkSync, existsSync } from 'node:fs';
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
for (const [name, message] of [['header', 'fix(app)!: replace the API'], ['footer', 'feat(app): change defaults\n\nBREAKING CHANGE: clients must pass a mode']]) test(`a breaking ${name} independently selects a major version`, async t => {
  const { commit, plan } = fixture(t);
  commit(message); assert.equal((await plan()).version, '2.0.0');
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
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'app-v1.0.0^{commit}'));
  const output = resolve(cwd, '.git/action-output'), receipt = resolve(cwd, '.git/receipt.json');
  execFileSync(process.execPath, [new URL('../src/action.mjs', import.meta.url).pathname], { cwd,
    env: { ...process.env, GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/app', GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output,
      RELEASE_DRY_RUN: 'true', RELEASE_MANIFEST_DIRECTORY: '.release', RELEASE_RECEIPT_FILE: receipt,
      RELEASE_TAG_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '' }, stdio: 'pipe' });
  assert.match(readFileSync(output, 'utf8'), /tags=\["app-v1.0.1"\]/);
  assert.equal(JSON.parse(readFileSync(receipt)).status, 'verified'); assert.equal(git('status', '--porcelain'), '');
});
test('a timestamp preview adapter retains installed-client discovery while core owns versions', async t => {
  const { cwd, git, commit, plan } = fixture(t);
  const file = resolve(cwd, '.release/app.json'), unit = JSON.parse(readFileSync(file));
  unit.preview_tag_compatibility = 'timestamp'; writeFileSync(file, JSON.stringify(unit) + '\n');
  commit('feat(app): add export');
  const { previewCompatibilityPlan } = await import('../src/tags.mjs');
  const first = await plan(true), timestamp = git('log', '-1', '--format=%ct');
  const compatible = previewCompatibilityPlan(first, timestamp);
  assert.match(compatible.tag, /^app-v1\.1\.0\.[1-9][0-9]*-[a-f0-9]{7}$/);
  git('tag', '-a', compatible.tag, '-m', JSON.stringify(compatible));
  commit('fix(app): preserve selection');
  assert.equal((await plan(true)).version, '1.1.0-preview.2');
  assert.equal((await plan(false)).version, '1.1.0');
  assert.equal(git('tag', '--list', '*-preview.*'), '');
});
test('unit planning does not load or execute a product semantic-release configuration', async t => {
  const { cwd, commit, plan } = fixture(t);
  writeFileSync(resolve(cwd, 'release.config.mjs'), "throw new Error('Product configuration must not execute in unit planning');\n");
  commit('fix(app): preserve state');
  assert.equal((await plan()).version, '1.0.1');
});

test('preview history survives a manifest move and rejects invalid historical paths', async t => {
  const { cwd, git, commit, plan } = fixture(t);
  commit('feat(app): add export');
  const first = await plan(true);
  git('tag', '-a', first.tag, '-m', JSON.stringify({ ...first, kind: 'semantic-release' }));
  renameSync(resolve(cwd, '.release/app.json'), resolve(cwd, '.release/moved.json'));
  commit('fix(app): repair export');
  const moved = preview => planUnit({ cwd, manifestPath: '.release/moved.json', repository: 'fixture/app', preview });
  assert.equal((await moved(true)).version, '1.1.0-preview.2');
  assert.equal((await moved(false)).version, '1.1.0');
  git('tag', '-d', first.tag);
  git('tag', '-a', first.tag, first.source_sha, '-m', JSON.stringify({ ...first, kind: 'semantic-release', manifest_path: '../outside.json' }));
  await assert.rejects(moved(true), /manifest path/);
});
test('merge commits include only changes against the release branch first parent', async t => {
  const { git, commit, plan } = fixture(t);
  git('switch', '-c', 'other-feature'); commit('feat(other): add another product', 'other/file');
  git('switch', 'main'); commit('fix(app): repair state'); git('tag', 'app-v1.0.1');
  git('merge', '--no-ff', 'other-feature', '-m', 'feat(other): integrate unrelated product');
  assert.equal((await plan()).status, 'unchanged');
  git('switch', '-c', 'app-feature'); commit('chore(app): add export implementation');
  git('switch', 'main'); git('merge', '--no-ff', 'app-feature', '-m', 'feat(app): add export');
  assert.equal((await plan()).version, '1.1.0');
});

test('disabled units on another branch do not block automatic releases or branch-tip checks', async t => {
  const { cwd, git, commit } = fixture(t);
  writeFileSync(resolve(cwd, '.release/other.json'), JSON.stringify({ schema: 1, unit: 'other', versioning: 'semantic-release', branch: 'release', tag_prefix: 'other-v', auto_on_main: false, paths: ['other/**'] }));
  const sha = commit('fix(app): preserve state');
  git('update-ref', 'refs/remotes/origin/main', sha);
  git('update-ref', 'refs/remotes/origin/release', git('rev-parse', 'app-v1.0.0^{commit}'));
  const requests = []; let ref, object;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    requests.push(request.method + ' ' + request.url);
    const send = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    const base = '/repos/fixture/app/git';
    if (request.url === base + '/ref/heads/main') return send({ object: { type: 'commit', sha } });
    if (request.url === base + '/ref/tags/app-v1.0.1-preview.1') return ref ? send(ref) : send({}, 404);
    if (request.method === 'POST' && request.url === base + '/tags') {
      object = { message: body.message, object: { type: body.type, sha: body.object } }; return send({ sha: 'd'.repeat(40) });
    }
    if (request.method === 'POST' && request.url === base + '/refs') {
      ref = { object: { type: 'tag', sha: 'd'.repeat(40) } }; return send(ref);
    }
    if (request.url === base + '/tags/' + 'd'.repeat(40)) return send(object);
    send({}, 500);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const receipt = resolve(cwd, '.git/receipt.json');
  const child = spawn(process.execPath, [new URL('../src/action.mjs', import.meta.url).pathname], { cwd, env: { ...process.env,
    GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/app', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main',
    GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_OUTPUT: resolve(cwd, '.git/output'),
    RELEASE_DRY_RUN: 'false', RELEASE_MANIFEST: '', RELEASE_MANIFEST_DIRECTORY: '.release', RELEASE_RECEIPT_FILE: receipt,
    RELEASE_TAG_TOKEN: 'fixture-token', GH_TOKEN: '', GITHUB_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill()); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, stderr);
  const result = JSON.parse(readFileSync(receipt));
  assert.equal(result.status, 'created'); assert.equal(result.results.find(p => p.unit === 'other').status, 'disabled');
  assert.equal(result.results.find(p => p.unit === 'app').tag, 'app-v1.0.1-preview.1');
  assert.equal(requests.filter(p => p.includes('/ref/heads/')).length, 1);
  assert.ok(requests.every(p => !p.includes('/heads/release')));
  assert.equal(git('tag'), 'app-v1.0.0'); assert.equal(git('status', '--porcelain'), '');
});

for (const preview of [false, true]) test(`an existing ${preview ? 'preview' : 'stable'} plan at the source survives an interrupted receipt write`, async t => {
  const { git, commit, plan } = fixture(t);
  commit('feat(app): add export');
  const first = await plan(preview);
  git('tag', '-a', first.tag, '-m', JSON.stringify({ ...first, kind: 'semantic-release' }));
  const retry = await plan(preview);
  assert.equal(retry.status, 'exists'); assert.equal(retry.tag, first.tag); assert.equal(retry.version, first.version);
  assert.equal(retry.notes, first.notes); assert.equal(retry.source_sha, first.source_sha); assert.equal(retry.created, false);
  git('tag', '-d', first.tag);
  git('tag', '-a', first.tag, first.source_sha, '-m', JSON.stringify({ ...first, kind: 'semantic-release', manifest_sha: 'f'.repeat(64) }));
  await assert.rejects(plan(preview), /provenance/);
});
test('a legacy baseline with no releasable changes remains unchanged', async t => {
  const { git, plan } = fixture(t);
  assert.equal((await plan()).status, 'unchanged');
  for (const message of ['Legacy release notes', 'null', '{}']) {
    git('tag', '-d', 'app-v1.0.0'); git('tag', '-a', 'app-v1.0.0', '-m', message);
    assert.equal((await plan()).status, 'unchanged');
  }
});
test('a stable action retry reports the original tag and validates the remote without new writes', async t => {
  const { cwd, git, commit, plan } = fixture(t); const sha = commit('fix(app): preserve state');
  const first = await plan(); const saved = { ...first, kind: 'semantic-release' };
  git('tag', '-a', first.tag, '-m', JSON.stringify(saved)); git('update-ref', 'refs/remotes/origin/main', sha);
  const requests = []; let conflict = false;
  const server = createServer((request, response) => {
    requests.push(request.method + ' ' + request.url);
    const send = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    const base = '/repos/fixture/app/git';
    if (request.method !== 'GET') return send({}, 500);
    if (request.url === base + '/ref/heads/main') return send({ object: { type: 'commit', sha } });
    if (request.url === base + '/ref/tags/' + first.tag) return send({ object: { type: 'tag', sha: 'd'.repeat(40) } });
    if (request.url === base + '/tags/' + 'd'.repeat(40)) return send({ message: JSON.stringify(saved), object: { type: 'commit', sha: conflict ? 'f'.repeat(40) : sha } });
    send({}, 500);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const receipt = resolve(cwd, '.git/retry-receipt'), output = resolve(cwd, '.git/retry-output');
  const run = async () => {
    const child = spawn(process.execPath, [new URL('../src/action.mjs', import.meta.url).pathname], { cwd, env: { ...process.env,
      GITHUB_SHA: sha, GITHUB_REPOSITORY: 'fixture/app', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main',
      GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_OUTPUT: output,
      RELEASE_DRY_RUN: 'false', RELEASE_MANIFEST: '.release/app.json', RELEASE_MANIFEST_DIRECTORY: '', RELEASE_RECEIPT_FILE: receipt,
      RELEASE_TAG_TOKEN: 'fixture-token', GH_TOKEN: '', GITHUB_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill()); let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); return { code, stderr };
  };
  const good = await run(); assert.equal(good.code, 0, good.stderr);
  assert.equal(JSON.parse(readFileSync(receipt)).status, 'exists');
  const outputs = readFileSync(output, 'utf8').split('\n');
  assert.ok(outputs.includes('tag=' + first.tag)); assert.ok(outputs.includes('version=1.0.1'));
  assert.ok(requests.some(request => request.includes('/git/tags/')));
  conflict = true; const bad = await run(); assert.notEqual(bad.code, 0); assert.match(bad.stderr, /different source/);
  assert.ok(requests.every(request => request.startsWith('GET '))); assert.equal(git('status', '--porcelain'), '');
});

test('planning rejects dangling package symlinks before writing outside its disposable checkout', async t => {
  const { cwd, commit, plan } = fixture(t);
  const target = resolve(cwd, '.git/escaped-package.json');
  symlinkSync(target, resolve(cwd, 'package.json')); commit('fix(app): preserve state');
  await assert.rejects(plan(), /Package configuration must stay inside/);
  assert.equal(existsSync(target), false);
});
