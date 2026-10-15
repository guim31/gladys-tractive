// -----------------------------------------------------------------------------
// The integration end to end, on the SDK's fake Gladys and the simulated
// Tractive cloud: login and token, refresh on its own timer, presence and
// scene triggers, commands, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL, PASSWORD, PETS, createFakeTractive } from './helpers/fakeTractive.js';
import {
  CONFIG,
  HOUSES,
  addToGladys,
  captureLogs,
  createWorld,
  discovered,
  petDevice,
  settle,
} from './helpers/world.js';
import { MemoryTokenStore } from '../src/tokenStore.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

const DOG = 'ext:test-integration:pet:PETDOG01';
const CAT = 'ext:test-integration:pet:PETCAT02';

const featureOf = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

test('logs in, lists the pets with a tracker and reports the connection', async () => {
  const world = await createWorld();
  const { gladys, tractive } = world;
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['Rex', DOG],
      ['Mia', CAT],
    ],
  );
  assert.equal(tractive.count(/auth\/token$/), 1);
  // Nothing added to Gladys yet: no state read nor sent.
  assert.equal(tractive.count(/device_pos_report/), 0);
  assert.equal(gladys.fake.states.length, 0);
  await world.app.stop();
});

test('a pet added to Gladys gets its states at once', async () => {
  const world = await createWorld();
  const { gladys } = world;
  await addToGladys(world, 'Rex');
  const last = (key) => gladys.fake.lastState(`${DOG}:${key}`);
  assert.equal(last('battery'), 96);
  assert.equal(last('charging'), 0);
  assert.equal(last('distance'), 39, 'about 39 m from the house');
  assert.equal(last('accuracy'), 30);
  assert.equal(last('at_home'), 1);
  assert.equal(last('online'), 1);
  assert.equal(last('power_saving'), 0);
  assert.equal(last('activity'), 150);
  assert.equal(last('activity_goal'), 200);
  assert.equal(last('rest'), 122);
  // Not known before the channel tells: nothing invented.
  assert.equal(last('buzzer'), undefined);
  assert.ok(gladys.fake.widgetRefreshes.includes('pet'), 'the widget is nudged');
  await world.app.stop();
});

test('the token is kept and reused: a restart does not log in again', async () => {
  const tractive = createFakeTractive();
  const tokenStore = new MemoryTokenStore();
  const first = await createWorld({ tractive, tokenStore, created: ['dog'] });
  await first.app.stop();
  const second = await createWorld({ tractive, tokenStore, created: ['dog'] });
  assert.equal(tractive.count(/auth\/token$/), 1, 'one login for both runs');
  assert.deepEqual(second.gladys.fake.connectionStatus, { connected: true });
  await second.app.stop();
});

test('a revoked token gets one new login, then the requests go on', async () => {
  const tractive = createFakeTractive();
  const world = await createWorld({ tractive, created: ['dog'] });
  tractive.revokeTokens();
  await world.hub.refresh({ force: true });
  assert.equal(tractive.count(/auth\/token$/), 2);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  await world.app.stop();
});

test('without credentials: asks for them, sends nothing to Tractive', async () => {
  const world = await createWorld({ config: {} });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /adresse e-mail et le mot de passe/);
  assert.equal(world.tractive.requests.length, 0);
  await world.app.stop();
});

test('a refused password is reported and never retried until the config changes', async (t) => {
  const lines = captureLogs(t, 'info');
  const tractive = createFakeTractive({ password: 'another' });
  const world = await createWorld({ tractive, timers: true });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /refused the e-mail address/);
  assert.equal(tractive.count(/auth\/token$/), 1);
  assert.equal(world.hub.timer, null, 'no retry timer');
  await world.hub.refresh({ force: true });
  assert.equal(tractive.count(/auth\/token$/), 1, 'still one login');
  assert.equal(lines.filter((line) => line.includes('[ERROR]')).length, 1);

  // The user fixes the password: a new login.
  tractive.data.auth.access_token = 'fresh';
  await world.gladys.fake.configUpdated({ ...CONFIG, password: 'another' });
  await settle();
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  await world.app.stop();
});

