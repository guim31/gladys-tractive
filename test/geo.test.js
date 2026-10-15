import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, leaveMargin, nextAtHome } from '../src/geo.js';

test('distance between two points', () => {
  assert.equal(distanceMeters(48.8566, 2.3522, 48.8566, 2.3522), 0);
  // One thousandth of a degree of latitude is about 111 m.
  assert.equal(Math.round(distanceMeters(48.8566, 2.3522, 48.8576, 2.3522)), 111);
  // Paris to Lyon, about 392 km.
  const parisLyon = distanceMeters(48.8566, 2.3522, 45.764, 4.8357);
  assert.ok(parisLyon > 390_000 && parisLyon < 394_000, `${parisLyon}`);
});

test('at home: first value as is, then a hysteresis and the imprecise fixes ignored', () => {
  assert.equal(nextAtHome(null, 50, 10, 100), true);
  assert.equal(nextAtHome(null, 150, 2000, 100), false, 'first value, even imprecise');
  assert.equal(leaveMargin(100), 25);
  assert.equal(leaveMargin(500), 100);
  assert.equal(nextAtHome(true, 120, 10, 100), true, 'inside the margin');
  assert.equal(nextAtHome(true, 126, 10, 100), false);
  assert.equal(nextAtHome(false, 101, 10, 100), false);
  assert.equal(nextAtHome(false, 100, 10, 100), true);
  assert.equal(nextAtHome(true, 5000, 800, 100), true, 'imprecise: unchanged');
  assert.equal(nextAtHome(false, 10, 800, 100), false, 'imprecise: unchanged');
  assert.equal(nextAtHome(true, 5000, null, 100), false, 'accuracy unknown: trusted');
});
