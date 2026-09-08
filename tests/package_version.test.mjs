import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackageVersion, suggestVersion } from '../launcher/package-version.mjs';
test('version prompt suggests a new version and rejects existing ZIP/RAR including legacy timestamp names', () => {
  const files = ['TRACER-Patch-v0.51.1.zip', 'TRACER-Patch-v0.51.2-20260907-215141.rar'];
  assert.equal(suggestVersion('0.51.1', files), '0.51.3');
  assert.throws(() => validatePackageVersion('0.51.1', '0.51.1', files));
  assert.throws(() => validatePackageVersion('0.51.2', '0.51.1', files));
  assert.equal(validatePackageVersion('0.52.0', '0.51.1', files), '0.52.0');
  assert.equal(suggestVersion('0.51.1', ['TRACER-Portable-v0.52.0.rar']), '0.52.1');
  assert.throws(() => validatePackageVersion('0.52.0', '0.51.1', ['TRACER-Portable-v0.52.0.rar']));
});
test('version checks reject traversal, semver typos and downgrades but allow an unbuilt retry', () => {
  for (const target of ['../0.52.0', '0.52', '01.2.3', '0.52.0&cmd', '0.50.0']) assert.throws(() => validatePackageVersion(target, '0.51.1', []));
  assert.equal(validatePackageVersion('0.52.0', '0.52.0', []), '0.52.0');
});
