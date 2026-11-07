import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

// Publication guards, not a secret scanner or historical-data clearance.
export function privateArtifact(path: string): boolean {
  return /^(?:docs|state|\.state|\.bob|bob-state|runtime|backups|private|secrets|screenshots|recordings|captures)\//.test(path)
    || /(?:^|\/)(?:\.env(?:\..+)?|auth\.json|credentials\.json|firebase-push\.json|google-services\.json|signing\.properties|soul\.md|SOUL\.md|core-prompt\.md)$/.test(path) && !/(?:^|\/)\.env\.example$/.test(path)
    || /\.(?:apk|aab|keystore|jks|p12|pfx|pem|key|sqlite(?:-.*)?|db(?:-.*)?|log|tgz|backup|bak)$/.test(path);
}

test('tracked publication paths exclude installation state and private artifacts', () => {
  const paths = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(path => path && existsSync(path));
  assert.deepEqual(paths.filter(privateArtifact), []);
});

test('private artifact classification keeps generic prompts and synthetic provenance', () => {
  for (const path of ['state/chat.json', 'docs/acceptance.md', '.env', '.env.production', 'keys/release.keystore', 'backup.sqlite-wal', 'auth.json', 'soul.md', 'release.apk']) assert.equal(privateArtifact(path), true, path);
  for (const path of ['.env.example', 'packages/resources/soul.default.md', 'test/fixtures/pi14-state.ts', 'assets/learning/upstream/LICENSE', 'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar']) assert.equal(privateArtifact(path), false, path);
});

test('ignore rules cover representative private installation artifacts', () => {
  const paths = ['.env', '.env.production', 'state/conversations.json', 'backups/export.json', 'private/report.txt', 'release.keystore', 'local.sqlite-wal', 'soul.md', 'auth.json', 'screenshots/private.png'];
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {input: paths.join('\n') + '\n', encoding: 'utf8'}).trim().split('\n');
  assert.deepEqual(ignored, paths);
});
