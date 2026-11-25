import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planUnit, validateUnit, git } from './planner.mjs';
import { createTag, verifyBranchTip } from './tags.mjs';
const input = (name, fallback = '') => process.env[`RELEASE_${name.toUpperCase().replaceAll('-', '_')}`] || fallback;
try {
  const cwd = process.cwd(), sourceSha = process.env.GITHUB_SHA;
  const dryRun = input('dry-run', 'true');
  if (!['true', 'false'].includes(dryRun)) throw new Error('dry-run must be boolean');
  const directory = input('manifest-directory'), single = input('manifest');
  if (Boolean(directory) === Boolean(single)) throw new Error('Select exactly one manifest or manifest-directory');
  if ([directory, single].filter(Boolean).some(path => path.startsWith('/') || path.split('/').includes('..') || /[\r\n:*?\[\]\\]/.test(path))) throw new Error('Invalid manifest selection');
  const excluded = JSON.parse(input('exclude-units', '[]'));
  if (!Array.isArray(excluded) || excluded.some(value => typeof value !== 'string') || new Set(excluded).size !== excluded.length || single && excluded.length) throw new Error('Invalid excluded units');
  const paths = single ? [single] : git(cwd, 'ls-tree', '-r', '--name-only', sourceSha, '--', directory).split('\n').filter(path => path.endsWith('.json'));
  const units = paths.map(path => ({ path, unit: validateUnit(JSON.parse(git(cwd, 'show', `${sourceSha}:${path}`))) }));
  if (!units.length) throw new Error('No release units selected');
  for (const name of excluded) if (!units.some(item => item.unit.unit === name)) throw new Error(`Unknown excluded unit: ${name}`);
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++)
    if (units[i].unit.unit === units[j].unit.unit || units[i].unit.tag_prefix.startsWith(units[j].unit.tag_prefix) || units[j].unit.tag_prefix.startsWith(units[i].unit.tag_prefix)) throw new Error('Release units require unique non-overlapping tag prefixes');
  const automatic = process.env.GITHUB_EVENT_NAME === 'push';
  if (dryRun === 'false' && (!['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) || process.env.GITHUB_REF_TYPE !== 'branch')) throw new Error('Tag writes require an approved branch workflow');
  const results = [];
  for (const { path, unit } of units.filter(item => !excluded.includes(item.unit.unit))) {
    if (dryRun === 'false' && process.env.GITHUB_REF_NAME !== unit.branch) throw new Error('Tag writes require the declared release branch');
    if (dryRun === 'false') git(cwd, 'merge-base', '--is-ancestor', sourceSha, `refs/remotes/origin/${unit.branch}`);
    else if (process.env.GITHUB_EVENT_NAME === 'pull_request') git(cwd, 'merge-base', '--is-ancestor', `refs/remotes/origin/${unit.branch}`, sourceSha);
    if (automatic && !unit.auto_on_main) { results.push({ unit: unit.unit, status: 'disabled', tag: '', created: false }); continue; }
    if (automatic && unit.preview_tag_compatibility) throw new Error('Compatibility previews require the explicit product adapter');
    results.push(await planUnit({ cwd, manifestPath: path, sourceSha, repository: process.env.GITHUB_REPOSITORY, preview: automatic && unit.prerelease === 'preview' }));
  }
  if (!results.length) throw new Error('At least one unit must remain selected');
  // Validate every unit before the first remote write. Repository concurrency is
  // owned by the caller, including any separately gated units.
  if (dryRun === 'false' && results.some(plan => plan.tag)) {
    const token = input('tag-token');
    if (!token) throw new Error('A dedicated RELEASE_TAG_TOKEN is required');
    const branches = new Set(units.filter(item => !excluded.includes(item.unit.unit)).map(item => item.unit.branch));
    for (const branch of branches) await verifyBranchTip({ repository: process.env.GITHUB_REPOSITORY, branch, sourceSha }, { token, apiUrl: process.env.GITHUB_API_URL });
    for (let i = 0; i < results.length; i++) if (results[i].tag) results[i] = await createTag(results[i], { token, apiUrl: process.env.GITHUB_API_URL });
  }
  const active = results.filter(plan => plan.tag), file = resolve(input('receipt-file', resolve(process.env.RUNNER_TEMP || cwd, 'release-semantic.json')));
  const receipt = { schema: 1, kind: 'semantic-release-batch', repository: process.env.GITHUB_REPOSITORY, source_sha: sourceSha,
    implementation_ref: input('implementation-ref'), run_id: process.env.GITHUB_RUN_ID, run_attempt: process.env.GITHUB_RUN_ATTEMPT,
    status: active.length ? dryRun === 'true' ? 'verified' : active.some(plan => plan.created) ? 'created' : 'exists' : results.every(plan => plan.status === 'disabled') ? 'disabled' : 'unchanged', results };
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) for (const [name, value] of Object.entries({ tag: active.length === 1 ? active[0].tag : '', version: active.length === 1 ? active[0].version : '', tags: JSON.stringify(active.map(plan => plan.tag)), status: receipt.status, created: String(active.some(plan => plan.created)), 'source-sha': sourceSha, receipt: file })) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(JSON.stringify({ status: receipt.status, tags: active.map(plan => plan.tag), receipt: file }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
