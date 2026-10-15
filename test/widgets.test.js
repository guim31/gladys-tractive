// -----------------------------------------------------------------------------
// The "Tractive pet" widget: valid core vocabulary within the budget, every
// bound feature exists on the device, the buttons act and say so.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { CONFIG, createWorld, discovered, settle } from './helpers/world.js';

const DOG = 'ext:test-integration:pet:PETDOG01';
const CAT = 'ext:test-integration:pet:PETCAT02';

async function content(world, device, language = 'fr') {
  const ack = await world.gladys.fake.widgetGet('pet', {
    settings: device ? { device } : {},
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

test('every content is valid and fits the budget, in every language', async () => {
  const world = await createWorld({ created: ['dog', 'cat'] });
  for (const language of ['en', 'fr', 'de', 'es']) {
    for (const device of [DOG, CAT, undefined, 'ext:test-integration:pet:GONE']) {
      const result = await content(world, device, language);
      assert.deepEqual(validateWidgetContent(result), [], `${language} ${device}`);
      assert.ok(result.components.length <= 8);
      assert.ok(result.components.filter((c) => c.type === 'text').length <= 2);
    }
  }
  await world.app.stop();
});

test('the bound tiles point to features the device has', async () => {
  const world = await createWorld({ created: ['dog', 'cat'] });
  for (const [id, name] of [
    [DOG, 'Rex'],
    [CAT, 'Mia'],
  ]) {
    const features = new Set(discovered(world, name).features.map((f) => f.external_id));
    for (const component of (await content(world, id)).components) {
      if (component.device_feature) {
        assert.ok(features.has(component.device_feature), `${name}: ${component.device_feature}`);
      }
    }
  }
  await world.app.stop();
});

test('the dog: distance, battery, activity gauge, status and two buttons', async () => {
  const world = await createWorld({ created: ['dog'] });
  const result = await content(world, DOG, 'en');
  assert.deepEqual(
    result.components.map((c) => c.type),
    ['text', 'value', 'value', 'gauge', 'status', 'button', 'button'],
  );
  assert.equal(result.components[0].text, 'Rex');
  const gauge = result.components[3];
  assert.deepEqual([gauge.value, gauge.min, gauge.max, gauge.unit], [150, 0, 200, 'min']);
  const status = result.components[4].items.map((item) => [item.label, item.value]);
  assert.deepEqual(status[0], ['At home', 'Yes']);
  assert.deepEqual(status[2], ['Tracker', 'Online']);
  assert.deepEqual(
    result.components.slice(5).map((c) => [c.label, c.action.key, c.action.params.on]),
    [
      ['Buzz', 'buzzer', true],
      ['Light', 'led', true],
    ],
  );
  await world.app.stop();
});

test('the cat has no light button and says it is in power saving', async () => {
  const world = await createWorld({ created: ['cat'] });
  const result = await content(world, CAT, 'fr');
  const buttons = result.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    ['buzzer'],
  );
  const tracker = result.components.find((c) => c.type === 'status').items[2];
  assert.equal(tracker.value, 'Économie (Wi-Fi maison)');
  await world.app.stop();
});

test('a button sends the command, toasts, and the next content offers to stop', async () => {
  const world = await createWorld({ created: ['dog'], config: { ...CONFIG, language: 'en' } });
  const ack = await world.gladys.fake.widgetAction(
    'pet',
    'buzzer',
    { on: true },
    { settings: { device: DOG } },
  );
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Le traceur de Rex sonne.');
  assert.equal(world.tractive.count(/command\/buzzer_control\/on$/), 1);
  await settle();
  const button = (await content(world, DOG, 'en')).components.find(
    (c) => c.action?.key === 'buzzer',
  );
  assert.equal(button.label, 'Stop buzzer');
  assert.equal(button.icon, 'check-circle', 'the running state shows by the icon');
  assert.equal(button.action.params.on, false);

  const off = await world.gladys.fake.widgetAction(
    'pet',
    'buzzer',
    { on: false },
    { settings: { device: DOG } },
  );
  assert.equal(off.data.message.en, "Rex's buzzer is off.");
  assert.equal(world.tractive.count(/command\/buzzer_control\/off$/), 1);
  await world.app.stop();
});

test('a refused command fails the action with the reason', async () => {
  const world = await createWorld({ created: ['dog'], config: { ...CONFIG, language: 'en' } });
  world.tractive.override(/command\/led_control/, 403);
  const ack = await world.gladys.fake.widgetAction(
    'pet',
    'led',
    { on: true },
    { settings: { device: DOG } },
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /subscription/);
  await world.app.stop();
});

test('the status follows the position age and the house', async () => {
  const now = (1716106551 + 3 * 3600) * 1000;
  const world = await createWorld({ created: ['dog'], now: () => now });
  const items = (await content(world, DOG, 'de')).components.find((c) => c.type === 'status').items;
  assert.equal(items[1].value, 'Vor 3 Std.');
  await world.app.stop();

  const nowhere = await createWorld({ created: ['dog'], houses: [] });
  const status = (await content(nowhere, DOG, 'es')).components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value, 'Ninguna casa ubicada');
  await nowhere.app.stop();
});
