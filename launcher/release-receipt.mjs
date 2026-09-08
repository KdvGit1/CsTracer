import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const [command, directory, version] = process.argv.slice(2);
const root = resolve(directory);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Geçersiz sürüm.');
const receiptPath = join(root, 'release', `READY-v${version}.json`);
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function sourceHash() {
  const files = [...new Set(execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 10_000_000 }).split('\0').filter(Boolean))].sort();
  const digest = createHash('sha256');
  for (const file of files) digest.update(file + '\0' + await hash(join(root, file)) + '\0');
  return digest.digest('hex');
}
const names = [`TRACER-Patch-v${version}.zip`, `TRACER-Guncelleyici-Duzeltmesi-v${version}.zip`, `TRACER-Portable-v${version}.rar`];
if (command === 'record') {
  const artifacts = {};
  for (const name of names) artifacts[name] = await hash(join(root, 'release', name));
  writeFileSync(receiptPath, JSON.stringify({ version, preparedAt: new Date().toISOString(), sourceHash: await sourceHash(), artifacts }, null, 2) + '\n');
  console.log('Yayına hazır: ' + version);
} else if (command === 'verify') {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  if (receipt.version !== version || receipt.sourceHash !== await sourceHash()) throw new Error('Kaynaklar hazırlıktan sonra değişmiş; önce BuildOnly çalıştırılmalı.');
  for (const name of names) if (receipt.artifacts[name] !== await hash(join(root, 'release', name))) throw new Error('Paket değişmiş veya bozuk: ' + name);
  console.log('Hazır sürüm ve paketler doğrulandı: ' + version);
} else throw new Error('Bilinmeyen komut.');
