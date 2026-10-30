import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import https from 'node:https';

for (const option of ['--cert', '--key']) test(`serve ${option} alone rejects before initializing state`, () => {
 const dir = mkdtempSync(join(tmpdir(), 'bob-cli-serve-'));
 const state = join(dir, 'missing-state');
 try {
  // Public host makes even the old implementation exit instead of starting a plaintext listener.
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--state', state,
   'serve', '--host', '0.0.0.0', '--port', '0', option, join(dir, 'unused.pem')],
   {encoding: 'utf8', timeout: 15000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(existsSync(state), false, 'invalid TLS options must not create state');
  assert.match(result.stderr, /--cert and --key must be supplied together/);
  assert.equal(result.stdout, '');
 } finally { rmSync(dir, {recursive: true, force: true}); }
});

for (const encrypted of [false, true]) test(`serve reports actual ${encrypted ? 'HTTPS' : 'HTTP'} transport`, {timeout: 25000}, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'bob-cli-serve-'));
 const cert = join(dir, 'cert.pem'), key = join(dir, 'key.pem');
 let child: ReturnType<typeof spawn> | undefined;
 let exited: Promise<unknown> | undefined;
 try {
  if (encrypted) {
   const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], {stdio: 'ignore'});
   assert.equal(result.status, 0);
  }
  child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--state', join(dir, 'state'),
   'serve', '--port', '0', ...(encrypted ? ['--cert', cert, '--key', key] : [])],
   {stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, killSignal: 'SIGKILL'});
  exited = once(child, 'exit');
  let stderr = '';
  child.stderr!.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const report = await new Promise<{encrypted: boolean; listening: {port: number}}>((resolve, reject) => {
   let stdout = '';
   child!.stdout!.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (stdout.includes('\n')) {
     try { resolve(JSON.parse(stdout.split('\n')[0])); } catch (error) { reject(error); }
    }
   });
   child!.once('error', reject);
   child!.once('exit', code => reject(new Error(`serve exited ${code}: ${stderr}`)));
  });
  assert.equal(report.encrypted, encrypted);
  const status = await new Promise<number | undefined>((resolve, reject) => {
   const request = (encrypted ? https : http).get({hostname: '127.0.0.1', port: report.listening.port,
    path: '/v1/status', ...(encrypted ? {ca: readFileSync(cert)} : {})}, response => {
    response.resume();
    resolve(response.statusCode);
   });
   request.on('error', reject);
   request.setTimeout(3000, () => request.destroy(new Error('transport request timed out')));
  });
  assert.equal(status, 401);
 } finally {
  child?.kill('SIGTERM');
  await exited;
  rmSync(dir, {recursive: true, force: true});
 }
});