test('Tractive unreachable at start: one error line, retries, one line when back', async (t) => {
  const lines = captureLogs(t, 'info');
  const tractive = createFakeTractive();
  tractive.setOnline(false);
  const world = await createWorld({ tractive, created: ['dog'] });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  await world.hub.refresh({ force: true });
  await world.hub.refresh({ force: true });
  const errors = lines.filter((line) => line.includes('[ERROR]') || line.includes('[WARN]'));
  assert.equal(errors.length, 1, `one line for three failures, got ${errors.join('\n')}`);

  tractive.setOnline(true);
  await world.hub.refresh({ force: true });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  assert.equal(world.gladys.fake.lastState(`${DOG}:battery`), 96);
  assert.ok(lines.some((line) => line.includes('Tractive answers again')));
  await world.app.stop();
});

test('the states refresh on the container timer, without any onPoll (Gladys#3198)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_716_107_000_000 });
  const world = await createWorld({ created: ['dog'], timers: true });
  const { gladys, tractive } = world;
  t.after(() => world.app.stop());
  assert.equal(tractive.count(/device_pos_report/), 1);
  assert.equal(gladys.fake.lastState(`${DOG}:battery`), 96);
  assert.equal(gladys.fake.requests.filter((r) => r.path === '/poll').length, 0);

  tractive.data.hardware.TRDOG001 = {
    ...tractive.data.hardware.TRDOG001,
    time: 1716108000,
    battery_level: 80,
  };
  t.mock.timers.tick(15 * 60_000);
  await settle();
  assert.equal(tractive.count(/device_pos_report/), 2, 'refreshed after one period');
  assert.equal(gladys.fake.lastState(`${DOG}:battery`), 80, 'without onPoll');

  t.mock.timers.tick(15 * 60_000);
  await settle();
  assert.equal(tractive.count(/device_pos_report/), 3);
});

test('the period follows the configuration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_716_107_000_000 });
  const world = await createWorld({
    created: ['dog'],
    timers: true,
    config: { ...CONFIG, refresh_minutes: 5 },
  });
  t.after(() => world.app.stop());
  t.mock.timers.tick(5 * 60_000);
  await settle();
  assert.equal(world.tractive.count(/device_pos_report/), 2);
});

test('onPoll is a fallback: skipped while the timer refreshes, used when it stalls', async (t) => {
  let now = 1_716_107_000_000;
  const world = await createWorld({ created: ['dog'], now: () => now });
  t.after(() => world.app.stop());
  const device = world.gladys.fake.devices[0];
  assert.deepEqual(await world.gladys.fake.poll(device), { success: true });
  assert.equal(world.tractive.count(/device_pos_report/), 1, 'refreshed just now: skipped');
  now += 14 * 60_000;
  await world.gladys.fake.poll(device);
  assert.equal(world.tractive.count(/device_pos_report/), 2, '90 % of a period without refresh');
});

test('an unchanged value is not sent again, but a heartbeat resends it after 6 h', async (t) => {
  let now = 1_716_107_000_000;
  const world = await createWorld({ created: ['dog'], now: () => now });
  t.after(() => world.app.stop());
  const count = () =>
    world.gladys.fake.states.filter((s) => s.device_feature_external_id === `${DOG}:battery`)
      .length;
  assert.equal(count(), 1);
  await world.hub.refresh({ force: true });
  assert.equal(count(), 1, 'same battery: not sent');
  // The SDK's heartbeat reads the real clock.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 6 * 3600_000 + 1000 });
  now += 6 * 3600_000 + 1000;
  await world.hub.refresh({ force: true });
  assert.equal(count(), 2, 'resent after the heartbeat');
});

test('Gladys restarting: everything is sent again', async () => {
  const world = await createWorld({ created: ['dog'] });
  const before = world.gladys.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  await settle();
  assert.ok(world.gladys.fake.states.length >= before * 2, 'the states were resent');
  await world.app.stop();
});

test('a scan reads the pet list again', async () => {
  const world = await createWorld();
  delete world.tractive.data.objects.PETCAT02;
  world.tractive.data.trackableObjects = world.tractive.data.trackableObjects.filter(
    (object) => object._id !== 'PETCAT02',
  );
  await world.gladys.fake.scanRequest();
  await settle();
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((device) => device.name),
    ['Rex'],
  );
  await world.app.stop();
});

// --- Presence and scene triggers -----------------------------------------------

/** A channel event moving the dog `metersNorth` from the house. */
function move(world, metersNorth, { accuracy = 10, time } = {}) {
  world.positionTime = time ?? (world.positionTime ?? 1716107000) + 60;
  world.tractive.channel.push({
    message: 'tracker_status',
    tracker_id: PETS.dog.trackerId,
    position: {
      time: world.positionTime,
      latlong: [HOUSES[0].latitude + metersNorth / 111_195, HOUSES[0].longitude],
      accuracy,
      sensor_used: 'GPS',
    },
  });
}

