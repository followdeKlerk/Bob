import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

function configuredTemp(value?: string) {
  const env = {...process.env};
  if (value === undefined) delete env.TMPDIR;
  else env.TMPDIR = value;
  return JSON.parse(execFileSync(process.execPath, ['--import', './test/environment.mjs', '--input-type=module', '-e',
    "import {tmpdir} from 'node:os'; console.log(JSON.stringify({configured:process.env.TMPDIR,os:tmpdir()}))"], {env, encoding: 'utf8'}));
}

test('test bootstrap supplies an OS temporary directory in a clean shell', () => {
  for (const value of [undefined, '']) {
    const result = configuredTemp(value);
    assert.ok(result.configured);
    assert.equal(result.configured, result.os);
  }
});

test('test bootstrap preserves an explicitly selected temporary directory', () => {
  assert.equal(configuredTemp('/tmp/bob-test-explicit').configured, '/tmp/bob-test-explicit');
});
