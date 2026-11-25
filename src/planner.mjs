import semanticRelease from 'semantic-release';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function git(cwd, ...args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd(); }
  catch { throw new Error(`Git operation failed: ${args[0]}`); }
}
function pattern(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.startsWith('!') || value.includes('..') || /[\r\n]/.test(value)) throw new Error('Invalid release path pattern');
  let source = '^';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '*' && value[i + 1] === '*') {
      i++;
      if (value[i + 1] === '/') { source += '(?:.*/)?'; i++; } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(source + '$', 's');
}
export function validateUnit(unit) {
  if (unit.schema !== 1 || unit.versioning !== 'semantic-release' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(unit.unit ?? '')
      || !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?v$/.test(unit.tag_prefix ?? '')
      || !/^[\w./-]+$/.test(unit.branch ?? '') || unit.branch.startsWith('-') || unit.branch.includes('..')
      || typeof unit.auto_on_main !== 'boolean') throw new Error('Invalid semantic-release unit');
  if (unit.preview_tag_compatibility !== undefined && unit.preview_tag_compatibility !== 'timestamp') throw new Error('Unsupported preview compatibility format');
  if (unit.prerelease !== undefined && unit.prerelease !== 'preview') throw new Error('Only the preview prerelease channel is supported');
  if (unit.paths !== undefined && (!Array.isArray(unit.paths) || !unit.paths.length)) throw new Error('Release paths must be a nonempty list');
  if (unit.ignore !== undefined && !Array.isArray(unit.ignore)) throw new Error('Release ignore must be a list');
  (unit.paths ?? ['**']).forEach(pattern); (unit.ignore ?? []).forEach(pattern);
  return unit;
}
export function scopedCommits(cwd, commits, unit) {
  const include = (unit.paths ?? ['**']).map(pattern), exclude = (unit.ignore ?? []).map(pattern);
  return commits.filter(commit => {
    if (!/^[a-f0-9]{40}$/.test(commit.hash)) throw new Error('Invalid commit identity');
    const paths = git(cwd, 'diff-tree', '--root', '-m', '--no-commit-id', '--name-only', '-r', '--no-renames', '-z', commit.hash).split('\0').filter(Boolean);
    return paths.some(path => include.some(re => re.test(path)) && !exclude.some(re => re.test(path)));
  });
}

