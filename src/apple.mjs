import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
export const maintenanceBranch = /^\d+(?:\.\d+)?\.x$/;
export function appleReleaseConfig({ publisher, previewBranch, stableBranch = 'release', maintenance = false }) {
  if (!publisher || !stableBranch || previewBranch === stableBranch) throw new Error('Declare separate Apple release branches and a publisher');
  return { branches: [...(maintenance ? ['+([0-9])?(.{+([0-9]),x}).x'] : []), { name: stableBranch, channel: false },
    ...(previewBranch ? [{ name: previewBranch, channel: 'preview', prerelease: 'preview' }] : [])],
  tagFormat: 'v${version}', plugins: [[require.resolve('@semantic-release/commit-analyzer'), { preset: 'conventionalcommits' }], publisher] };
}
export function semanticEnvironment(env) {
  const prepared = { ...env };
  if (env.GITHUB_ACTIONS === 'true' && (env.GITHUB_TOKEN || env.GH_TOKEN)) {
    prepared.GITHUB_TOKEN = env.GITHUB_TOKEN || env.GH_TOKEN;
    prepared.GITHUB_ACTION = env.GITHUB_ACTION || 'semantic-release'; delete prepared.GH_TOKEN;
  }
  return prepared;
}
export function verifyPlannedRelease(plan, next) {
  if (next.gitTag !== plan.tag || next.version !== plan.version || next.gitHead !== plan.sourceSha) throw new Error('The release changed after packaging; refusing to tag');
}
export function verifyArtifactReceipt({ plan, directory, planFile, assetNames, signingMode }) {
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const receipt = JSON.parse(readFileSync(resolve(directory, 'validated-artifacts.json'), 'utf8'));
  if (receipt.schema !== 1 || receipt.planSha256 !== digest(readFileSync(planFile)) || receipt.sourceSha !== plan.sourceSha
      || receipt.tag !== plan.tag || receipt.signingMode !== signingMode || !receipt.files
      || Object.keys(receipt.files).sort().join('\n') !== [...assetNames].sort().join('\n')) throw new Error('Artifacts do not match the immutable release plan');
  for (const name of assetNames) {
    if (name !== name.split('/').at(-1) || name.includes('..') || name.includes('\\')) throw new Error('Invalid release asset name');
    if (digest(readFileSync(resolve(directory, name))) !== receipt.files[name]) throw new Error(`Artifact digest mismatch: ${name}`);
  }
  return receipt;
}
export function recoverChannelNote({ plan, env, channel, cwd = process.cwd() }) {
  if (!/^v\d+\.\d+\.\d+(?:-preview\.[1-9]\d*)?$/.test(plan.tag) || !/^[a-f0-9]{40}$/.test(plan.sourceSha)) throw new Error('Invalid recovery identity');
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) throw new Error('Release recovery requires the workflow token');
  const ref = `refs/notes/semantic-release-${plan.tag}`;
  const authEnv = { ...env, GIT_AUTHOR_NAME: 'semantic-release-bot', GIT_AUTHOR_EMAIL: 'semantic-release-bot@martynus.net',
    GIT_COMMITTER_NAME: 'semantic-release-bot', GIT_COMMITTER_EMAIL: 'semantic-release-bot@martynus.net',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` };
  const git = (args, allowMissing = false) => {
    try { return execFileSync('git', args, { cwd, env: authEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch (error) {
      if (allowMissing && error.status === 1) return null;
      throw new Error('Release note recovery failed; credentials and remote output were suppressed');
    }
  };
  const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${plan.tag}`, `refs/tags/${plan.tag}^{}`]);
  const lines = remote ? remote.split('\n') : [];
  if ((lines.find(line => line.endsWith('^{}')) || lines[0])?.split(/\s/)[0] !== plan.sourceSha) throw new Error('Recovery tag differs from the packaged source');
  const remoteObject = lines.find(line => line.endsWith(`\trefs/tags/${plan.tag}`))?.split(/\s/)[0];
  const localObject = git(['tag', '--list', plan.tag, '--format=%(objectname)']);
  if (localObject && localObject !== remoteObject) throw new Error('Recovery local tag conflicts with the verified remote tag');
  if (git(['rev-parse', '--verify', `${plan.sourceSha}^{commit}`]) !== plan.sourceSha) throw new Error('Recovery source is not available locally');
  const readNote = noteRef => {
    const text = git(['notes', '--ref', noteRef, 'show', plan.sourceSha], true);
    if (text === null) return null;
    const note = JSON.parse(text);
    if (!Array.isArray(note.channels) || !note.channels.includes(channel)) throw new Error('Existing tag channel note conflicts with the plan');
    return note;
  };
  const localNote = readNote(ref);
  if (git(['ls-remote', 'origin', ref])) {
    const inspectionRef = `refs/notes/release-recovery-${randomUUID()}`;
    try {
      git(['fetch', '--no-tags', 'origin', `${ref}:${inspectionRef}`]);
      if (!readNote(inspectionRef)) throw new Error('Existing tag channel note conflicts with the plan');
    } finally { git(['update-ref', '-d', inspectionRef]); }
  } else {
    if (!localNote) git(['notes', '--ref', ref, 'add', '-m', JSON.stringify({ channels: [channel] }), plan.sourceSha]);
    git(['push', 'origin', ref]);
  }
}
