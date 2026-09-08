import { readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function parseVersion(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(String(value))) throw new Error('Sürüm X.Y.Z biçiminde olmalı; örnek: 0.52.0');
  const parts = value.split('.').map(Number);
  if (parts.some((n) => !Number.isSafeInteger(n) || n > 1_000_000)) throw new Error('Sürüm sayısı çok büyük.');
  return parts;
}
export function compareVersion(a, b) {
  const aa = parseVersion(a), bb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return Math.sign(aa[i] - bb[i]);
  return 0;
}
export function artifactVersions(files) {
  return files.flatMap((name) => {
    const match = /^TRACER-(?:Patch|Portable)-v(\d+\.\d+\.\d+)(?:-\d{8}-\d{6}(?:-\d+)?)?\.(zip|rar)$/i.exec(name);
    return match ? [match[1]] : [];
  });
}
export function suggestVersion(current, files) {
  const highest = [current, ...artifactVersions(files)].sort(compareVersion).at(-1);
  const parts = parseVersion(highest); parts[2]++; return parts.join('.');
}
export function validatePackageVersion(target, current, files) {
  parseVersion(target);
  if (compareVersion(target, current) < 0) throw new Error(`Sürüm mevcut ${current} sürümünden küçük olamaz.`);
  if (artifactVersions(files).some((v) => compareVersion(v, target) >= 0)) throw new Error('Bu veya daha yüksek sürüm zaten paketlenmiş. Daha yüksek bir sürüm gir.');
  return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , command, current, directory, target] = process.argv;
    const files = existsSync(directory) ? readdirSync(directory) : [];
    console.log(command === 'suggest' ? suggestVersion(current, files) : validatePackageVersion(target, current, files));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
