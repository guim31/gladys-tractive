#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Tractive API with the integration's own client, read-only.
// For a machine with network access (the development sessions have none).
//
//   node scripts/probe.mjs
//     Logs in with an invented account and checks that Tractive refuses it the
//     way the integration expects (HTTP 401/403 → "unauthorized"): proves the
//     endpoint, the client id and the login body are still accepted.
//
//   TRACTIVE_EMAIL=... TRACTIVE_PASSWORD=... node scripts/probe.mjs
//     With a real account: lists the pets and reads each REST endpoint once,
//     then listens to the real-time channel for 30 s. Never sends a command.
//
// Prints no secret, no name, no position: only statuses, counts, capability
// codes and the keys of the answers (to spot a format change).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { TractiveChannel } from '../src/tractive/channel.js';
import { TractiveClient } from '../src/tractive/client.js';
import { MemoryTokenStore } from '../src/tokenStore.js';

const keys = (value) =>
  value && typeof value === 'object' ? Object.keys(value).sort().join(', ') : String(value);
const line = (label, value) => console.log(`${label.padEnd(28)} ${value}`);

async function probeRefusal() {
  const email = `gladys-probe-${randomBytes(6).toString('hex')}@example.com`;
  const client = new TractiveClient({
    email,
    password: randomBytes(12).toString('hex'),
    tokenStore: new MemoryTokenStore(),
  });
  try {
    await client.authenticate();
    line('login with a fake account', 'ACCEPTED (unexpected!)');
    return 1;
  } catch (err) {
    line('login with a fake account', `${err.kind} (HTTP ${err.status ?? '-'})`);
    if (err.kind === 'unauthorized' && err.auth) {
      line('result', 'OK: refused as the integration expects');
      return 0;
    }
    line('result', 'UNEXPECTED: check the endpoint, the client id or the network');
    return 1;
  }
}

async function probeAccount(email, password) {
  const client = new TractiveClient({ email, password, tokenStore: new MemoryTokenStore() });
  await client.authenticate();
  line('login', 'OK');
  const objects = await client.trackableObjects();
  line('trackable objects', objects.length);
  for (const [index, object] of objects.entries()) {
    const pet = await client.trackableObject(object._id);
    const label = `pet #${index + 1}`;
    line(`${label} keys`, keys(pet));
    if (!pet?.device_id) {
      line(`${label}`, 'no tracker');
      continue;
    }
    if (!pet.details || Object.keys(pet.details).length === 0) {
      line(`${label}`, 'shared tracker (no details)');
      continue;
    }
    const tracker = await client.tracker(pet.device_id);
    line(`${label} tracker model`, tracker.model_number);
    line(`${label} capabilities`, (tracker.capabilities ?? []).join(' '));
    line(
      `${label} state`,
      `${tracker.state} / ${tracker.state_reason} / ${tracker.charging_state}`,
    );
    const hardware = await client.hardwareReport(pet.device_id);
    line(`${label} hw report keys`, keys(hardware));
    const position = await client.positionReport(pet.device_id);
    line(`${label} pos report keys`, keys(position));
    line(
      `${label} position`,
      Array.isArray(position.latlong) ? `present, ±${position.pos_uncertainty} m` : 'none',
    );
    const health = await client.healthOverview(pet._id);
    line(`${label} health keys`, keys(health));
    line(`${label} activity keys`, keys(health.activity));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const counts = {};
  let handshake = false;
  const channel = new TractiveChannel({
    client,
    onConnected: () => {
      handshake = true;
    },
    onEvent: (event) => {
      counts[event.message] = (counts[event.message] ?? 0) + 1;
    },
    onError: (err) => line('channel error', err.message),
    onStopped: (err) => line('channel stopped', err.message),
  });
  channel.start();
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  await channel.stop();
  line('channel handshake', handshake ? 'yes' : 'no');
  line('channel messages (30 s)', JSON.stringify(counts));
  return 0;
}

const { TRACTIVE_EMAIL: email, TRACTIVE_PASSWORD: password } = process.env;
try {
  process.exitCode = email && password ? await probeAccount(email, password) : await probeRefusal();
} catch (err) {
  line('failed', `${err.kind ?? 'error'}: ${err.message}`);
  process.exitCode = 1;
}
