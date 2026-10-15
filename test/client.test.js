// -----------------------------------------------------------------------------
// The REST client: headers, login and token reuse, 429 backoff, errors by
// kind, and the endpoints read from real (anonymized) answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_ID, TractiveClient, defaultRetryDelay } from '../src/tractive/client.js';
import { ERROR_KINDS } from '../src/tractive/errors.js';
import { MemoryTokenStore } from '../src/tokenStore.js';
import { EMAIL, PASSWORD, createFakeTractive } from './helpers/fakeTractive.js';

function client(tractive, options = {}) {
  return new TractiveClient({
    email: EMAIL,
    password: PASSWORD,
    tokenStore: options.tokenStore ?? new MemoryTokenStore(),
    fetch: tractive.fetch,
    retryDelay: () => 0,
    ...options,
  });
}

test('logs in once, sends the client and user headers, reads the pets', async () => {
  const tractive = createFakeTractive();
  const api = client(tractive);
  const objects = await api.trackableObjects();
  assert.equal(objects.length, 4);
  const pet = await api.trackableObject('PETDOG01');
  assert.equal(pet.details.name, 'Rex');
  assert.equal((await api.tracker('TRDOG001')).model_number, 'TG4422');
  assert.equal((await api.hardwareReport('TRDOG001')).battery_level, 96);
  assert.deepEqual((await api.positionReport('TRDOG001')).latlong, [48.85695, 2.3522]);
  assert.equal((await api.healthOverview('PETDOG01')).activity.minutesActive, 150);
  assert.equal(tractive.count(/auth\/token$/), 1);
  const login = tractive.requests[0];
  assert.equal(login.headers['x-tractive-client'], CLIENT_ID);
  assert.deepEqual(JSON.parse(login.body), {
    platform_email: EMAIL,
    platform_token: PASSWORD,
    grant_type: 'tractive',
  });
  const last = tractive.requests.at(-1);
  assert.equal(last.headers['x-tractive-user'], '5f0c0ffee0000000000000a1');
  assert.match(last.headers.authorization, /^Bearer test_access_token_xyz-1$/);
});

test('concurrent calls share one login', async () => {
  const tractive = createFakeTractive();
  const api = client(tractive);
  await Promise.all([api.tracker('TRDOG001'), api.tracker('TRCAT002'), api.trackableObjects()]);
  assert.equal(tractive.count(/auth\/token$/), 1);
});

test('the saved token is reused until one hour before it expires', async () => {
  const tractive = createFakeTractive();
  const tokenStore = new MemoryTokenStore();
  let now = Date.UTC(2026, 9, 15);
  tractive.data.auth.expires_at = now / 1000 + 2 * 3600;
  await client(tractive, { tokenStore, now: () => now }).tracker('TRDOG001');
  await client(tractive, { tokenStore, now: () => now }).tracker('TRDOG001');
  assert.equal(tractive.count(/auth\/token$/), 1, 'second client reads the saved token');
  now += 1.5 * 3600_000;
  await client(tractive, { tokenStore, now: () => now }).tracker('TRDOG001');
  assert.equal(tractive.count(/auth\/token$/), 2, 'renewed less than an hour before expiry');
});

test('a token saved for another account is ignored', async () => {
  const tractive = createFakeTractive();
  const tokenStore = new MemoryTokenStore();
  await tokenStore.save('someone.else@example.com', {
    user_id: 'x',
    access_token: 'other',
    expires_at: 4102444800,
  });
  await client(tractive, { tokenStore }).tracker('TRDOG001');
  assert.equal(tractive.count(/auth\/token$/), 1);
});

test('a refused login is an "unauthorized" error flagged as a login problem', async () => {
  const tractive = createFakeTractive({ password: 'other' });
  await assert.rejects(client(tractive).trackableObjects(), (err) => {
    assert.equal(err.kind, ERROR_KINDS.UNAUTHORIZED);
    assert.equal(err.auth, true);
    assert.ok(!err.message.includes(PASSWORD));
    return true;
  });
});

test('429 is retried three times, then reported', async () => {
  const tractive = createFakeTractive();
  const waits = [];
  const api = client(tractive, {
    sleep: async (ms) => waits.push(ms),
    retryDelay: (n) => n * 1000,
  });
  tractive.override(/tracker\/TRDOG001$/, 429, 2);
  assert.equal((await api.tracker('TRDOG001'))._id, 'TRDOG001');
  assert.deepEqual(waits, [1000, 2000]);
  tractive.override(/tracker\/TRDOG001$/, 429, 4);
  await assert.rejects(api.tracker('TRDOG001'), (err) => err.kind === ERROR_KINDS.RATE_LIMITED);
});

test('the default backoff waits 8 s, then up to 60 s', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal(defaultRetryDelay(1), 8000);
    const third = defaultRetryDelay(3);
    assert.ok(third >= 8000 && third <= 56_000);
    assert.ok(defaultRetryDelay(10) <= 60_000);
  }
});

test('errors by kind: forbidden, not found, server, network', async () => {
  const tractive = createFakeTractive();
  const api = client(tractive);
  tractive.override(/command/, 403, 1);
  await assert.rejects(api.command('TRDOG001', 'led', true), { kind: ERROR_KINDS.FORBIDDEN });
  await assert.rejects(api.tracker('NOPE'), { kind: ERROR_KINDS.NOT_FOUND });
  tractive.override(/device_pos_report/, 502, 1);
  await assert.rejects(api.positionReport('TRDOG001'), { kind: ERROR_KINDS.SERVER });
  tractive.setOnline(false);
  await assert.rejects(api.tracker('TRDOG001'), { kind: ERROR_KINDS.NETWORK });
});

test('no health overview (400) or an inactive subscription (403) reads as empty', async () => {
  const tractive = createFakeTractive();
  const api = client(tractive);
  assert.deepEqual(await api.healthOverview('PETSHR03'), {});
  tractive.override(/health\/overview/, 403, 1);
  assert.deepEqual(await api.healthOverview('PETDOG01'), {});
});

test('commands use the Tractive command paths', async () => {
  const tractive = createFakeTractive();
  const api = client(tractive);
  assert.deepEqual(await api.command('TRDOG001', 'buzzer', true), { pending: true });
  await api.command('TRDOG001', 'live_tracking', false);
  assert.ok(tractive.count(/tracker\/TRDOG001\/command\/buzzer_control\/on$/) === 1);
  assert.ok(tractive.count(/tracker\/TRDOG001\/command\/live_tracking\/off$/) === 1);
  await assert.rejects(api.command('TRDOG001', 'unlock', true), /Unknown command/);
});
