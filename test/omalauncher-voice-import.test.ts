import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

// Byte/provenance guards only: these do not compile Kotlin or exercise speech/chat.
const root = 'apps/mobile/upstream/omalauncher';
const kotlin = 'app/src/main/kotlin/dev/omalauncher/';
const expected = [
  'LICENSE', 'THIRD_PARTY.md', 'gradle/libs.versions.toml',
  'app/src/main/assets/licenses/apache-2.0.txt',
  ...['SpeakNowActivity', 'VoiceActivity'].map(name => `${kotlin}${name}.kt`),
  ...['Speech', 'Speaker', 'VoiceScreen', 'BobConversationPicker'].map(name => `${kotlin}ui/voice/${name}.kt`),
  ...['VoiceSession', 'AgentLink', 'BobLink', 'BobSessionGuard'].map(name => `${kotlin}voice/${name}.kt`),
  `${kotlin}widgets/runtime/Dictation.kt`,
  ...['values', 'values-de', 'values-es', 'values-in', 'values-pt', 'values-ru', 'values-zh']
    .map(locale => `app/src/main/res/${locale}/strings_voice.xml`),
  ...['AgentLinkTest', 'YesNoTest', 'BobLinkTest', 'BobSessionGuardTest']
    .map(name => `app/src/test/kotlin/dev/omalauncher/voice/${name}.kt`),
].sort();
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function inventory(directory: string, relative = ''): string[] {
  assert.ok(!lstatSync(directory).isSymbolicLink(), `Symlink: ${directory}`);
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name), entry = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(path);
    assert.ok(!stat.isSymbolicLink(), `Symlink: ${entry}`);
    if (stat.isDirectory()) return inventory(path, entry);
    assert.ok(stat.isFile(), `Not a regular file: ${entry}`);
    return [entry];
  }).sort();
}

test('unchanged phone Voice snapshot matches the exact allowlist and SHA256 inventory', () => {
  const manifest = readFileSync(join(root, 'SHA256SUMS'));
  assert.equal(sha(manifest), '4a3c3587298f83c7a976c742eae126b6e7e19f02eff77483cbf141888d1eb7a9');
  const rows = manifest.toString('utf8').trimEnd().split('\n').map(line => {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);
    assert.ok(match, `Invalid checksum row: ${line}`);
    assert.ok(!match[2]!.startsWith('/') && !match[2]!.split('/').includes('..'));
    return [match[2]!, match[1]!] as const;
  });
  assert.deepEqual(rows.map(([path]) => path), expected);
  assert.deepEqual(inventory(join(root, 'source')), expected);
  let bytes = 0;
  for (const [path, hash] of rows) {
    const data = readFileSync(join(root, 'source', path));
    bytes += data.length;
    assert.equal(sha(data), hash, path);
  }
  assert.equal(bytes, 311078);
  const transfer = JSON.parse(read('TRANSFER.json'));
  assert.equal(transfer.head, 'af07fb11e2b72337e2e189bb0f75eecba7ee5a04');
  assert.equal(transfer.workingTree, 'dirty');
  assert.equal(transfer.hostKeyFingerprint, 'SHA256:ES4FJP+7URpoEkvItJggVStxVyUnM+iqa5Scjg9PoX8');
  assert.equal(transfer.copiedFiles, 26);
  for (const phase of ['remoteBefore', 'remoteAfter', 'local']) {
    assert.deepEqual(transfer[phase], Object.fromEntries(rows), phase);
  }
});

test('snapshot retains upstream attribution, exclusions and the immutable-reference/adapted-integration boundary', () => {
  const license = read('source/LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Simon Schubert and contributors/);
  assert.match(license, /This license does not cover the third-party files listed in THIRD_PARTY\.md/);
  assert.match(read('source/THIRD_PARTY.md'), /Coding agent logos/);
  assert.match(read('source/app/src/main/assets/licenses/apache-2.0.txt'), /Apache License/);
  const documentation = read('README.md');
  assert.match(documentation, /Immutable reference, adapted integration/);
  assert.match(documentation, /Do not describe this engine as offline-only/);
  for (const dependency of ['Compose Multiplatform', 'Android Jetpack', 'Kotlin and kotlinx.coroutines', 'JSON-java']) {
    assert.ok(documentation.includes(dependency), dependency);
  }
});