async function channelWorld(options = {}) {
  const world = await createWorld({ created: ['dog'], channel: true, ...options });
  world.tractive.channel.push({ message: 'handshake' });
  await settle();
  return world;
}

test('leaving and coming home fire one trigger each, with the pet and the distance', async () => {
  const world = await channelWorld();
  const { gladys } = world;
  assert.equal(gladys.fake.sceneEvents.length, 0, 'no trigger for the first known position');

  move(world, 300);
  await settle();
  assert.deepEqual(gladys.fake.sceneEvents, [
    { key: 'pet_left_home', data: { device: DOG, pet_name: 'Rex', distance: 300 } },
  ]);
  assert.equal(gladys.fake.lastState(`${DOG}:at_home`), 0);

  move(world, 500);
  await settle();
  assert.equal(gladys.fake.sceneEvents.length, 1, 'still away: no new trigger');

  move(world, 20);
  await settle();
  assert.deepEqual(gladys.fake.sceneEvents.at(-1), {
    key: 'pet_came_home',
    data: { device: DOG, pet_name: 'Rex', distance: 20 },
  });
  assert.equal(gladys.fake.lastState(`${DOG}:at_home`), 1);
  await world.app.stop();
});

test('GPS jitter around the radius does not flap: leaving needs the margin', async () => {
  const world = await channelWorld();
  for (const meters of [105, 110, 118, 90, 119]) {
    move(world, meters);
    await settle();
  }
  assert.equal(world.gladys.fake.sceneEvents.length, 0, 'within 100 m + 20 %');
  assert.equal(world.gladys.fake.lastState(`${DOG}:at_home`), 1);
  move(world, 130);
  await settle();
  assert.equal(world.gladys.fake.sceneEvents.at(-1).key, 'pet_left_home');
  await world.app.stop();
});

test('an imprecise position (cell tower) never moves the pet in or out', async () => {
  const world = await channelWorld();
  move(world, 2000, { accuracy: 1500 });
  await settle();
  assert.equal(world.gladys.fake.sceneEvents.length, 0);
  assert.equal(world.gladys.fake.lastState(`${DOG}:at_home`), 1);
  assert.equal(world.gladys.fake.lastState(`${DOG}:distance`), 2000, 'the distance is still shown');
  await world.app.stop();
});

test('an old position arriving late is ignored', async () => {
  const world = await channelWorld();
  move(world, 300, { time: 1716200000 });
  await settle();
  move(world, 10, { time: 1716100000 });
  await settle();
  assert.equal(world.gladys.fake.lastState(`${DOG}:at_home`), 0);
  await world.app.stop();
});

test('the radius and the house come from the configuration', async () => {
  const far = await createWorld({ created: ['dog'], config: { ...CONFIG, house: 'cottage' } });
  assert.equal(far.gladys.fake.lastState(`${DOG}:at_home`), 0, 'far from the cottage');
  assert.ok(far.gladys.fake.lastState(`${DOG}:distance`) > 390_000);
  await far.app.stop();

  const tight = await createWorld({ created: ['dog'], config: { ...CONFIG, home_radius: 20 } });
  assert.equal(tight.gladys.fake.lastState(`${DOG}:at_home`), 0, '39 m is outside 20 m');
  // Changing the radius takes effect without a trigger.
  await tight.gladys.fake.configUpdated({ ...CONFIG, home_radius: 100 });
  await settle();
  assert.equal(tight.gladys.fake.lastState(`${DOG}:at_home`), 1);
  assert.equal(tight.gladys.fake.sceneEvents.length, 0);
  await tight.app.stop();
});

test('without a located house: no distance, no "at home", the rest works', async () => {
  const world = await createWorld({
    created: ['dog'],
    houses: [{ id: 'h1', name: 'Home', selector: 'home', latitude: null, longitude: null }],
  });
  assert.equal(world.gladys.fake.lastState(`${DOG}:distance`), undefined);
  assert.equal(world.gladys.fake.lastState(`${DOG}:at_home`), undefined);
  assert.equal(world.gladys.fake.lastState(`${DOG}:battery`), 96);
  const report = await world.gladys.fake.action('test_connection', {});
  assert.match(report.data.message.en, /No Gladys house has a location/);
  await world.app.stop();
});

