import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function step(lines, index) {
  let start = index;
  while (start > 0 && !/^    - /.test(lines[start])) start--;
  let end = index + 1;
  while (end < lines.length && !/^    - /.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}
function registry(block, input) {
  const value = /^\s+npm_config_registry:\s*(.+)$/m.exec(block)?.[1].trim();
  return value === '${{ inputs.registry-url }}' ? input : value;
}
for (const action of ['release/action.yml', 'apple-release/action.yml']) {
  for (const override of [undefined, 'https://registry.example.test/']) {
    test(`${action} uses ${override ? 'the supplied registry' : 'the GitHub-hosted registry default'}`, t => {
      const lines = readFileSync(resolve(root, action), 'utf8').split('\n');
      const input = lines.indexOf('  registry-url:');
      assert.notEqual(input, -1, 'The Action exposes the optional registry-url input');
      const defaultValue = /^\s+default:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(lines.slice(input + 1, input + 4).join('\n'))?.[1];
      assert.equal(defaultValue, 'https://registry.npmjs.org/');
      const selected = override ?? defaultValue;
      const index = lines.findIndex(line => /^\s+run: pnpm --dir .* install --frozen-lockfile --ignore-scripts$/.test(line));
      assert.notEqual(index, -1);
      const installRegistry = registry(step(lines, index), selected);
      assert.equal(installRegistry, selected);
      const bootstrap = lines.findIndex(line => /uses: pnpm\/action-setup@/.test(line));
      assert.notEqual(bootstrap, -1);
      assert.equal(registry(step(lines, bootstrap), selected), selected);
      if (action === 'apple-release/action.yml') {
        const adapters = lines.flatMap((line, index) => line.includes('uses: ./.github/actions/apple-release') ? [step(lines, index)] : []);
        for (const phase of ['setup', 'build']) {
          const adapter = adapters.find(block => new RegExp(`phase: ${phase}(?:\\n|$)`).test(block));
          assert(adapter, `The ${phase} adapter exists`);
          assert.equal(registry(adapter, selected), selected);
        }
      }
      const directory = mkdtempSync(resolve(tmpdir(), 'release-bootstrap-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      // Execute the real Action command and step environment with an installer
      // boundary that reproduces the observed mirror's missing tarball.
      writeFileSync(resolve(directory, 'pnpm'), '#!/bin/sh\n'
        + 'if [ "$npm_config_registry" != "$EXPECTED_REGISTRY" ]; then\n'
        + '  echo "ERR_PNPM_FETCH_404 @semantic-release/core@1.0.0" >&2; exit 1\nfi\n', { mode: 0o755 });
      const command = lines[index].trim().slice('run: '.length);
      const result = spawnSync('bash', ['-ec', command], { encoding: 'utf8', env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, RELEASE_ACTION_ROOT: directory,
        APPLE_RELEASE_TOOLS: directory, EXPECTED_REGISTRY: selected,
        npm_config_registry: installRegistry ?? 'https://registry.npmmirror.com/',
      } });
      assert.equal(result.status, 0, result.stderr);
    });
  }
}
