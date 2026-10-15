// -----------------------------------------------------------------------------
// The real-time channel: lines split anywhere, keep-alive watchdog, routine
// closes, refused tokens, and the backoff after failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TractiveChannel, readLines } from '../src/tractive/channel.js';
import { TractiveClient } from '../src/tractive/client.js';
import { MemoryTokenStore } from '../src/tokenStore.js';
import { EMAIL, PASSWORD, createFakeTractive } from './helpers/fakeTractive.js';
import { settle } from './helpers/world.js';

function streamOf(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test('readLines rebuilds lines split across chunks and skips empty ones', async () => {
  const lines = [];
  for await (const line of readLines(streamOf(['{"a":', '1}\n\n{"b"', ':2}\n{"c":3}']))) {
    lines.push(line);
  }
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

function setup({ tractive = createFakeTractive(), timings = {} } = {}) {
  const client = new TractiveClient({
    email: EMAIL,
    password: PASSWORD,
    tokenStore: new MemoryTokenStore(),
    fetch: tractive.fetch,
    retryDelay: () => 0,
  });
  const record = { events: [], connected: 0, errors: [], stopped: [] };
  const channel = new TractiveChannel({
    client,
    fetch: tractive.fetch,
    timings: { retryBaseMs: 5, retryMaxMs: 20, watchdogMs: 5, keepAliveTimeoutMs: 40, ...timings },
    onEvent: (event) => record.events.push(event),
    onConnected: () => (record.connected += 1),
    onError: (err) => record.errors.push(err),
    onStopped: (err) => record.stopped.push(err),
  });
  return { tractive, client, channel, record };
}

const opened = (tractive) => tractive.count(/channel\.tractive\.com/);

async function waitFor(condition, ms = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test('handshake and events go through, keep-alives do not', async () => {
  const { tractive, channel, record } = setup();
  channel.start();
  await waitFor(() => tractive.channel);
  tractive.channel.push({ message: 'handshake' });
  tractive.channel.push({ message: 'keep-alive' });
  tractive.channel.push({ message: 'tracker_status', tracker_id: 'T1' });
  tractive.channel.pushRaw('not json\n');
  await settle();
  assert.equal(record.connected, 1);
  assert.equal(channel.connected, true);
  assert.deepEqual(record.events, [{ message: 'tracker_status', tracker_id: 'T1' }]);
  await channel.stop();
  assert.equal(channel.connected, false);
});

test('a stream closed by Tractive after data reconnects at once, without an error', async () => {
  const { tractive, channel, record } = setup({ timings: { retryBaseMs: 10_000 } });
  channel.start();
  await waitFor(() => tractive.channel);
  tractive.channel.push({ message: 'handshake' });
  await settle();
  tractive.channel.fail();
  await waitFor(() => opened(tractive) === 2);
  assert.deepEqual(record.errors, []);
  await channel.stop();
});

test('no keep-alive for too long: the connection is closed and reopened', async () => {
  const { tractive, channel } = setup({ timings: { keepAliveTimeoutMs: 30 } });
  channel.start();
  await waitFor(() => tractive.channel);
  tractive.channel.push({ message: 'handshake' });
  await waitFor(() => opened(tractive) >= 2, 2000);
  await channel.stop();
});

test('a failing channel backs off and reports each failure', async () => {
  const tractive = createFakeTractive();
  tractive.setChannelStatus(503);
  const { channel, record } = setup({ tractive });
  channel.start();
  await waitFor(() => record.errors.length >= 3);
  assert.match(record.errors[0].message, /HTTP 503/);
  await channel.stop();
  const attempts = opened(tractive);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(opened(tractive), attempts, 'stopped: no more attempts');
});

test('a refused token gets one new login, then the channel gives up', async () => {
  const tractive = createFakeTractive();
  tractive.setChannelStatus(401);
  const { channel, record } = setup({ tractive });
  channel.start();
  await waitFor(() => record.stopped.length === 1);
  assert.equal(tractive.count(/auth\/token$/), 2, 'one renewal');
  assert.equal(channel.running, false);
  await channel.stop();
});
