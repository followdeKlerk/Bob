#!/usr/bin/env node
// Inspect npm's actual publication inventory without publishing or writing a tarball.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {posix} from 'node:path';

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--offline', '--ignore-scripts', '--json'], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000,
}));
const paths = new Set(pack.files.map(file => file.path));
const rootPaths = [...paths].filter(path => !path.startsWith('node_modules/'));
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const workspaceRoots = manifest.bundleDependencies.filter(name => name.startsWith('@bob-local/')).map(name => `node_modules/${name}/`);
const ownedPaths = [...paths].flatMap(path => {
  if (!path.startsWith('node_modules/')) return [{full: path, relative: path}];
  const root = workspaceRoots.find(root => path.startsWith(root));
  if (!root) return [];
  const relative = path.slice(root.length);
  return relative.startsWith('node_modules/') ? [] : [{full: path, relative}];
});
for (const path of ['dist/cli.js', 'LICENSE', 'README.md', 'INSTALL.md', 'FEATURES.md', 'CONTRIBUTING.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md']) {
  assert.ok(paths.has(path), `Required package file missing: ${path}`);
}
for (const {relative: path, full} of ownedPaths) {
  assert.ok(!/^(?:docs|state|\.state|\.bob|bob-state|runtime|backups|private|secrets|screenshots|recordings|captures)\//.test(path), `Private directory packaged: ${full}`);
  assert.ok(!/(?:^|\/)(?:\.env(?:\..+)?|auth\.json|credentials\.json|signing\.properties|firebase-push\.json|google-services\.json|soul\.md|SOUL\.md|core-prompt\.md)$/.test(path), `Private config packaged: ${full}`);
  assert.ok(!/\.(?:apk|aab|keystore|jks|p12|pfx|pem|key|sqlite(?:-.*)?|db(?:-.*)?|log|tgz|backup|bak)$/.test(path), `Private or release artifact packaged: ${full}`);
}
// Root-package guides must not depend on unshipped local documents or images.
// Bundled workspace READMEs may target their source repository rather than this installation layout.
for (const path of rootPaths.filter(path => path.endsWith('.md'))) {
  const text = readFileSync(path, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  const links = [...text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)].map(match => match[1]);
  links.push(...[...text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]));
  for (const link of links) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(link)) continue;
    const target = posix.normalize(posix.join(posix.dirname(path), decodeURIComponent(link.split('#')[0])));
    assert.ok(paths.has(target), `Unshipped documentation target: ${path} -> ${link}`);
  }
}
console.log(`Package inventory passed: ${paths.size} files (${rootPaths.length} root-package files; ${ownedPaths.length} first-party paths checked), ${pack.unpackedSize} unpacked bytes. Root-guide links verified. No publish performed. Bundled workspace guide links and third-party contents are outside these guards; this is not a comprehensive secret audit.`);
