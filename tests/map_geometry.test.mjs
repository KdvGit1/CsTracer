import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionMesh, decodeMesh, loadMapGeometry } from '../companion/map_geometry.mjs';
import { createDuelGeometry } from '../companion/duel_geometry.mjs';
import { cameraFor, projectPoint, projectShotDirection, segmentSphere } from '../shared/duel_view.mjs';

function wall() {
  return new CollisionMesh({ vertices: new Float32Array([50, -200, -200, 50, 200, -200, 50, 200, 200, 50, -200, 200]), triangles: new Uint32Array([0, 1, 2, 0, 2, 3]) });
}
test('BVH finds nearest wall from either side, ignores walls beyond endpoint and handles parallel rays', () => {
  const mesh = wall();
  assert.equal(mesh.trace([0, 0, 0], [100, 0, 0]), 50);
  assert.equal(mesh.trace([100, 0, 0], [0, 0, 0]), 50);
  assert.equal(mesh.trace([0, 0, 0], [25, 0, 0]), null);
  assert.equal(mesh.trace([0, 0, 0], [0, 100, 0]), null);
  assert.equal(mesh.trace([0, 300, 0], [100, 300, 0]), null);
});
test('AWMH validates header, length, floats and indices', () => {
  const b = Buffer.alloc(16 + 3 * 12 + 12);
  b.write('AWMH'); b.writeUInt32LE(1, 4); b.writeUInt32LE(3, 8); b.writeUInt32LE(1, 12);
  [0, 1, 2].forEach((n, i) => b.writeUInt32LE(n, 52 + i * 4));
  assert.equal(decodeMesh(b).triangles.length, 3);
  assert.throws(() => decodeMesh(b.subarray(0, b.length - 1)));
  b.writeUInt32LE(8, 52); assert.throws(() => decodeMesh(b), /index/);
});
test('POV projection is centered, right-handed in CS coordinates and clips behind camera', () => {
  const camera = cameraFor({ X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0 });
  assert.equal(projectPoint(camera, [100, 0, 64]).x, .5);
  assert.equal(projectPoint(camera, [100, 0, 64]).y, .5);
  assert.ok(projectPoint(camera, [100, -50, 64]).x > .5);
  assert.equal(projectPoint(camera, [-100, 0, 64]), null);
  assert.equal(cameraFor({ X: 0 }), null);
});
test('smoke volume blocks intersecting rays but not off-path smoke', () => {
  assert.equal(segmentSphere([0, 0, 0], [100, 0, 0], [50, 0, 0], 10), true);
  assert.equal(segmentSphere([0, 0, 0], [100, 0, 0], [50, 50, 0], 10), false);
});

test('shot guides preserve outgoing and incoming directions without inventing impact points', () => {
  const camera = cameraFor({ X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0 });
  const shot = { origin: camera.origin, direction: [1, 0, 0], target: [100, 0, 64], impacts: [] };
  const outgoing = projectShotDirection(camera, shot);
  assert.equal(outgoing.end.x, .5);
  assert.equal(outgoing.clipped, false);
  const incoming = projectShotDirection(camera, { origin: [100, 0, 64], direction: [-1, 0, 0], target: camera.origin });
  assert.equal(incoming.clipped, true);
  assert.ok(incoming.end.depth > .5);
  assert.equal(projectShotDirection(camera, { ...shot, direction: [-1, 0, 0] }), null);
  assert.equal(projectShotDirection(camera, { ...shot, origin: null }), null);
  assert.deepEqual(shot.impacts, []);
});
test('visibility separates wall, smoke, FOV and missing poses; snapshot ends on living camera', () => {
  const a = { X: 0, Y: 0, Z: 0, yaw: 0, pitch: 0, health: 100 };
  const b = { X: 100, Y: 0, Z: 0, yaw: 180, pitch: 0, health: 100 };
  const ticks = { byPlayerTick: new Map([['1_9', a], ['2_9', b], ['1_10', { ...a, health: 0 }], ['2_10', b], ['1_11', { ...a, yaw: 180 }], ['2_11', b]]) };
  const g = createDuelGeometry(ticks, {}, {}, 64, { mesh: wall(), status: 'matched', map: 'test', release: 'test' });
  assert.equal(g.check('1', '2', 9).reason, 'wall');
  assert.equal(g.check('1', '2', 11).reason, 'outside-fov');
  assert.equal(g.check('1', '2', 99).visible, null);
  const scene = g.scene('1', '2', 10, 9);
  assert.equal(scene.cameraTick, 9);
  assert.equal(Buffer.from(scene.depth, 'base64').length, scene.width * scene.height * 2);
  const emptyMesh = { trace: () => null, triangles: [] };
  const smoke = createDuelGeometry(ticks, { smokegrenade_detonate: [{ tick: 1, x: 50, y: 0, z: 0, entityid: 7 }], smokegrenade_expired: [{ tick: 10, entityid: 7 }] }, {}, 64, { mesh: emptyMesh });
  assert.equal(smoke.check('1', '2', 9).reason, 'smoke');
  assert.equal(smoke.check('1', '2', 10).reason, 'visible');
});
test('bundled Inferno geometry matches published clear and occluded reference sightlines', () => {
  const geometry = loadMapGeometry('de_inferno');
  assert.ok(geometry.mesh, geometry.reason || geometry.status);
  assert.equal(geometry.mesh.trace([1258.04, 455.47, 181.22], [-158.62, 819.09, 103.73]), null);
  assert.notEqual(geometry.mesh.trace([1398.43, 705.44, 192.33], [-158.62, 819.09, 103.73]), null);
  assert.equal(loadMapGeometry('de_inferno', { client_version: '1' }).status, 'version-mismatch');
  assert.equal(loadMapGeometry('../data/steam_session').mesh, null);
});