test('battery low fires once per crossing, not while charging, re-armed 5 points above', async () => {
  const world = await channelWorld();
  let time = 1716107000;
  const battery = (level, charging = 'NOT_CHARGING') => {
    time += 60;
    world.tractive.channel.push({
      message: 'tracker_status',
      tracker_id: PETS.dog.trackerId,
      tracker_state: 'OPERATIONAL',
      charging_state: charging,
      hardware: { time, battery_level: level },
    });
  };
  const lows = () => world.gladys.fake.sceneEvents.filter((event) => event.key === 'battery_low');

  battery(15);
  await settle();
  battery(14);
  await settle();
  assert.deepEqual(lows(), [
    { key: 'battery_low', data: { device: DOG, pet_name: 'Rex', battery: 14 } },
  ]);
  battery(10);
  await settle();
  battery(17);
  await settle();
  battery(12);
  await settle();
  assert.equal(lows().length, 1, 'not re-armed below 15 + 5');
  battery(20, 'CHARGING');
  await settle();
  battery(13, 'CHARGING');
  await settle();
  assert.equal(lows().length, 1, 'charging: no alert');
  battery(12);
  await settle();
  assert.equal(lows().length, 2, 'unplugged below the threshold after a re-arm');
  await world.app.stop();
});

test('no trigger for a pet not added to Gladys', async () => {
  const world = await createWorld({ channel: true });
  world.tractive.channel.push({ message: 'handshake' });
  move(world, 10);
  await settle();
  move(world, 400);
  await settle();
  assert.equal(world.gladys.fake.sceneEvents.length, 0);
  assert.equal(world.gladys.fake.states.length, 0);
  await world.app.stop();
});

// --- Commands --------------------------------------------------------------------

test('a switch sends the command to the tracker and shows the new state', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ created: ['dog'] });
  const device = world.gladys.fake.devices[0];
  const ack = await world.gladys.fake.setValue(device, featureOf(device, 'buzzer'), 1);
  assert.deepEqual(ack, { success: true });
  assert.equal(world.tractive.count(/TRDOG001\/command\/buzzer_control\/on$/), 1);
  assert.equal(world.gladys.fake.lastState(`${DOG}:buzzer`), 1);
  await world.gladys.fake.setValue(device, featureOf(device, 'live_tracking'), 1);
  assert.equal(world.tractive.count(/command\/live_tracking\/on$/), 1);
  await world.gladys.fake.setValue(device, featureOf(device, 'led'), 0);
  assert.equal(world.tractive.count(/command\/led_control\/off$/), 1);
  assert.equal(lines.filter((line) => line.includes('[INFO]') && /for Rex/.test(line)).length, 3);
  await world.app.stop();
});

