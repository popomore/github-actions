import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
for (const action of ['release/action.yml', 'apple-release/action.yml']) {
  test(`${action} installs the pinned engine independently of the runner mirror`, t => {
    const lines = readFileSync(resolve(root, action), 'utf8').split('\n');
    const index = lines.findIndex(line => /^\s+run: pnpm --dir .* install --frozen-lockfile --ignore-scripts$/.test(line));
    assert.notEqual(index, -1);
    let start = index;
    while (start > 0 && !/^    - /.test(lines[start])) start--;
    const block = lines.slice(start, index + 1).join('\n');
    const registry = /^\s+npm_config_registry:\s*(\S+)/m.exec(block)?.[1];
    const directory = mkdtempSync(resolve(tmpdir(), 'release-bootstrap-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    // Execute the real Action command and step environment with an installer
    // boundary that reproduces the observed mirror's missing tarball.
    writeFileSync(resolve(directory, 'pnpm'), '#!/bin/sh\n'
      + 'if [ "$npm_config_registry" != https://registry.npmjs.org/ ]; then\n'
      + '  echo "ERR_PNPM_FETCH_404 @semantic-release/core@1.0.0" >&2; exit 1\nfi\n', { mode: 0o755 });
    const command = lines[index].trim().slice('run: '.length);
    const result = spawnSync('bash', ['-ec', command], { encoding: 'utf8', env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, RELEASE_ACTION_ROOT: directory,
      APPLE_RELEASE_TOOLS: directory, npm_config_registry: registry || 'https://registry.npmmirror.com/',
    } });
    assert.equal(result.status, 0, result.stderr);
  });
}
