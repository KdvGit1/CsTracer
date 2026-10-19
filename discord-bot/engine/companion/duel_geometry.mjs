import { cameraFor, projectPoint, bodyPoints, segmentSphere } from '../shared/duel_view.mjs';
import { loadMapGeometry } from './map_geometry.mjs';

export function createDuelGeometry(ticks, grouped, header, tickRate, providedGeometry) {
  const geometry = providedGeometry || loadMapGeometry(header.map_name, header);
  const mesh = geometry.mesh;
  const hz = Number.isFinite(tickRate) && tickRate > 0 ? tickRate : null;
  const at = (id, tick) => ticks.byPlayerTick.get(`${id}_${tick}`);
  const smokes = hz ? (grouped.smokegrenade_detonate || []).filter((s) => [s.x, s.y, s.z, s.tick].every(Number.isFinite)).map((s) => {
    const expired = (grouped.smokegrenade_expired || []).find((e) => e.tick > s.tick && s.entityid != null && e.entityid === s.entityid);
    return { start: s.tick, end: expired?.tick ?? s.tick + hz * 18, center: [s.x, s.y, s.z + 55], radius: 144 };
  }) : [];
  const cache = new Map();
  function check(observer, target, tick) {
    const key = `${observer}:${target}:${tick}`;
    if (cache.has(key)) return cache.get(key);
    const a = at(observer, tick), b = at(target, tick), camera = cameraFor(a), points = bodyPoints(b);
    let result = { visible: null, reason: 'unknown', visiblePoints: 0, totalPoints: points.length };
    if (mesh && camera && points.length) {
      let inFrame = 0, clear = 0, visiblePoints = 0;
      const active = smokes.filter((s) => tick >= s.start && tick < s.end);
      for (const point of points) {
        if (!projectPoint(camera, point)?.inFrame) continue;
        inFrame++;
        if (mesh.trace(camera.origin, point) !== null) continue;
        clear++;
        if (!active.some((s) => segmentSphere(camera.origin, point, s.center, s.radius))) visiblePoints++;
      }
      result = { visible: visiblePoints > 0, reason: visiblePoints ? 'visible' : !inFrame ? 'outside-fov' : !clear ? 'wall' : 'smoke', visiblePoints, totalPoints: points.length };
    }
    if (cache.size >= 100_000) cache.clear();
    cache.set(key, result);
    return result;
  }
  function scene(observer, target, endTick, startTick) {
    // The death tick may contain the post-death camera. Use the last living pose,
    // at most one tick earlier; never borrow a position from another life.
    let cameraTick = endTick;
    if (at(observer, endTick)?.health <= 0 && at(observer, endTick - 1)?.health > 0) cameraTick--;
    const a = at(observer, cameraTick), b = at(target, cameraTick), camera = cameraFor(a);
    if (!camera) return null;
    const width = 64, height = 36, maxDistance = 8192;
    let depth = null;
    if (mesh) {
      const encoded = Buffer.alloc(width * height * 2);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const horizontal = ((x + .5) / width * 2 - 1) * camera.tanH;
        const vertical = (1 - (y + .5) / height * 2) * camera.tanV;
        const ray = camera.forward.map((n, i) => n + camera.right[i] * horizontal + camera.up[i] * vertical);
        const size = Math.hypot(...ray), endpoint = camera.origin.map((n, i) => n + ray[i] / size * maxDistance);
        const hit = mesh.trace(camera.origin, endpoint);
        encoded.writeUInt16LE(hit === null ? 0 : Math.max(1, Math.round(hit)), (y * width + x) * 2);
      }
      depth = encoded.toString('base64');
    }
    const targetPoints = bodyPoints(b);
    const activeSmoke = smokes.filter((s) => cameraTick >= s.start && cameraTick < s.end);
    const pointVisibility = targetPoints.map((p) => mesh ? Boolean(projectPoint(camera, p)?.inFrame && mesh.trace(camera.origin, p) === null && !activeSmoke.some((s) => segmentSphere(camera.origin, p, s.center, s.radius))) : null);
    return { camera, cameraTick, eventTick: endTick, startTick, width, height, maxDistance, depth,
      targetPoints, pointVisibility, visibility: check(observer, target, cameraTick),
      smokes: smokes.filter((s) => cameraTick >= s.start && cameraTick < s.end).map(({ center, radius }) => ({ center, radius })),
      geometryRelease: geometry.release || null, geometryStatus: geometry.status,
      method: 'static-collision-pov-v1' };
  }
  return { check, scene, available: Boolean(mesh), metadata: { status: geometry.status, release: geometry.release || null, map: geometry.map, triangleCount: mesh ? mesh.triangles.length / 3 : 0 } };
}
