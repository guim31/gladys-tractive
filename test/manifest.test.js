// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTION_KEYS } from '../src/app.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { WIDGETS } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 2, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('the identity of the integration', () => {
  assert.equal(manifest.name, 'Tractive');
  assert.equal(manifest.type, 'device');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.location, true, 'the house coordinates are read (getHouses)');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-tractive:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-tractive/main/cover.png',
  );
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('every manifest action has a registered handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions), Object.values(ACTION_KEYS));
});

test('the minimum Gladys version covers every field used', () => {
  // categories: 4.86.0; widgets and scene triggers: 5.1.0; source "houses": 5.2.0.
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]), `got "${manifest.gladys_version}"`);
  assert.ok(allFields.some((field) => field.source === 'houses'));
});

test('no scene action is declared (the commands are device features)', () => {
  assert.equal(manifest.scene_actions, undefined);
});

test('every widgets key has an onWidgetGet handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets), Object.keys(WIDGETS));
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  for (const key of keysOf(manifest.widgets)) {
    assert.equal(typeof WIDGETS[key].get, 'function');
    assert.equal(typeof WIDGETS[key].action, 'function');
  }
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  assert.deepEqual(sortedKeys(manifest.scene_triggers), [...Object.values(TRIGGERS)].sort());
  for (const trigger of manifest.scene_triggers) {
    // The data the code sends: the device (filter) and the declared variables.
    assert.deepEqual(keysOf(trigger.fields), ['device']);
    const variables = keysOf(trigger.variables);
    assert.equal(variables[0], 'pet_name');
    assert.ok(['distance', 'battery'].includes(variables[1]));
  }
});

const sortedKeys = (list) => keysOf(list).sort();

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const stored = manifest.config_schema
    .filter((field) => field.type !== 'section')
    .map((f) => f.key);
  assert.deepEqual(stored.sort(), Object.keys(DEFAULT_CONFIG).sort());
});

test('number fields: integer min and default (the form has no step)', () => {
  for (const field of manifest.config_schema.filter((f) => f.type === 'number')) {
    assert.ok(Number.isInteger(field.min) && Number.isInteger(field.default), field.key);
  }
});

test('the password is a secret field, never in an action', () => {
  assert.equal(manifest.config_schema.find((f) => f.key === 'password').type, 'secret');
  for (const action of manifest.actions) {
    assert.ok(!(action.fields ?? []).some((field) => field.type === 'secret'));
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options or default', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  for (const field of dynamicSelects) {
    assert.ok(['devices', 'houses'].includes(field.source));
    assert.equal(field.options, undefined, `field "${field.key}"`);
    assert.equal(field.default, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en);
  }
});

test('the manifest says the integration is not affiliated with Tractive', () => {
  const intro = manifest.config_schema.find((f) => f.key === 'intro');
  assert.match(intro.description.en, /not affiliated with Tractive/);
});
