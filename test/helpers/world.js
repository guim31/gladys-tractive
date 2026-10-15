// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory Gladys), the simulated Tractive cloud, and the integration wired
// on top through registerHandlers — the same wiring as index.js.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { MemoryTokenStore } from '../../src/tokenStore.js';
import { EMAIL, HOME, PASSWORD, createFakeTractive } from './fakeTractive.js';

// The integration logs its lifecycle; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const HOUSES = [
  { id: 'h1', name: 'Home', selector: 'home', latitude: HOME.latitude, longitude: HOME.longitude },
  { id: 'h2', name: 'Cottage', selector: 'cottage', latitude: 45.764, longitude: 4.8357 },
];

export const CONFIG = { email: EMAIL, password: PASSWORD };

/** Let promise chains started by an event (a channel line, a timer) run to their end. */
export async function settle(rounds = 30) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.houses]
 * @param {string[]} [options.created] pets ('dog', 'cat') already added to Gladys
 * @param {object} [options.tractive] a fake Tractive (default: a new one)
 * @param {object} [options.tokenStore]
 * @param {boolean} [options.channel] open the real-time channel
 * @param {boolean} [options.timers] run the refresh timer
 * @param {boolean} [options.connect]
 * @param {object} [options.timings]
 * @param {() => number} [options.now]
 */
export async function createWorld({
  config = CONFIG,
  houses = HOUSES,
  created = [],
  tractive = createFakeTractive(),
  tokenStore = new MemoryTokenStore(),
  channel = false,
  timers = false,
  connect = true,
  timings = {},
  channelTimings = {},
  now,
} = {}) {
  const probe = createFakeGladys();
  const devices = created.map((key) => petDevice(probe, key));
  const gladys = createFakeGladys({ config, houses, devices });
  const app = registerHandlers(gladys, {
    tokenStore,
    fetch: tractive.fetch,
    timers,
    channel,
    timings: { petDelayMs: 0, ...timings },
    channelTimings,
    retryDelay: () => 0,
    now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return { gladys, app, hub: app.hub, tractive, tokenStore };
}

const PET_STATUS = {
  dog: {
    petId: 'PETDOG01',
    name: 'Rex',
    capabilities: new Set(['LT', 'BUZZER', 'LED', 'ACTIVITY_TRACKING', 'SLEEP_TRACKING']),
    reportsCharging: true,
  },
  cat: {
    petId: 'PETCAT02',
    name: 'Mia',
    capabilities: new Set(['LT', 'BUZZER', 'ACTIVITY_TRACKING']),
    reportsCharging: false,
  },
};

/** The Gladys device of a fixture pet, as the user would have added it. */
export function petDevice(gladys, key, language = 'fr') {
  return buildDevice(gladys, PET_STATUS[key], language);
}

/** The device of a pet, from the Discovery tab of the world. */
export const discovered = (world, name) =>
  world.gladys.fake.discoveredDevices.find((device) => device.name === name);

/** Add a discovered pet to Gladys, as the user would. */
export async function addToGladys(world, name) {
  const device = discovered(world, name);
  await world.gladys.fake.deviceCreated(device);
  await settle();
  return device;
}

/** Capture the console lines written by the loggers, at the given level. */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.map(String).join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
