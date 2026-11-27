import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateSource, validatePush, validatePlan, selectArtifact, verifyPackages } from '../src/apple-pipeline.mjs';

const source = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: 'fixture/app', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '42',
  CI_RUN_ID: '41', APPLE_PROFILE: 'preview-only', RELEASE_BRANCH: 'main', SOURCE_SHA: source,
  APPLE_CI_WORKFLOW: 'ci.yml', APPLE_PREVIEW_SIGNING: 'ad-hoc', APPLE_STABLE_SIGNING: 'developer-id' };
const preview = { schema: 1, release: true, repository: 'fixture/app', branch: 'main', sourceSha: source,
  runId: '42', ciRunId: '41', tag: 'desktop-v1.2.3-preview.1', version: '1.2.3-preview.1', channel: 'preview', notes: 'Fix the app.' };
test('checked main pushes preserve retry identity after the branch advances', () => {
  const push = { ...env, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: source };
  const tip = { object: { type: 'commit', sha: 'b'.repeat(40) } };
  assert.throws(() => validatePush(push, tip));
  assert.equal(validatePush({ ...push, GITHUB_RUN_ATTEMPT: '2' }, tip)['source-sha'], source);
  assert.throws(() => validatePush({ ...push, GITHUB_EVENT_NAME: 'pull_request' }, tip));
  assert.throws(() => validatePush({ ...push, GITHUB_REF: 'refs/heads/release', GITHUB_RUN_ATTEMPT: '2' }, tip));
});
test('all products admit only official successful push CI at the selected tip', () => {
  const run = { id: 41, workflow_id: 7, path: '.github/workflows/ci.yml', event: 'push', status: 'completed',
    conclusion: 'success', head_branch: 'main', head_sha: source, repository: { full_name: 'fixture/app' }, head_repository: { full_name: 'fixture/app' } };
  assert.deepEqual(validateSource(run, { id: 7 }, env, source), { branch: 'main', 'source-sha': source });
  for (const change of [{ event: 'pull_request' }, { conclusion: 'failure' }, { id: 40 }, { workflow_id: 8 },
    { path: '.github/workflows/other.yml' }, { head_repository: { full_name: 'fork/app' } }, { head_branch: 'release' }]) {
    assert.throws(() => validateSource({ ...run, ...change }, { id: 7 }, env, source));
  }
  assert.throws(() => validateSource(run, { id: 7 }, env, 'b'.repeat(40)));
  validateSource(run, { id: 7 }, { ...env, GITHUB_RUN_ATTEMPT: '2' }, 'b'.repeat(40));
});
test('Mokisu preview-only policy rejects stable plans at every phase', () => {
  validatePlan(preview, env);
  const stable = { ...preview, branch: 'release', version: '1.2.3', tag: 'desktop-v1.2.3', channel: 'stable' };
  const stableEnv = { ...env, RELEASE_BRANCH: 'release', GITHUB_REF: 'refs/heads/release' };
  assert.throws(() => validatePlan(stable, stableEnv));
  validatePlan(stable, { ...stableEnv, APPLE_PROFILE: 'preview-stable' });
  for (const change of [{ channel: 'stable' }, { tag: 'desktop-v1.2.3' }, { sourceSha: 'b'.repeat(40) },
    { runId: '43' }, { ciRunId: '40' }, { notes: '' }]) assert.throws(() => validatePlan({ ...preview, ...change }, env));
  assert.throws(() => validatePlan(preview, { ...env, GITHUB_REF: 'refs/pull/1/merge' }));
});
test('Folio timestamp projections and MusicX maintenance channels remain admissible', () => {
  validatePlan({ ...preview, tag: `v1.2.3.1793840000-${source.slice(0, 7)}`, version: `1.2.3-1793840000.g${source.slice(0, 7)}`, channel: 'timestamp' }, { ...env, APPLE_PROFILE: 'preview-stable' });
  const maintenance = { ...preview, branch: '1.2.x', tag: 'v1.2.3', version: '1.2.3', channel: 'stable' };
  const maintenanceEnv = { ...env, APPLE_PROFILE: 'maintenance', RELEASE_BRANCH: '1.2.x', GITHUB_REF: 'refs/heads/1.2.x' };
  validatePlan(maintenance, maintenanceEnv);
  assert.throws(() => validatePlan(maintenance, { ...maintenanceEnv, APPLE_PROFILE: 'preview-stable' }));
});
test('ambiguous and expired artifacts never trigger a rebuild', () => {
  assert.equal(selectArtifact([], 'signed'), undefined);
  assert.equal(selectArtifact([{ id: 1, name: 'signed', expired: false }], 'signed').id, 1);
  assert.throws(() => selectArtifact([{ id: 1, name: 'signed', expired: true }], 'signed'));
  assert.throws(() => selectArtifact([{ id: 1, name: 'signed' }, { id: 2, name: 'signed' }], 'signed'));
});
test('publication accepts only original signed bytes and the selected signing policy', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'apple-pipeline-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const planFile = resolve(directory, 'plan.json');
  const digest = value => createHash('sha256').update(value).digest('hex');
  writeFileSync(planFile, JSON.stringify(preview));
  writeFileSync(resolve(directory, 'app.dmg'), 'signed-original');
  const receipt = { schema: 1, planSha256: digest(JSON.stringify(preview)), sourceSha: source,
    tag: preview.tag, signingMode: 'ad-hoc', files: { 'app.dmg': digest('signed-original') } };
  writeFileSync(resolve(directory, 'validated-artifacts.json'), JSON.stringify(receipt));
  const options = { ...env, RELEASE_PLAN: planFile, APPLE_ARTIFACT_DIRECTORY: directory };
  assert.equal(verifyPackages(preview, options).length, 2);
  assert.throws(() => verifyPackages(preview, { ...options, APPLE_PREVIEW_SIGNING: 'developer-id' }));
  writeFileSync(resolve(directory, 'app.dmg'), 'rebuilt');
  assert.throws(() => verifyPackages(preview, options), /digest mismatch/);
  rmSync(resolve(directory, 'app.dmg'));
  symlinkSync(planFile, resolve(directory, 'app.dmg'));
  assert.throws(() => verifyPackages(preview, options), /regular files/);
});

