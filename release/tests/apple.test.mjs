import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appleReleaseConfig, semanticEnvironment, verifyArtifactReceipt, verifyPlannedRelease, recoverChannelNote } from '../src/apple.mjs';
test('Apple configuration keeps preview, stable and maintenance routing distinct', () => {
  const config = appleReleaseConfig({ publisher: './publisher.mjs', previewBranch: 'main', maintenance: true });
  assert.equal(config.branches[1].name, 'release'); assert.equal(config.branches[1].channel, false);
  assert.deepEqual(config.branches[2], { name: 'main', channel: 'preview', prerelease: 'preview' });
  assert.equal(config.tagFormat, 'v${version}'); assert.equal(config.plugins.length, 2);
  assert.throws(() => appleReleaseConfig({ publisher: './p.mjs', previewBranch: 'release' }));
  const env = semanticEnvironment({ GITHUB_ACTIONS: 'true', GH_TOKEN: 'fixture-token' });
  assert.equal(env.GITHUB_TOKEN, 'fixture-token'); assert.equal(env.GH_TOKEN, undefined);
});
test('publication checks the planned source and byte-identical signed assets', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'apple-artifacts-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const plan = { sourceSha: 'a'.repeat(40), tag: 'v1.2.3', version: '1.2.3' }, planFile = resolve(directory, 'plan.json');
  writeFileSync(planFile, JSON.stringify(plan)); writeFileSync(resolve(directory, 'app.dmg'), 'signed package');
  const digest = value => createHash('sha256').update(value).digest('hex');
  writeFileSync(resolve(directory, 'validated-artifacts.json'), JSON.stringify({ schema: 1, planSha256: digest(JSON.stringify(plan)), sourceSha: plan.sourceSha, tag: plan.tag, signingMode: 'developer-id', files: { 'app.dmg': digest('signed package') } }));
  const options = { plan, directory, planFile, assetNames: ['app.dmg'], signingMode: 'developer-id' };
  assert.equal(verifyArtifactReceipt(options).tag, plan.tag);
  assert.throws(() => verifyArtifactReceipt({ ...options, signingMode: 'ad-hoc' }));
  writeFileSync(resolve(directory, 'app.dmg'), 'rebuilt package'); assert.throws(() => verifyArtifactReceipt(options), /digest mismatch/);
  verifyPlannedRelease(plan, { gitTag: plan.tag, version: plan.version, gitHead: plan.sourceSha });
  assert.throws(() => verifyPlannedRelease(plan, { gitTag: plan.tag, version: plan.version, gitHead: 'b'.repeat(40) }));
});

function recoveryFixture(t, annotated = true) {
  const root = mkdtempSync(resolve(tmpdir(), 'apple-recovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = resolve(root, 'work'), remote = resolve(root, 'origin.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  execFileSync('git', ['clone', remote, cwd], { stdio: 'pipe' });
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('config', 'user.name', 'Recovery fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(resolve(cwd, 'app'), 'release'); git('add', '.'); git('commit', '-m', 'fix: release');
  const plan = { sourceSha: git('rev-parse', 'HEAD'), tag: 'v1.0.1-preview.1' };
  if (annotated) git('tag', '-a', plan.tag, '-m', 'immutable release'); else git('tag', plan.tag);
  git('push', 'origin', `refs/tags/${plan.tag}`);
  const ref = `refs/notes/semantic-release-${plan.tag}`;
  return { cwd, remote, git, plan, ref, recover: () => { const previous = process.cwd(); try { process.chdir(cwd); return recoverChannelNote({ cwd, plan, channel: 'preview', env: { ...process.env, GITHUB_TOKEN: 'fixture-token' } }); } finally { process.chdir(previous); } } };
}
for (const annotated of [true, false]) test(`recovery writes a commit channel note for ${annotated ? 'annotated' : 'lightweight'} tags and retries safely`, t => {
  const { remote, git, plan, ref, recover } = recoveryFixture(t, annotated);
  // Simulate an interrupted push: the local note exists but origin has no note ref.
  git('notes', '--ref', ref, 'add', '-m', JSON.stringify({ channels: ['preview'] }), plan.sourceSha);
  recover(); recover();
  const note = JSON.parse(execFileSync('git', ['--git-dir', remote, 'notes', '--ref', ref, 'show', plan.sourceSha], { encoding: 'utf8' }));
  assert.deepEqual(note.channels, ['preview']);
});
test('recovery rejects a conflicting local tag without writing remote notes', t => {
  const { git, plan, ref, recover } = recoveryFixture(t);
  git('commit', '--allow-empty', '-m', 'chore: unrelated local source');
  git('tag', '-d', plan.tag); git('tag', plan.tag);
  assert.throws(recover, /local tag/);
  assert.equal(git('ls-remote', 'origin', ref), '');
});
test('recovery rejects a conflicting local channel note', t => {
  const { git, plan, ref, recover } = recoveryFixture(t);
  git('notes', '--ref', ref, 'add', '-m', JSON.stringify({ channels: ['other'] }), plan.sourceSha);
  assert.throws(recover, /conflict/);
  assert.equal(git('ls-remote', 'origin', ref), '');
});

test('fresh annotated-tag recovery attaches metadata to the commit, not the tag object', t => {
  const { remote, git, plan, ref, recover } = recoveryFixture(t);
  recover();
  assert.deepEqual(JSON.parse(execFileSync('git', ['--git-dir', remote, 'notes', '--ref', ref, 'show', plan.sourceSha], { encoding: 'utf8' })).channels, ['preview']);
  assert.throws(() => execFileSync('git', ['--git-dir', remote, 'notes', '--ref', ref, 'show', git('rev-parse', plan.tag)], { stdio: 'pipe' }));
});
test('recovery validates remote channel metadata before reusing it', t => {
  const { git, plan, ref, recover } = recoveryFixture(t);
  git('notes', '--ref', ref, 'add', '-m', JSON.stringify({ channels: ['other'] }), plan.sourceSha);
  git('push', 'origin', ref); git('update-ref', '-d', ref);
  assert.throws(recover, /conflict/);
});
