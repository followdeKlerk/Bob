import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Everything with network/package/build authority is a fixture executable.
// A real PTY is needed because bootstrap intentionally ignores piped answers.
const installer = resolve('install.sh');
const supported = process.platform === 'linux' && existsSync('/usr/bin/script') && existsSync('/usr/bin/setsid');
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
function fixture(t: TestContext, options: {node?: string | false; checkout?: boolean; built?: boolean; manager?: string; missing?: string[]} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bob-bootstrap-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const bin = join(root, 'bin'), home = join(root, 'home'), work = join(root, 'work');
  for (const p of [bin, home, work, join(root, 'tmp')]) mkdirSync(p, {recursive: true});
  const entry = join(root, 'install.sh'), trace = join(root, 'trace');
  copyFileSync(installer, entry);
  const writeCommand = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, {mode: 0o755});
  // No system bin directories in PATH: missing-tool tests cannot fall through
  // to the real downloader, package manager, git, npm, or Node.
  for (const name of ['bash', 'grep', 'dirname', 'basename', 'cat', 'rm', 'mktemp', 'mkdir', 'chmod', 'mv', 'cp', 'xz', 'sha256sum']) {
    symlinkSync(`/usr/bin/${name}`, join(bin, name));
  }
  writeCommand('uname', 'if [[ "$1" == -s ]]; then echo "${FAKE_OS:-Linux}"; else echo "${FAKE_ARCH:-x86_64}"; fi');
  writeCommand('id', 'echo "${FAKE_UID:-1000}"');
  const fakeNode = `if [[ "\${1:-}" == --version ]]; then echo "\${FAKE_NODE_VERSION:-v24.22.1}"; elif [[ "\${2:-}" == setup && "\${3:-}" == --help ]]; then if [[ "\${GUIDED_CAPABILITY:-yes}" == yes ]]; then echo '  --guided Guided setup'; else echo '  --cwd Path'; fi; elif [[ "\${2:-}" == updates && "\${3:-}" == install && "\${4:-}" == --help ]]; then if [[ "\${UPDATES_CAPABILITY:-yes}" == yes ]]; then echo "  --source <checkout> Supervised updates"; else exit 1; fi; else if [[ "\${REQUIRE_CLI_TTY:-}" == yes ]]; then [[ -t 0 ]] || exit 95; fi; { printf 'node'; printf ' <%s>' "$@"; printf '\\n'; } >> "$TRACE"; fi`;
  if (options.node !== false) writeCommand('node', fakeNode);
  const npmBody = `{ printf 'npm'; printf ' <%s>' "$@"; printf '\\n'; } >> "$TRACE"
if [[ "\${1:-}" == run && "\${2:-}" == build ]]; then mkdir -p dist; printf '// built fixture\\n' > dist/cli.js; fi`;
  writeCommand('npm', npmBody);
  writeCommand('git', `printf 'git %s\\n' "$*" >> "$TRACE"
if [[ "\${1:-}" == -C ]]; then
  dir=$2; shift 2
  case "$*" in
    'remote get-url origin') cat "$dir/.git/origin" ;;
    'rev-parse --show-toplevel') [[ -n "\${FAKE_CWD_CHECKOUT:-}" ]] && printf '%s\\n' "$FAKE_CWD_CHECKOUT" ;;
    *) exit 91 ;;
  esac
elif [[ "\${1:-}" == clone ]]; then
  [[ "$2" == -- && "$3" == https://github.com/followdeKlerk/Bob.git ]] || exit 92
  mkdir -p "$4/.git"
  printf '%s\\n' 'https://github.com/followdeKlerk/Bob.git' > "$4/.git/origin"
  printf '%s\\n' '{"name":"@bob-local/cli"}' > "$4/package.json"
  if [[ "\${CLONE_PREBUILT:-}" == yes ]]; then mkdir "$4/dist"; echo '// fixture' > "$4/dist/cli.js"; fi
else exit 93; fi`);
  const curlBody = `printf 'curl %s\\n' "$*" >> "$TRACE"
out=''; url="\${!#}"
while (($#)); do if [[ "$1" == --output ]]; then out=$2; shift 2; else shift; fi; done
case "$url" in
  https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz)
    [[ "\${FAIL_DOWNLOAD:-}" != archive ]] || exit 22
    cp "$ARCHIVE_FIXTURE" "$out" ;;
  https://nodejs.org/dist/v24.22.1/SHASUMS256.txt)
    [[ "\${FAIL_DOWNLOAD:-}" != manifest ]] || exit 22
    if [[ "\${MANIFEST_MODE:-}" == missing ]]; then
      printf '%s  %s\\n' "$CHECKSUM" another-archive.tar.xz > "$out"
    else
      printf '%s  %s\\n' "$CHECKSUM" node-v24.22.1-linux-x64.tar.xz > "$out"
      if [[ "\${MANIFEST_MODE:-}" == duplicate ]]; then printf '%s  %s\\n' "$CHECKSUM" node-v24.22.1-linux-x64.tar.xz >> "$out"; fi
    fi ;;
  *) exit 94 ;;
esac`;
  writeCommand('curl', curlBody);
  writeCommand('tar', `printf 'tar %s\\n' "$*" >> "$TRACE"; exec /usr/bin/tar "$@"`);
  writeCommand('sudo', `printf 'sudo %s\\n' "$*" >> "$TRACE"; "$@"`);
  if (options.manager) writeCommand(options.manager, `printf 'package %s\\n' "$*" >> "$TRACE"; if [[ "$*" != update ]]; then cp "$STAGED_CURL" "$BIN_DIR/curl"; chmod 755 "$BIN_DIR/curl"; fi`);
  const stagedCurl = join(root, 'staged-curl');
  copyFileSync(join(bin, 'curl'), stagedCurl);
  for (const name of options.missing ?? []) rmSync(join(bin, name));
  const source = join(root, 'Bob checkout');
  if (options.checkout !== false) {
    mkdirSync(join(source, '.git'), {recursive: true});
    writeFileSync(join(source, '.git', 'origin'), 'https://github.com/followdeKlerk/Bob.git\n');
    writeFileSync(join(source, 'package.json'), '{"name": "@bob-local/cli"}\n');
    if (options.built !== false) {
      mkdirSync(join(source, 'dist'));
      writeFileSync(join(source, 'dist', 'cli.js'), '// existing live fixture\n');
    }
  }
  const env = {
    ...process.env, PATH: bin, HOME: home, XDG_DATA_HOME: join(home, 'data'), TMPDIR: join(root, 'tmp'),
    TRACE: trace, BIN_DIR: bin, STAGED_CURL: stagedCurl, FAKE_NODE_VERSION: options.node || 'v24.22.1',
  };
  // Build an archive of *fake executables*, never download or run real Node.
  const archiveDir = join(root, 'archive', 'node-v24.22.1-linux-x64', 'bin');
  mkdirSync(archiveDir, {recursive: true});
  writeFileSync(join(archiveDir, 'node'), `#!/bin/bash\nset -eu\n${fakeNode.replace('${FAKE_NODE_VERSION:-v24.22.1}', 'v24.22.1')}\n`, {mode: 0o755});
  copyFileSync(join(bin, 'npm'), join(archiveDir, 'npm'));
  const archive = join(root, 'node.tar.xz');
  const packed = spawnSync('/usr/bin/tar', ['-cJf', archive, '-C', join(root, 'archive'), 'node-v24.22.1-linux-x64']);
  assert.equal(packed.status, 0, packed.stderr?.toString());
  const downloadEnv = {ARCHIVE_FIXTURE: archive, CHECKSUM: createHash('sha256').update(readFileSync(archive)).digest('hex')};
  const run = (answers = '', args: string[] = [], extra: Record<string, string | undefined> = {}, tty = true, explicitSource = true, streamed = false) => {
    const scriptArgs = [...(explicitSource ? ['--source-dir', source] : []), ...args];
    const command = ['/bin/bash', entry, ...scriptArgs];
    const invocation = streamed
      ? `cat ${quote(entry)} | ${['/bin/bash', '-s', '--', ...scriptArgs].map(quote).join(' ')}`
      : command.map(quote).join(' ');
    const result = spawnSync(tty ? '/usr/bin/script' : '/usr/bin/setsid', tty
      ? ['-q', '-e', '-c', invocation, '/dev/null']
      : ['--wait', ...command], {
      cwd: work, env: {...env, ...downloadEnv, ...extra}, encoding: 'utf8', input: answers, timeout: 10_000,
    });
    assert.equal(result.error, undefined, String(result.error));
    return {status: result.status, output: result.stdout + result.stderr};
  };
  const logs = () => existsSync(trace) ? readFileSync(trace, 'utf8') : '';
  return {root, bin, home, work, source, entry, env, run, logs, launcher: join(home, '.local/bin/bob'), runtime: join(home, 'data/bob-bootstrap/node-v24.22.1-linux-x64')};
}

