import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyArtifactReceipt } from '../release/src/apple.mjs';

const sha = /^[a-f0-9]{40}$/;
const repository = /^[\w.-]+\/[\w.-]+$/;
const identifier = /^[1-9]\d*$/;
export function validateSource(run, workflow, env, tip) {
  const branch = run.head_branch;
  if (String(run.id) !== env.CI_RUN_ID || run.workflow_id !== workflow.id
      || run.path !== `.github/workflows/${env.APPLE_CI_WORKFLOW}`
      || run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success'
      || run.repository?.full_name !== env.GITHUB_REPOSITORY
      || run.head_repository?.full_name !== env.GITHUB_REPOSITORY || !sha.test(run.head_sha)
      || env.GITHUB_REF !== `refs/heads/${branch}` || !allowedBranch(branch, env.APPLE_PROFILE)
      || (tip !== run.head_sha && Number(env.GITHUB_RUN_ATTEMPT || 1) === 1)) {
    throw new Error('Release requires official successful push CI at the selected branch tip');
  }
  return { branch, 'source-sha': run.head_sha };
}
export function allowedBranch(branch, profile) {
  return branch === 'main' || profile !== 'preview-only' && (branch === 'release'
    || profile === 'maintenance' && /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?\.x$/.test(branch));
}
export function validatePush(env, tip) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' || !sha.test(env.GITHUB_SHA)
      || tip.object?.type !== 'commit' || (tip.object.sha !== env.GITHUB_SHA && Number(env.GITHUB_RUN_ATTEMPT || 1) === 1)) {
    throw new Error('Preview requires an official main push at the branch tip');
  }
  return { branch: 'main', 'source-sha': env.GITHUB_SHA };
}
export function validatePlan(plan, env) {
  if (!['preview-only', 'preview-stable', 'maintenance'].includes(env.APPLE_PROFILE)
      || plan.schema !== 1 || typeof plan.release !== 'boolean' || !sha.test(plan.sourceSha)
      || plan.sourceSha !== env.SOURCE_SHA || String(plan.runId) !== env.GITHUB_RUN_ID
      || String(plan.ciRunId ?? '') !== env.CI_RUN_ID || plan.branch !== env.RELEASE_BRANCH
      || env.GITHUB_REF !== `refs/heads/${plan.branch}` || !allowedBranch(plan.branch, env.APPLE_PROFILE)
      || (plan.repository !== undefined && plan.repository !== env.GITHUB_REPOSITORY)) {
    throw new Error('Apple release plan provenance mismatch');
  }
  if (!plan.release) return plan;
  const preview = plan.branch === 'main';
  if (plan.signingMode !== undefined && plan.signingMode !== (preview ? env.APPLE_PREVIEW_SIGNING : 'developer-id')) throw new Error('Signing policy changed after planning');
  if (!/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?v\d+\.\d+\.\d+(?:-preview\.[1-9]\d*|\.[1-9]\d{0,11}-[a-f0-9]{7})?$/.test(plan.tag)
      || !/^\d+\.\d+\.\d+(?:-preview\.[1-9]\d*|-[1-9]\d*\.g[a-f0-9]{7})?$/.test(plan.version)
      || !['preview', 'timestamp', 'stable'].includes(plan.channel)
      || preview === (plan.channel === 'stable') || typeof plan.notes !== 'string' || !plan.notes.trim()
      || preview !== (/-preview\./.test(plan.tag) || /\.\d+-[a-f0-9]{7}$/.test(plan.tag))) {
    throw new Error('Apple release channel or version differs from policy');
  }
  const rawVersion = plan.tag.replace(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?v/, '');
  if (plan.channel === 'timestamp') {
    const projection = /^(\d+\.\d+\.\d+)\.([1-9]\d{0,11})-([a-f0-9]{7})$/.exec(rawVersion);
    if (!projection || plan.version !== `${projection[1]}-${projection[2]}.g${projection[3]}`
        || projection[3] !== plan.sourceSha.slice(0, 7)) throw new Error('Preview projection differs from the planned source');
  } else if (rawVersion !== plan.version) throw new Error('Tag differs from the planned version');
  return plan;
}
export function selectArtifact(artifacts, name) {
  const matches = artifacts.filter(artifact => artifact.name === name);
  if (matches.length > 1 || matches.some(artifact => artifact.expired || !identifier.test(String(artifact.id)))) {
    throw new Error('Expected one unexpired artifact from the original run; refuse to rebuild');
  }
  return matches[0];
}
export function verifyPackages(plan, env) {
  const directory = realpathSync(resolve(env.APPLE_ARTIFACT_DIRECTORY));
  const receipt = JSON.parse(readFileSync(resolve(directory, 'validated-artifacts.json'), 'utf8'));
  const names = Object.keys(receipt.files ?? {});
  if (!names.length) throw new Error('No signed release assets');
  for (const name of [...names, 'validated-artifacts.json']) {
    if (/[\r\n]/.test(name)) throw new Error('Invalid release asset name');
    const path = resolve(directory, name);
    if (!lstatSync(path).isFile() || relative(directory, realpathSync(path)) !== name) throw new Error('Release assets must be regular files within the artifact directory');
  }
  verifyArtifactReceipt({ plan, directory, planFile: env.RELEASE_PLAN, assetNames: names,
    signingMode: plan.channel === 'stable' ? 'developer-id' : env.APPLE_PREVIEW_SIGNING });
  return [...names, 'validated-artifacts.json'].map(name => resolve(directory, name));
}
function output(values, env) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) throw new Error('Invalid workflow output');
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
async function api(path, env, optional = false) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`Release API failed (${response.status}); refusing to continue`);
  return response.json();
}
export async function main(mode, env = process.env) {
  if (!repository.test(env.GITHUB_REPOSITORY) || !env.GH_TOKEN) throw new Error('Explicit workflow token and repository are required');
  if (mode === 'source') {
    if (!['preview-only', 'preview-stable', 'maintenance'].includes(env.APPLE_PROFILE)) throw new Error('Invalid Apple profile');
    if (env.APPLE_SOURCE_MODE === 'push') {
      const tip = await api('git/ref/heads/main', env);
      output(validatePush(env, tip), env);
    } else {
      if (env.APPLE_SOURCE_MODE !== 'ci' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !identifier.test(env.CI_RUN_ID)
          || !/^[\w-]+\.ya?ml$/.test(env.APPLE_CI_WORKFLOW)) throw new Error('CI release requires a tested branch dispatch');
      const run = await api(`actions/runs/${env.CI_RUN_ID}`, env);
      const workflow = await api(`actions/workflows/${env.APPLE_CI_WORKFLOW}`, env);
      if (!allowedBranch(run.head_branch, env.APPLE_PROFILE)) throw new Error('Not a configured release branch');
      const tip = await api(`git/ref/heads/${encodeURIComponent(run.head_branch)}`, env);
      output(validateSource(run, workflow, env, tip.object?.sha), env);
    }
  } else if (mode === 'find') {
    if (!identifier.test(env.GITHUB_RUN_ID)) throw new Error('Invalid original run');
    const artifacts = [];
    for (let page = 1; ; page++) {
      const result = await api(`actions/runs/${env.GITHUB_RUN_ID}/artifacts?per_page=100&page=${page}`, env);
      artifacts.push(...result.artifacts);
      if (result.artifacts.length < 100) break;
    }
    const artifact = selectArtifact(artifacts, env.APPLE_FIND_ARTIFACT);
    output({ exists: Boolean(artifact), ...(artifact ? { id: artifact.id } : {}) }, env);
  } else {
    const plan = validatePlan(JSON.parse(readFileSync(env.RELEASE_PLAN, 'utf8')), env);
    if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== plan.sourceSha) throw new Error('Checkout differs from tested source');
    if (mode === 'plan') output({ release: plan.release, tag: plan.tag ?? '', version: plan.version ?? '', channel: plan.channel ?? '' }, env);
    else if (mode === 'guard') {
      if (await api(`git/ref/tags/${encodeURIComponent(plan.tag)}`, env, true)) throw new Error('Refuse to rebuild an existing tag; recover the original signed packages');
    } else if (mode === 'verify') {
      const paths = verifyPackages(plan, env);
      appendFileSync(env.GITHUB_OUTPUT, `paths<<APPLE_SIGNED_PATHS\n${paths.join('\n')}\nAPPLE_SIGNED_PATHS\n`);
    } else throw new Error('Unknown Apple release phase');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
