const radians = (n) => n * Math.PI / 180;
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function cameraFor(row) {
  if (!row || !['X', 'Y', 'Z', 'pitch', 'yaw'].every((k) => Number.isFinite(row[k]))) return null;
  const yaw = radians(row.yaw), pitch = radians(row.pitch);
  const duck = Number.isFinite(row.duck_amount) ? Math.max(0, Math.min(1, row.duck_amount)) : 0;
  const fov = Number.isFinite(row.fov) && row.fov > 1 && row.fov < 150 ? row.fov : 90;
  return { origin: [row.X, row.Y, row.Z + 64 - duck * 18],
    forward: [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)],
    right: [Math.sin(yaw), -Math.cos(yaw), 0],
    up: [Math.sin(pitch) * Math.cos(yaw), Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)],
    tanH: Math.tan(radians(fov / 2)) * 4 / 3, tanV: Math.tan(radians(fov / 2)) * 3 / 4,
    fov, aspect: 16 / 9 };
}
export function projectPoint(camera, point) {
  if (!camera || !point || !point.every(Number.isFinite)) return null;
  const relative = point.map((v, i) => v - camera.origin[i]), depth = dot3(relative, camera.forward);
  if (depth <= .5) return null;
  const x = .5 + dot3(relative, camera.right) / (depth * camera.tanH * 2);
  const y = .5 - dot3(relative, camera.up) / (depth * camera.tanV * 2);
  return { x, y, depth, inFrame: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}
export function bodyPoints(row) {
  if (!row || !['X', 'Y', 'Z'].every((k) => Number.isFinite(row[k]))) return [];
  const duck = Number.isFinite(row.duck_amount) ? Math.max(0, Math.min(1, row.duck_amount)) : 0;
  const yaw = radians(Number.isFinite(row.yaw) ? row.yaw : 0), sx = Math.sin(yaw) * 13, sy = -Math.cos(yaw) * 13;
  return [[row.X, row.Y, row.Z + 64 - duck * 18], [row.X, row.Y, row.Z + 46 - duck * 14], [row.X, row.Y, row.Z + 29 - duck * 10],
    [row.X + sx, row.Y + sy, row.Z + 46 - duck * 14], [row.X - sx, row.Y - sy, row.Z + 46 - duck * 14],
    [row.X + sx * .5, row.Y + sy * .5, row.Z + 5], [row.X - sx * .5, row.Y - sy * .5, row.Z + 5]];
}
export function segmentSphere(start, end, center, radius) {
  const d = end.map((n, i) => n - start[i]), c = center.map((n, i) => n - start[i]);
  const size = dot3(d, d), t = size ? Math.max(0, Math.min(1, dot3(c, d) / size)) : 0;
  return Math.hypot(...c.map((n, i) => n - d[i] * t)) < radius;
}

// A direction guide, not a simulated bullet or a collision point. Clip against
// the final camera's near plane so incoming shots remain drawable.
export function projectShotDirection(camera, shot) {
  if (!camera || !shot.origin || !shot.direction || ![...shot.origin, ...shot.direction].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(...shot.direction);
  if (!magnitude) return null;
  const distance = shot.target?.every(Number.isFinite) ? Math.hypot(...shot.target.map((v, i) => v - shot.origin[i])) : 2048;
  let start = [...shot.origin];
  let end = start.map((v, i) => v + shot.direction[i] / magnitude * Math.max(64, Math.min(8192, distance)));
  const startDepth = dot3(start.map((v, i) => v - camera.origin[i]), camera.forward);
  const endDepth = dot3(end.map((v, i) => v - camera.origin[i]), camera.forward);
  const near = .51;
  if (startDepth < near && endDepth < near) return null;
  const clipped = endDepth < near;
  if (startDepth < near || clipped) {
    const t = (near - startDepth) / (endDepth - startDepth);
    const intersection = start.map((v, i) => v + (end[i] - v) * t);
    if (startDepth < near) start = intersection; else end = intersection;
  }
  const a = projectPoint(camera, start), b = projectPoint(camera, end);
  return a && b ? { start: a, end: b, clipped } : null;
}