const opts = {skip: !supported};
test('bootstrap help and check are read-only and need no terminal', opts, t => {
  const f = fixture(t, {node: false});
  for (const args of [['--help'], ['--check']]) {
    const r = f.run('', args, {}, false);
    assert.equal(r.status, 0, r.output);
    assert.doesNotMatch(f.logs(), /^(curl|tar|sudo|package|npm|node) /m);
    assert.deepEqual(readdirSync(f.home), []);
    assert.deepEqual(readdirSync(join(f.root, 'tmp')), []);
  }
  assert.match(f.run('', ['--check'], {}, false).output, /private download required/);
});

test('unsupported platform and root execution fail without mutation', opts, t => {
  const f = fixture(t, {node: false});
  for (const extra of [{FAKE_OS: 'Darwin'}, {FAKE_ARCH: 'aarch64'}, {FAKE_UID: '0'}]) {
    const r = f.run('y\ny\ny\n', [], extra);
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /Linux x86_64 only|not root/);
    assert.doesNotMatch(f.logs(), /^(curl|tar|sudo|package|npm|node) /m);
    assert.deepEqual(readdirSync(f.home), []);
  }
});

test('piped answers cannot approve a private runtime install', opts, t => {
  const f = fixture(t, {node: false});
  const r = f.run('y\ny\ny\n', [], {}, false);
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /interactive terminal is required/);
  assert.doesNotMatch(f.logs(), /^(curl|tar|sudo|npm|node) /m);
  assert.deepEqual(readdirSync(f.home), []);
});

