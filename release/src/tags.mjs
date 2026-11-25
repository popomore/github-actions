export function previewCompatibilityPlan(plan, timestamp) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.([1-9][0-9]*)$/.exec(plan.version ?? '');
  if (!match || !/^[1-9][0-9]{0,11}$/.test(timestamp) || !/^[a-f0-9]{40}$/.test(plan.source_sha)
      || !plan.tag.endsWith(plan.version) || plan.channel !== 'prerelease') throw new Error('Invalid semantic preview projection');
  const base = match.slice(1, 4).join('.'), prefix = plan.tag.slice(0, -plan.version.length);
  return { ...plan, kind: 'semantic-release-compatibility', semantic_tag: plan.tag, semantic_version: plan.version,
    tag: `${prefix}${base}.${timestamp}-${plan.source_sha.slice(0, 7)}`,
    version: `${base}-${timestamp}.g${plan.source_sha.slice(0, 7)}`, channel: 'timestamp' };
}

export async function createTag(plan, { token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!token) throw new Error('A dedicated RELEASE_TAG_TOKEN is required; no workflow-token fallback');
  const repo = plan.repository;
  if (plan.kind !== 'semantic-release-compatibility' && !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?v\d+\.\d+\.\d+(?:-preview\.[1-9]\d*)?$/.test(plan.tag)) throw new Error('Invalid canonical semantic tag');
  const compatibility = plan.kind === 'semantic-release-compatibility';
  if (compatibility) {
    const timestamp = /\.([1-9][0-9]{0,11})-[a-f0-9]{7}$/.exec(plan.tag)?.[1];
    const expected = previewCompatibilityPlan({ ...plan, tag: plan.semantic_tag, version: plan.semantic_version, channel: 'prerelease' }, timestamp);
    if (expected.tag !== plan.tag || expected.version !== plan.version) throw new Error('Conflicting preview projection');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[a-f0-9]{40}$/.test(plan.source_sha) || !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?v\d+\.\d+\.\d+(?:-preview\.[1-9]\d*|\.[1-9]\d{0,11}-[a-f0-9]{7})?$/.test(plan.tag)) throw new Error('Invalid semantic tag identity');
  const api = async (path, method = 'GET', body) => {
    const response = await fetchImpl(`${apiUrl}/repos/${repo}${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) { const error = new Error(`GitHub tag operation failed (${response.status})`); error.status = response.status; throw error; }
    return response.json();
  };
  const inspect = async () => {
    let ref;
    try { ref = await api(`/git/ref/tags/${encodeURIComponent(plan.tag)}`); } catch (error) { if (error.status === 404) return false; throw error; }
    if (ref.object?.type !== 'tag') throw new Error('Existing tag lacks the semantic-release plan');
    const object = await api(`/git/tags/${ref.object.sha}`);
    let saved; try { saved = JSON.parse(object.message); } catch { throw new Error('Existing tag has conflicting release metadata'); }
    for (const key of ['unit', 'tag', 'version', 'channel', 'source_sha', 'repository', 'manifest_path', 'manifest_sha', 'notes', 'semantic_tag', 'semantic_version'])
      if (saved[key] !== plan[key]) throw new Error(`Existing tag has conflicting ${key}`);
    if (saved.kind !== (compatibility ? 'semantic-release-compatibility' : 'semantic-release') || object.object?.type !== 'commit' || object.object.sha !== plan.source_sha) throw new Error('Existing tag points to a different source');
    return true;
  };
  if (await inspect()) return { ...plan, status: 'exists', created: false };
  const tag = await api('/git/tags', 'POST', { tag: plan.tag, message: JSON.stringify({ ...plan, kind: compatibility ? 'semantic-release-compatibility' : 'semantic-release' }), object: plan.source_sha, type: 'commit' });
  let created = false;
  try { await api('/git/refs', 'POST', { ref: `refs/tags/${plan.tag}`, sha: tag.sha }); created = true; }
  catch (error) { if (error.status !== 422 || !await inspect()) throw error; }
  if (!await inspect()) throw new Error('Created tag could not be verified');
  return { ...plan, status: created ? 'created' : 'exists', created };
}

export async function verifyBranchTip({ repository, branch, sourceSha }, { token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!token) throw new Error('Branch verification requires the explicit workflow/tag token');
  const response = await fetchImpl(`${apiUrl}/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`Branch verification failed (${response.status})`);
  const result = await response.json();
  if (result.object?.type !== 'commit' || result.object.sha !== sourceSha) throw new Error('Branch advanced after planning; use the newer source');
}
