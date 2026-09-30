import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);

test('package exports and publishes the Browser Use facade', () => {
  assert.deepEqual(packageJson.exports['./browser-use'], {
    types: './browser-use/index.d.ts',
    import: './browser-use/index.js',
  });
  for (const file of [
    'browser-use/index.js',
    'browser-use/index.d.ts',
    'browser-use/README.md',
  ]) {
    assert.ok(packageJson.files.includes(file), `${file} must be published`);
  }
  assert.doesNotMatch(packageJson.scripts.prepack, /stage-browser-use-skill/u);
});