test('declining runtime, clone, build and launcher plans never executes that plan', opts, t => {
  for (const scenario of [
    {options: {node: false as const}, forbidden: /^(curl|tar|npm|node) /m},
    {options: {checkout: false}, forbidden: /^git clone|^(npm|node) /m},
    {options: {built: false}, forbidden: /^(npm|node) /m},
    {options: {}, forbidden: /^(npm|node) /m},
  ]) {
    const f = fixture(t, scenario.options), r = f.run('n\n');
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /Declined/);
    assert.doesNotMatch(f.logs(), scenario.forbidden);
    assert.equal(existsSync(f.launcher), false);
    assert.deepEqual(readdirSync(join(f.root, 'tmp')), []);
  }
});

test('missing tools require explicit per-manager consent; declined plans never invoke sudo', opts, t => {
  for (const manager of ['apt-get', 'dnf', 'pacman']) {
    const f = fixture(t, {manager, missing: ['curl']});
    const declined = f.run('n\n');
    assert.notEqual(declined.status, 0, declined.output);
    assert.match(declined.output, new RegExp(`sudo ${manager}.*curl`));
    assert.doesNotMatch(f.logs(), /^(sudo|package) /m);
    const approved = f.run('y\ny\n');
    assert.equal(approved.status, 0, approved.output);
    assert.match(f.logs(), new RegExp(`^sudo ${manager} `, 'm'));
    assert.match(f.logs(), /setup> <--guided>/);
    assert.doesNotMatch(f.logs().replaceAll(f.root, '<fixture>'), /android|sdkmanager|gradle|java|ndk|build:interactive/i);
  }
});