test('shared receipt verification uses the signing policy declared by the platform Action', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'apple-platform-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const plan = { ...preview, branch: 'release', version: '1.2.3', tag: 'v1.2.3', channel: 'stable' };
  const planFile = resolve(directory, 'plan.json');
  const digest = value => createHash('sha256').update(value).digest('hex');
  writeFileSync(planFile, JSON.stringify(plan));
  writeFileSync(resolve(directory, 'package.zip'), 'signed-original');
  writeFileSync(resolve(directory, 'validated-artifacts.json'), JSON.stringify({
    schema: 1, planSha256: digest(JSON.stringify(plan)), sourceSha: plan.sourceSha,
    tag: plan.tag, signingMode: 'platform-distribution', files: { 'package.zip': digest('signed-original') },
  }));
  const options = { ...env, APPLE_STABLE_SIGNING: 'platform-distribution',
    RELEASE_PLAN: planFile, APPLE_ARTIFACT_DIRECTORY: directory };
  assert.equal(verifyPackages(plan, options).length, 2);
  assert.throws(() => verifyPackages(plan, { ...options, APPLE_STABLE_SIGNING: 'developer-id' }));
  assert.throws(() => verifyPackages(plan, { ...options, APPLE_STABLE_SIGNING: '' }), /signing policy/);
});

test('the shared pipeline CLI executes when reached through a linked package path', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'apple-linked-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = resolve(directory, 'pipeline.mjs');
  symlinkSync(fileURLToPath(new URL('../src/apple-pipeline.mjs', import.meta.url)), entry);
  const result = spawnSync(process.execPath, [entry, 'plan'], {
    env: { ...process.env, GH_TOKEN: '', GITHUB_REPOSITORY: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Explicit workflow token and repository are required/);
});
