import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.argv[2]);
const data = mkdtempSync(join(tmpdir(), 'tracer-portable-check-'));
const children = [];
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function check(script, route, environment) {
  const port = await freePort(), started = Date.now();
  let errors = '';
  const child = spawn(join(root, 'runtime/node.exe'), [join(root, script)], { cwd: root, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), TRACER_COMPANION_PORT: String(port), TRACER_DATA_DIR: data, TRACER_SKIP_GSI_AUTO_OPTIMIZE: '1', ...environment }, stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(child);
  child.stderr.on('data', (b) => { errors += b; });
  child.on('error', (e) => { errors += e.message; });
  const base = `http://127.0.0.1:${port}`;
  while (Date.now() - started < 60_000) {
    if (child.exitCode !== null) throw new Error(`${script} kapandı: ${errors}`);
    let response;
    try { response = await fetch(base + route, { signal: AbortSignal.timeout(2000) }); } catch { await new Promise((r) => setTimeout(r, 300)); continue; }
    if (response.status !== 200) throw new Error(`${script}: HTTP ${response.status} ${errors}`);
    const body = await response.text();
    if (route === '/') {
      if (!body.includes('TRACER')) throw new Error('Portable ana sayfası oluşturulamadı.');
      const assets = [...new Set([...body.matchAll(/(?:src|href)="(\/[^"<>]+\.(?:js|css)(?:\?[^"<>]*)?)"/g)].map((m) => m[1]))];
      if (!assets.length) throw new Error('Arayüz JS/CSS dosyaları bulunamadı.');
      for (const asset of [...assets, '/maps/de_cache.png']) if (!(await fetch(base + asset)).ok) throw new Error('Portable arayüz dosyası eksik: ' + asset);
    } else JSON.parse(body);
    console.log(`${script}: HTTP 200, ${Date.now() - started} ms; ${route === '/' ? 'JS/CSS ve Cache radarı doğrulandı' : 'yerel servis hazır'}`);
    return;
  }
  throw new Error(`${script}: başlangıç zaman aşımı. ${errors}`);
}
try {
  await check('app-runtime/server.js', '/', {});
  await check('companion/server.mjs', '/health', {});
} finally { for (const child of children) child.kill(); }
