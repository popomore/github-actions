import test from 'node:test';
import assert from 'node:assert/strict';
import { createTag } from '../src/tags.mjs';
const plan = { schema: 1, unit: 'app', tag: 'app-v1.1.0-preview.1', version: '1.1.0-preview.1', channel: 'prerelease', source_sha: 'a'.repeat(40), repository: 'fixture/app', manifest_path: '.release/app.json', manifest_sha: 'b'.repeat(64), notes: 'Release notes' };
function server() {
  let ref, object, writes = 0;
  return { get writes() { return writes; }, corrupt() { object.object.sha = 'c'.repeat(40); },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method;
      const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
      if (path.includes('/git/ref/tags/')) return ref ? response(ref) : response({}, 404);
      if (path.endsWith('/git/tags') && method === 'POST') { writes++; const request = JSON.parse(options.body); object = { message: request.message, object: { type: request.type, sha: request.object } }; return response({ sha: 'd'.repeat(40) }); }
      if (path.endsWith('/git/refs') && method === 'POST') { writes++; ref = { object: { type: 'tag', sha: 'd'.repeat(40) } }; return response(ref); }
      if (path.includes('/git/tags/')) return response(object);
      throw new Error('Unexpected request');
    } };
}
test('annotated tags preserve the full plan and retries never overwrite a ref', async () => {
  const api = server(), options = { ...api, token: 'fixture-token' };
  assert.equal((await createTag(plan, options)).status, 'created'); assert.equal(api.writes, 2);
  assert.equal((await createTag(plan, options)).status, 'exists'); assert.equal(api.writes, 2);
  api.corrupt(); await assert.rejects(createTag(plan, options), /different source/); assert.equal(api.writes, 2);
  await assert.rejects(createTag(plan, { fetchImpl: api.fetchImpl }), /dedicated/);
});