test('in the power saving zone, a command is refused with a clear message', async () => {
  const world = await createWorld({ created: ['cat'] });
  const device = world.gladys.fake.devices[0];
  const ack = await world.gladys.fake.setValue(device, featureOf(device, 'buzzer'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /économie d'énergie/);
  assert.equal(world.tractive.count(/command/), 0);
  await world.app.stop();
});

test('a command the subscription does not allow says so', async () => {
  const world = await createWorld({ created: ['dog'], config: { ...CONFIG, language: 'en' } });
  world.tractive.override(/command\/buzzer_control/, 403);
  const device = world.gladys.fake.devices[0];
  const ack = await world.gladys.fake.setValue(device, featureOf(device, 'buzzer'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /subscription or this tracker does not allow/);
  assert.equal(world.gladys.fake.lastState(`${DOG}:buzzer`), undefined);
  await world.app.stop();
});

test('the channel confirms the switches, a timed-out buzzer reads off', async () => {
  const world = await channelWorld();
  world.tractive.channel.push({
    message: 'tracker_status',
    tracker_id: PETS.dog.trackerId,
    buzzer_control: { active: true, remaining: 30 },
    led_control: { active: true, remaining: 0 },
    live_tracking: { active: true, remaining: 0 },
  });
  await settle();
  assert.equal(world.gladys.fake.lastState(`${DOG}:buzzer`), 1);
  assert.equal(world.gladys.fake.lastState(`${DOG}:led`), 0, 'no time left: off');
  assert.equal(world.gladys.fake.lastState(`${DOG}:live_tracking`), 1);
  await world.app.stop();
});

test('the activity pushed by the channel is published', async () => {
  const world = await channelWorld();
  world.tractive.channel.push({
    message: 'health_overview',
    content: {
      petId: PETS.dog.petId,
      activity: { minutesGoal: 200, minutesActive: 175 },
      sleep: { minutesCalm: 130 },
    },
  });
  await settle();
  assert.equal(world.gladys.fake.lastState(`${DOG}:activity`), 175);
  assert.equal(world.gladys.fake.lastState(`${DOG}:rest`), 130);
  await world.app.stop();
});

// --- Logs ----------------------------------------------------------------------------

test('a normal cycle writes nothing at info, and no secret ever reaches the logs', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await channelWorld();
  const startup = lines.filter((line) => line.includes('[INFO]')).length;

  const before = lines.length;
  await world.hub.refresh({ force: true });
  move(world, 300);
  await settle();
  world.tractive.channel.push({ message: 'keep-alive' });
  await settle();
  const cycle = lines.slice(before);
  assert.deepEqual(
    cycle.filter((line) => line.includes('[INFO]')),
    [],
    'a refresh, a position and a trigger: debug only',
  );
  assert.ok(
    cycle.some((line) => line.includes('[DEBUG]')),
    'debug shows them',
  );
  assert.ok(startup <= 2, 'startup: a couple of lifecycle lines');

  // Failures and a command, then look for any secret.
  world.tractive.override(/device_pos_report/, 500, 1);
  await world.hub.refresh({ force: true });
  await world.hub.refresh({ force: true });
  const device = world.gladys.fake.devices[0];
  await world.gladys.fake.setValue(device, featureOf(device, 'led'), 1);
  const all = lines.join('\n');
  for (const secret of [PASSWORD, EMAIL, 'test_access_token_xyz', 'Bearer']) {
    assert.ok(!all.includes(secret), `"${secret}" appears in the logs`);
  }
  assert.ok(!/48\.85\d+/.test(all), 'no coordinates in the logs');
  await world.app.stop();
});

test('the test action reports the pets, or the problem', async () => {
  const world = await createWorld();
  const ok = await world.gladys.fake.action('test_connection', {});
  assert.equal(ok.success, true);
  assert.match(ok.data.message.fr, /2 animal\(aux\) avec un traceur \(Rex, Mia\)/);
  await world.app.stop();

  const refused = await createWorld({ tractive: createFakeTractive({ password: 'x' }) });
  const report = await refused.gladys.fake.action('test_connection', {});
  assert.match(report.data.message.de, /lehnt die E-Mail-Adresse oder das Passwort ab/);
  await refused.app.stop();
});

test('the feature names follow the configured language', async () => {
  const world = await createWorld({ config: { ...CONFIG, language: 'de' } });
  const names = discovered(world, 'Rex').features.map((feature) => feature.name);
  assert.ok(names.includes('Zu Hause') && names.includes('Summer'));
  await world.app.stop();
});

test('the fixture devices of the helpers match what the integration discovers', async () => {
  const world = await createWorld();
  const probe = createFakeGladys();
  for (const [key, name] of [
    ['dog', 'Rex'],
    ['cat', 'Mia'],
  ]) {
    assert.deepEqual(
      petDevice(probe, key).features.map((f) => f.external_id),
      discovered(world, name).features.map((f) => f.external_id),
    );
  }
  await world.app.stop();
});

test('a channel refused for good waits for the next cycle, never loops', async () => {
  const tractive = createFakeTractive();
  tractive.setChannelStatus(403);
  const world = await createWorld({ tractive, created: ['dog'], channel: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle();
  const attempts = tractive.count(/channel\.tractive\.com/);
  assert.equal(attempts, 2, 'one try, one try after a new login');
  assert.equal(world.hub.channel, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(tractive.count(/channel\.tractive\.com/), attempts, 'no loop');

  // The next cycle reopens it.
  tractive.setChannelStatus(200);
  await world.hub.refresh({ force: true });
  await settle();
  assert.ok(world.tractive.channel, 'reopened');
  await world.app.stop();
});

test('a /data that cannot be written: one warning, the integration works', async (t) => {
  const lines = captureLogs(t, 'info');
  const tokenStore = new MemoryTokenStore();
  tokenStore.save = async () => {
    throw Object.assign(new Error('read-only file system'), { code: 'EROFS' });
  };
  const world = await createWorld({ tokenStore, created: ['dog'] });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });
  assert.equal(world.gladys.fake.lastState(`${DOG}:battery`), 96);
  assert.equal(lines.filter((line) => line.includes('EROFS')).length, 1);
  await world.app.stop();
});
