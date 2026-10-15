import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hasCredentials, normalizeConfig } from '../src/config.js';

test('defaults for an empty config', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.equal(hasCredentials(normalizeConfig()), false);
});

test('values from the form are cleaned and bounded', () => {
  const config = normalizeConfig({
    email: '  pet.owner@example.com ',
    password: ' secret with spaces ',
    house: 'home',
    home_radius: '150,6',
    battery_low_threshold: 2,
    refresh_minutes: 600,
    language: 'de',
  });
  assert.equal(config.email, 'pet.owner@example.com');
  assert.equal(config.password, ' secret with spaces ', 'a password is kept as typed');
  assert.equal(config.home_radius, 151);
  assert.equal(config.battery_low_threshold, 5);
  assert.equal(config.refresh_minutes, 60);
  assert.equal(config.language, 'de');
  assert.equal(hasCredentials(config), true);
});

test('invalid values fall back to the defaults', () => {
  const config = normalizeConfig({
    home_radius: 'far',
    refresh_minutes: null,
    language: 'it',
    email: 42,
  });
  assert.equal(config.home_radius, 100);
  assert.equal(config.refresh_minutes, 15);
  assert.equal(config.language, 'fr');
  assert.equal(config.email, '');
});
