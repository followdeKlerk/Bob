import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

// Structural guards, not a claim that a model understands or obeys the manual.
const guides = ['README.md', 'CONTRIBUTING.md', 'INSTALL.md', 'SETUP-AGENT.md', 'FEATURES.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md',
  'apps/mobile/README.md', 'packages/memory/README.md', 'assets/learning/README.md',
  'assets/learning/memory-threats/README.md', 'apps/mobile/components/ui/README.md',
  'apps/mobile/android/app/src/main/assets/fonts/README.md'];
const read = (path: string) => readFileSync(path, 'utf8');
const withoutFences = (text: string) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
function anchors(text: string) {
  const found = new Set<string>(), counts = new Map<string, number>();
  for (const match of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1]!.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    found.add(count ? `${slug}-${count}` : slug); counts.set(slug, count + 1);
  }
  return found;
}
function linkErrors(file: string, text: string) {
  const errors: string[] = [];
  // Maintained guides use inline Markdown links; external URLs are not fetched.
  for (const match of withoutFences(text).matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const link = match[1]!;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
    const [path, fragment] = link.split('#');
    const target = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    if (!existsSync(target)) errors.push(`Missing target: ${file} -> ${link}`);
    else if (fragment && !anchors(read(target)).has(decodeURIComponent(fragment)))
      errors.push(`Missing heading: ${file} -> ${link}`);
  }
  for (const match of withoutFences(text).matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const link = match[1]!;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link)) continue;
    if (!existsSync(resolve(dirname(file), decodeURIComponent(link))))
      errors.push(`Missing image: ${file} -> ${link}`);
  }
  return errors;
}
test('maintained documentation links and headings resolve locally', () => {
  assert.deepEqual(guides.flatMap(file => linkErrors(file, read(file))), []);
});
// User guides explain workflows; live tool schemas are the API reference.
test('feature guide retains the main user workflows', () => {
  const headings = anchors(read('FEATURES.md'));
  for (const section of ['app-navigation', 'conversation-controls', 'models-and-conversation-settings',
    'files-and-web', 'notes', 'skills-and-automatic-learning', 'memory', 'history-and-connected-agents',
    'subagents', 'phone-tools', 'phone-location', 'keep-connected', 'interactive-views', 'read-aloud',
    'notifications', 'scheduling', 'app-diagnostics', 'updates']) {
    assert.ok(headings.has(section), 'Missing user workflow: ' + section);
  }
  assert.doesNotMatch(read('FEATURES.md'), /\/home\/ndk\/|defineTool\(|source SHA-256|```(?:json|typescript|ts)\b/);
});
test('documentation guards detect drift rather than silently passing', () => {
  assert.equal(linkErrors('README.md', '[bad](nonexistent-documentation-target.md)').length, 1);
  assert.equal(linkErrors('README.md', '<img src="nonexistent-showcase.png">').length, 1);
  assert.equal(linkErrors('README.md', '[bad](FEATURES.md#nonexistent-heading)').length, 1);
  assert.deepEqual([...anchors('# Repeat\n# Repeat\n```md\n# Hidden\n```')], ['repeat', 'repeat-1']);
  assert.deepEqual(linkErrors('README.md', '```md\n[example](not-a-real-file.md)\n```'), []);
});


test('retired development manuals stay out of public guides and package contents', () => {
  const retired = ['OPERATIONS.md', 'PI15-MIGRATION.md', 'SCHEMA-MIGRATION.md', 'PHONE-CAPABILITIES.md',
    'assets/learning/ACCEPTANCE.md', 'assets/learning/reuse-evaluation.md', 'assets/showcase/README.md'];
  const manifest = JSON.parse(read('package.json'));
  for (const file of retired) {
    assert.equal(existsSync(file), false, file + ' should remain retired');
    assert.ok(!manifest.files.includes(file), file + ' should not be packaged');
    for (const guide of guides) assert.ok(!read(guide).includes(file), guide + ' still refers to ' + file);
  }
});

test('outdated showcase media stay out of the repository guides', () => {
  for (const name of ['coding-demo.gif', 'coding-request.png', 'coding-result.png', 'coding-tests.png',
    'model-picker.png', 'agents-active.png', 'agents-history.png']) {
    assert.equal(existsSync('assets/showcase/' + name), false, 'Outdated capture: ' + name);
  }
  for (const guide of guides) assert.ok(!read(guide).includes('assets/showcase/'), guide + ' links to the retired showcase');
});
