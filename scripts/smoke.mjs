import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const apiUrl = process.env.API_URL || 'https://api.example.invalid/v1';
const brokerUrl = process.env.BROKER_URL || 'wss://ws.example.invalid/native';
const port = process.env.SMOKE_PORT || '3187';
const base = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
let server;
let logs = '';
try {
  if (!process.env.SMOKE_BASE_URL) {
    await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
    await cp('public', '.next/standalone/public', { recursive: true });
    server = spawn(process.execPath, ['.next/standalone/server.js'], {
      env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: port, API_URL: apiUrl, BROKER_URL: brokerUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; }
    } catch { /* Aguarda o servidor iniciar. */ }
    await setTimeout(200);
  }
  assert.ok(ready, `Servidor não ficou saudável. ${logs}`);
  const config = await fetch(`${base}/api/runtime-config`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await config.json(), { apiUrl, brokerUrl });
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok' });
  const chat = await fetch(`${base}/chat`, { redirect: 'manual' });
  assert.equal(chat.status, 307);
  assert.equal(new URL(chat.headers.get('location'), base).pathname, '/');
  assert.match(chat.headers.get('cache-control'), /no-store/);
  for (const path of ['/', '/register']) {
    const response = await fetch(base + path, { redirect: 'manual', headers: { Cookie: 'chat_token=smoke-only' } });
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location'), base).pathname, '/chat');
  }
  const login = await fetch(base);
  assert.equal(login.status, 200);
  const html = await login.text();
  assert.match(html, /Entrar no Chat/);
  const asset = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/);
  assert.ok(asset, 'Página deve servir os assets copiados do build');
  const staticResponse = await fetch(new URL(asset[1], base));
  assert.equal(staticResponse.status, 200);
  assert.match(staticResponse.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/register`)).status, 200);
  assert.equal((await fetch(`${base}/chat`, { headers: { Cookie: 'chat_token=smoke-only' } })).status, 200);
  assert.equal((await fetch(`${base}/does-not-exist`)).status, 404);
  console.log('Smoke aprovado: standalone, runtime config, health, autenticação, rotas e cache de assets.');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
}
