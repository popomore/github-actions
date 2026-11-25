import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { appleReleaseConfig, semanticEnvironment, verifyArtifactReceipt, verifyPlannedRelease } from '../src/apple.mjs';
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
