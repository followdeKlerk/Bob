import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, globSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {CodingTools} from '@earendil-works/pi-durable/tools';

// Structural guards, not a claim that a model understands or obeys the manual.
const guides = ['README.md', 'INSTALL.md', 'SETUP-AGENT.md', 'AGENTS.md', 'FEATURES.md', 'OPERATIONS.md',
  'apps/mobile/README.md', 'packages/memory/README.md'];
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
  return errors;
}
function declaredTools(path: string, source: string) {
  // Bob currently declares tools with a literal name as the first property.
  // Fail closed if that convention changes; never silently omit a declaration.
  const calls = [...source.matchAll(/\bdefineTool\s*\(/g)].length;
  const names = [...source.matchAll(/\bdefineTool\s*\(\s*\{\s*name\s*:\s*(['"])([a-z0-9_]+)\1/g)].map(match => match[2]!);
  assert.equal(names.length, calls, `${path}: tool declaration format changed; update documentation discovery`);
  return names;
}
const missingTools = (names: string[], guide: string) => names.filter(name => !guide.includes('`' + name + '`'));

test('maintained documentation links and headings resolve locally', () => {
  assert.deepEqual(guides.flatMap(file => linkErrors(file, read(file))), []);
});
test('every declared Bob tool and upstream coding tool appears in FEATURES', () => {
  const paths = globSync(['src/**/*.ts', 'packages/*/src/**/*.ts']);
  const names = [...new Set([...paths.flatMap(path => declaredTools(path, read(path))),
    ...(CodingTools.tools ?? []).map(tool => tool.name)])];
  assert.ok(names.length > 0, 'No tools discovered');
  assert.deepEqual(missingTools(names, read('FEATURES.md')), [], 'Document each tool by its exact backticked name');
});
test('documentation guards detect drift rather than silently passing', () => {
  assert.equal(linkErrors('README.md', '[bad](nonexistent-documentation-target.md)').length, 1);
  assert.equal(linkErrors('README.md', '[bad](FEATURES.md#nonexistent-heading)').length, 1);
  assert.deepEqual(missingTools(['new_tool'], '`notes`'), ['new_tool']);
  assert.deepEqual(declaredTools('fixture.ts', 'defineTool({name:"new_tool", description:"example"})'), ['new_tool']);
  assert.throws(() => declaredTools('fixture.ts', 'defineTool(dynamicDefinition)'));
  assert.deepEqual([...anchors('# Repeat\n# Repeat\n```md\n# Hidden\n```')], ['repeat', 'repeat-1']);
  assert.deepEqual(linkErrors('README.md', '```md\n[example](not-a-real-file.md)\n```'), []);
});