test('unsupported package manager gives actionable instructions without installation', opts, t => {
  const f = fixture(t, {missing: ['curl', 'xz']});
  const r = f.run('y\ny\n');
  assert.notEqual(r.status, 0, r.output);
  assert.match(r.output, /No supported package manager.*curl xz/);
  assert.doesNotMatch(f.logs(), /^(sudo|package|curl|npm|node) /m);
});

test('never overwrites non-Bob sources or unrelated/different Bob launchers', opts, t => {
  for (const scenario of ['source', 'launcher', 'bob-launcher', 'symlink-launcher']) {
    const f = fixture(t);
    const sentinel = 'DO NOT CHANGE\n';
    let protectedFile: string;
    if (scenario === 'source') {
      protectedFile = join(f.source, 'package.json');
      writeFileSync(protectedFile, sentinel);
    } else {
      mkdirSync(dirname(f.launcher), {recursive: true});
      protectedFile = scenario === 'symlink-launcher' ? join(f.root, 'other') : f.launcher;
      writeFileSync(protectedFile, scenario === 'bob-launcher' ? '# Bob bootstrap launcher v1\nexec other-node other-cli "$@"\n' : sentinel);
      if (scenario === 'symlink-launcher') symlinkSync(protectedFile, f.launcher);
    }
    const before = readFileSync(protectedFile);
    const r = f.run('y\ny\ny\ny\n');
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /refusing|Refusing/);
    assert.deepEqual(readFileSync(protectedFile), before);
    assert.doesNotMatch(f.logs(), /^(curl|sudo|package|npm|node) |^git clone/m);
  }
});

test('compatible Node reuses live dist, keeps exact launcher paths, and reruns guided setup', opts, t => {
  const f = fixture(t), before = readFileSync(join(f.source, 'dist/cli.js'));
  const first = f.run('y\n');
  assert.equal(first.status, 0, first.output);
  assert.match(f.logs(), new RegExp(`node <${f.source}/dist/cli.js> <setup> <--guided>`));
  assert.doesNotMatch(f.logs(), /^(npm|curl|tar|sudo) |^git (clone|pull|reset)/m);
  assert.deepEqual(readFileSync(join(f.source, 'dist/cli.js')), before);
  const launcher = readFileSync(f.launcher, 'utf8');
  assert.match(launcher, /# Bob bootstrap launcher v1/);
  assert.ok(launcher.includes(`${f.bin}/node`));
  assert.ok(launcher.includes('Bob\\ checkout/dist/cli.js'));
  assert.equal(f.run('y\n').status, 0);
  assert.equal(readFileSync(f.launcher, 'utf8'), launcher);
  // The generated launcher also works from an unrelated cwd, with spaces in CLI paths.
  const launched = spawnSync('/bin/bash', [f.launcher, '--help'], {cwd: f.work, env: f.env, encoding: 'utf8'});
  assert.equal(launched.status, 0, launched.stderr);
  assert.match(f.logs(), /dist\/cli.js> <--help>/);
});

test('a streamed download reads approvals from the tty and hands the CLI a terminal', opts, t => {
  const f = fixture(t);
  const r = f.run('y\n', [], {REQUIRE_CLI_TTY: 'yes'}, true, true, true);
  assert.equal(r.status, 0, r.output);
  assert.match(f.logs(), /dist\/cli.js> <setup> <--guided>/);
  assert.doesNotMatch(f.logs(), /^(npm|curl|sudo) /m);
});

test('running from a checkout discovers it instead of cloning a second source', opts, t => {
  const f = fixture(t);
  const r = f.run('y\n', [], {FAKE_CWD_CHECKOUT: f.source}, true, false);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, new RegExp(`Source: ${f.source}`));
  assert.doesNotMatch(f.logs(), /^git clone/m);
});

