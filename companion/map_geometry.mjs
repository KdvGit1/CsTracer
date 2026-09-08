import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const finitePoint = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

// AWMH v1: header + float32 vertices + uint32 triangle vertex indices.
// Format: https://github.com/pnxenopoulos/awpy-data#collision-meshes
export function decodeMesh(buffer) {
  if (buffer.length < 16 || buffer.toString('ascii', 0, 4) !== 'AWMH' || buffer.readUInt32LE(4) !== 1) throw new Error('Unsupported collision mesh');
  const nv = buffer.readUInt32LE(8), nt = buffer.readUInt32LE(12);
  if (!nv || !nt || nv > 8_000_000 || nt > 8_000_000 || buffer.length !== 16 + nv * 12 + nt * 12) throw new Error('Invalid collision mesh size');
  const vertices = new Float32Array(nv * 3), triangles = new Uint32Array(nt * 3);
  for (let i = 0; i < vertices.length; i++) {
    const v = buffer.readFloatLE(16 + i * 4);
    if (!Number.isFinite(v) || Math.abs(v) > 1_000_000) throw new Error('Invalid mesh coordinate');
    vertices[i] = v;
  }
  for (let i = 0; i < triangles.length; i++) {
    const v = buffer.readUInt32LE(16 + vertices.length * 4 + i * 4);
    if (v >= nv) throw new Error('Invalid mesh index');
    triangles[i] = v;
  }
  return { vertices, triangles };
}

export class CollisionMesh {
  constructor({ vertices, triangles }) {
    this.vertices = vertices; this.triangles = triangles;
    const count = triangles.length / 3;
    const centroids = new Float32Array(count * 3);
    this.order = Uint32Array.from({ length: count }, (_, i) => i);
    for (let t = 0; t < count; t++) for (let axis = 0; axis < 3; axis++) centroids[t * 3 + axis] = (vertices[triangles[t * 3] * 3 + axis] + vertices[triangles[t * 3 + 1] * 3 + axis] + vertices[triangles[t * 3 + 2] * 3 + axis]) / 3;
    const build = (start, end) => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++) for (let j = 0; j < 3; j++) {
        const v = triangles[this.order[i] * 3 + j] * 3;
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], vertices[v + a]); max[a] = Math.max(max[a], vertices[v + a]); }
      }
      const node = { min, max, start, end, left: null, right: null };
      if (end - start > 12) {
        let axis = 0;
        for (let a = 1; a < 3; a++) if (max[a] - min[a] > max[axis] - min[axis]) axis = a;
        this.order.subarray(start, end).sort((a, b) => centroids[a * 3 + axis] - centroids[b * 3 + axis]);
        const middle = (start + end) >>> 1;
        node.left = build(start, middle); node.right = build(middle, end);
      }
      return node;
    };
    this.root = build(0, count);
  }
  // Segment intersection, double-sided triangles, nearest hit in world units.
  trace(origin, end) {
    if (!finitePoint(origin) || !finitePoint(end)) return null;
    const d = end.map((v, i) => v - origin[i]);
    const distance = Math.hypot(...d);
    if (distance < .01) return null;
    let best = 1;
    const box = (node) => {
      let near = 0, far = best;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-10) { if (origin[a] < node.min[a] || origin[a] > node.max[a]) return false; }
        else {
          const t1 = (node.min[a] - origin[a]) / d[a], t2 = (node.max[a] - origin[a]) / d[a];
          near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
          if (near > far) return false;
        }
      }
      return true;
    };
    const stack = [this.root], v = this.vertices, ix = this.triangles;
    while (stack.length) {
      const node = stack.pop();
      if (!box(node)) continue;
      if (node.left) { stack.push(node.left, node.right); continue; }
      for (let i = node.start; i < node.end; i++) {
        const t = this.order[i] * 3, a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
        const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
        const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const determinant = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(determinant) < 1e-9) continue;
        const tx = origin[0] - v[a], ty = origin[1] - v[a + 1], tz = origin[2] - v[a + 2];
        const u = (tx * px + ty * py + tz * pz) / determinant;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const w = (d[0] * qx + d[1] * qy + d[2] * qz) / determinant;
        if (w < 0 || u + w > 1) continue;
        const hit = (e2x * qx + e2y * qy + e2z * qz) / determinant;
        if (hit > .05 / distance && hit < best && hit < 1 - .05 / distance) best = hit;
      }
    }
    return best < 1 ? best * distance : null;
  }
}

let cached = null;
export function loadMapGeometry(mapName, header = {}) {
  const map = String(mapName || '').replace(/\\/g, '/').split('/').pop().replace(/\.(vpk|bsp)$/i, '');
  if (!/^(de|cs|ar)_[a-z0-9_]+$/.test(map)) return { mesh: null, status: 'missing', map };
  try {
    const manifest = JSON.parse(readFileSync(new URL('./geometry/manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
    const entry = manifest.maps?.[map];
    if (!entry || entry.file !== `${map}.mesh.gz`) return { mesh: null, status: 'missing', map };
    const revision = String(header.client_version || header.server_version || '');
    const status = revision ? revision === String(manifest.clientVersion) ? 'matched' : 'version-mismatch' : 'version-unverified';
    if (status === 'version-mismatch') return { mesh: null, status, map, release: manifest.release };
    if (cached?.map === map && cached.sha256 === entry.sha256) return { ...cached, status };
    const compressed = readFileSync(new URL(`./geometry/${entry.file}`, import.meta.url));
    if (createHash('sha256').update(compressed).digest('hex') !== entry.sha256) throw new Error('Geometry checksum mismatch');
    cached = { map, sha256: entry.sha256, release: manifest.release, status, mesh: new CollisionMesh(decodeMesh(gunzipSync(compressed, { maxOutputLength: 200_000_000 }))) };
    return cached;
  } catch (error) { return { mesh: null, status: 'unavailable', map, reason: error.message }; }
}
