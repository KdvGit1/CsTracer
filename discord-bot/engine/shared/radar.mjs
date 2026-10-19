export function worldToRadar(x, y, map) {
  const fullScale = map.scale * 1024;
  return { left: ((x - map.posX) / fullScale) * 100, top: ((map.posY - y) / fullScale) * 100 };
}

// Never connect across another floor, invalid samples or a teleport/data gap.
export function radarPathSegments(points, map, level = "upper", tickRate = 64) {
  const segments = []; let segment = []; let previous = null;
  const flush = () => { if (segment.length >= 2) segments.push(segment); segment = []; previous = null; };
  for (const point of points || []) {
    const projected = worldToRadar(point.x, point.y, map);
    const correctFloor = !map.lowerImage || map.lowerMaxZ === undefined || (level === "lower" ? point.z < map.lowerMaxZ : point.z >= map.lowerMaxZ);
    if (![point.x, point.y, point.z, point.tick, projected.left, projected.top].every(Number.isFinite) || !correctFloor || projected.left < 0 || projected.left > 100 || projected.top < 0 || projected.top > 100) { flush(); continue; }
    if (previous && (point.tick <= previous.tick || point.tick - previous.tick > tickRate * 2.5 || Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z) > 650)) flush();
    segment.push(projected); previous = point;
  }
  flush(); return segments;
}