test('Node-free downloaded bootstrap verifies official archive, clones separately, builds only backend and executes guided CLI', opts, t => {
  const f = fixture(t, {node: false, checkout: false});
  const r = f.run('y\ny\ny\ny\n', [], {}, true, false);
  assert.equal(r.status, 0, r.output);
  assert.match(f.logs(), /curl .*https:\/\/nodejs.org\/dist\/v24.22.1\/node-v24.22.1-linux-x64.tar.xz/);
  assert.match(f.logs(), /curl .*SHASUMS256.txt/);
  assert.match(f.logs(), /^tar /m);
  assert.match(f.logs(), /^git clone -- https:\/\/github.com\/followdeKlerk\/Bob.git /m);
  assert.match(f.logs(), /^npm <ci>\nnpm <run> <build>/m);
  assert.match(f.logs(), /\/bob-bootstrap\/source\/dist\/cli.js> <setup> <--guided>/);
  assert.ok(existsSync(join(f.runtime, 'bin/node')));
  assert.ok(existsSync(f.launcher));
  assert.deepEqual(readdirSync(join(f.root, 'tmp')), []);
  assert.doesNotMatch(f.logs().replaceAll(f.root, '<fixture>'), /sudo|global|android|sdkmanager|gradle|java|ndk|build:interactive/i);
});

test('incompatible and prerelease Node versions require a private download; compatible 24.x is reused', opts, t => {
  for (const version of ['v20.19.0', 'v24.22.0', 'v25.0.0', 'v24.23.0-rc.1', 'v24.22.1', 'v24.23.0']) {
    const f = fixture(t, {node: version});
    const r = f.run('', ['--check'], {}, false);
    assert.equal(r.status, 0, r.output);
    assert.equal(r.output.includes('private download required'), !['v24.22.1', 'v24.23.0'].includes(version), version);
    assert.doesNotMatch(f.logs(), /^(curl|tar|npm|sudo|node) /m);
  }
});

test('checksum mismatch/missing entry and failed downloads never extract, build, or publish runtime', opts, t => {
  for (const extra of [{CHECKSUM: '0'.repeat(64)}, {CHECKSUM: 'bad'}, {MANIFEST_MODE: 'missing'}, {MANIFEST_MODE: 'duplicate'}, {FAIL_DOWNLOAD: 'archive'}, {FAIL_DOWNLOAD: 'manifest'}]) {
    const f = fixture(t, {node: false});
    const r = f.run('y\ny\ny\n', [], extra);
    assert.notEqual(r.status, 0, r.output);
    assert.match(r.output, /SHA256|download failed/);
    assert.doesNotMatch(f.logs(), /^(tar|npm|node) /m);
    assert.equal(existsSync(f.runtime), false);
    assert.equal(existsSync(f.launcher), false);
    assert.deepEqual(readdirSync(join(f.root, 'tmp')), []);
  }
});

test('old compiled CLIs fail capability detection without rebuild or launcher publication', opts, t => {
 const f=fixture(t), before=readFileSync(join(f.source,'dist/cli.js'));
 const result=f.run('y\n',[],{GUIDED_CAPABILITY:'no'});
 assert.notEqual(result.status,0,result.output);assert.match(result.output,/does not support setup --guided/);
 assert.equal(existsSync(f.launcher),false);assert.deepEqual(readFileSync(join(f.source,'dist/cli.js')),before);
 assert.doesNotMatch(f.logs(),/^(npm|curl|sudo) |<--guided>/m);
});

test('a stale compiled CLI without update installation cannot publish a misleading launcher', opts, t => {
 const f=fixture(t);const result=f.run('y\n',[],{UPDATES_CAPABILITY:'no'});
 assert.notEqual(result.status,0,result.output);assert.match(result.output,/does not support supervised updates installation/);
 assert.equal(existsSync(f.launcher),false);assert.doesNotMatch(f.logs(),/setup> <--guided>/);
});