// Core runs against a disposable local mirror. Its permission probe and fetches
// cannot write to GitHub or the consumer checkout, including credential-free PRs.
export async function planUnit({ cwd = process.cwd(), manifestPath, sourceSha = git(cwd, 'rev-parse', 'HEAD'), repository, preview = false }) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || git(cwd, 'rev-parse', 'HEAD') !== sourceSha) throw new Error('Checkout differs from source SHA');
  if (git(cwd, 'rev-parse', '--is-shallow-repository') !== 'false') throw new Error('Full Git history is required');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Invalid source repository');
  if (!manifestPath || manifestPath.startsWith('/') || manifestPath.split('/').includes('..') || /[\r\n:]/.test(manifestPath)) throw new Error('Invalid manifest path');
  const bytes = execFileSync('git', ['show', `${sourceSha}:${manifestPath}`], { cwd });
  const unit = validateUnit(JSON.parse(bytes));
  if (preview && unit.prerelease !== 'preview') throw new Error('Unit does not declare a preview channel');
  const root = mkdtempSync(resolve(tmpdir(), 'semantic-release-plan-'));
  const mirror = resolve(root, 'origin.git'), work = resolve(root, 'work');
  const quiet = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  try {
    git(root, 'clone', '--mirror', '--shared', resolve(cwd), mirror);
    git(mirror, 'update-ref', `refs/heads/${unit.branch}`, sourceSha);
    git(mirror, 'symbolic-ref', 'HEAD', `refs/heads/${unit.branch}`);
    // Annotated plans are the durable channel record. Rehydrate core's channel
    // notes and explicitly declared legacy preview projections only in this mirror.
    for (const tag of git(mirror, 'tag', '--list', unit.tag_prefix + '*').split('\n').filter(Boolean)) {
      const canonical = tag.includes('-preview.');
      let saved;
      try { saved = JSON.parse(git(mirror, 'for-each-ref', '--format=%(contents)', `refs/tags/${tag}`)); }
      catch { if (canonical) throw new Error('Preview tag lacks a semantic-release plan'); else continue; }
      const compatibility = saved.kind === 'semantic-release-compatibility';
      if (!canonical && !compatibility) continue;
      const source = git(mirror, 'rev-parse', `refs/tags/${tag}^{commit}`);
      if (saved.unit !== unit.unit || saved.tag !== tag || saved.repository !== repository || saved.source_sha !== source
          || saved.manifest_sha !== digest(execFileSync('git', ['show', `${source}:${manifestPath}`], { cwd: mirror })))
        throw new Error('Preview tag has conflicting release provenance');
      let semanticTag = tag;
      if (compatibility) {
        if (unit.preview_tag_compatibility !== 'timestamp') throw new Error('Legacy preview projection is not declared');
        const version = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.([1-9][0-9]*)$/.exec(saved.semantic_version ?? '');
        const timestamp = git(mirror, 'log', '-1', '--format=%ct', source);
        const base = version && version.slice(1, 4).join('.');
        if (!version || saved.channel !== 'timestamp' || saved.semantic_tag !== unit.tag_prefix + saved.semantic_version
            || tag !== `${unit.tag_prefix}${base}.${timestamp}-${source.slice(0, 7)}`
            || saved.version !== `${base}-${timestamp}.g${source.slice(0, 7)}`) throw new Error('Legacy preview projection differs from its semantic plan');
        semanticTag = saved.semantic_tag;
        const existing = git(mirror, 'tag', '--list', semanticTag);
        if (existing && git(mirror, 'rev-parse', `${semanticTag}^{commit}`) !== source) throw new Error('Conflicting semantic preview tags');
        if (!existing) git(mirror, 'tag', semanticTag, source);
      } else if (saved.kind !== 'semantic-release' || saved.channel !== 'prerelease') throw new Error('Preview channel differs from its plan');
      git(mirror, '-c', 'user.name=Release planner', '-c', 'user.email=planner@example.invalid',
        'notes', '--ref', `semantic-release-${semanticTag}`, 'add', '-f', '-m', JSON.stringify({ channels: ['preview'] }), source);
    }
    // A local stable reference gives core its required stable line while existing
    // products keep their approved real branches and promotion controls.
    const stable = '__semantic_release_stable__';
    if (preview) git(mirror, 'update-ref', `refs/heads/${stable}`, sourceSha);
    git(root, 'clone', '--shared', '--branch', unit.branch, mirror, work);
    const plugin = {
      async analyzeCommits(_config, context) {
        return analyzeCommits({ preset: 'conventionalcommits' }, { ...context, commits: scopedCommits(work, context.commits, unit) });
      },
      async generateNotes(_config, context) {
        return generateNotes({ preset: 'conventionalcommits' }, { ...context,
          commits: scopedCommits(work, context.commits, unit),
          options: { ...context.options, repositoryUrl: `https://github.com/${repository}.git` } });
      },
    };
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GITHUB_|GH_|CI$|GIT_CONFIG_)/.test(key)));
    const result = await semanticRelease({ ci: false, dryRun: true, repositoryUrl: pathToFileURL(mirror).href,
      branches: preview ? [{ name: stable, channel: false }, { name: unit.branch, channel: 'preview', prerelease: 'preview' }] : [{ name: unit.branch, channel: false }],
      tagFormat: unit.tag_prefix + '${version}', plugins: [plugin] }, { cwd: work, env, stdout: quiet, stderr: quiet });
    const base = { schema: 1, unit: unit.unit, source_sha: sourceSha, repository, manifest_path: manifestPath,
      manifest_sha: digest(bytes), versioning: 'semantic-release' };
    if (!result?.nextRelease) return { ...base, status: 'unchanged', tag: '', created: false };
    const next = result.nextRelease;
    return { ...base, status: 'verified', tag: next.gitTag, version: next.version,
      channel: preview ? 'prerelease' : 'stable', notes: next.notes, previous_tag: result.lastRelease.gitTag ?? '', created: false };
  } finally { quiet.end(); rmSync(root, { recursive: true, force: true }); }
}
