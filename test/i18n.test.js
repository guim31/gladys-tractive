// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { CONNECTION_TEXT, MESSAGES, NAMES } from '../src/i18n.js';
import { TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(table, name, max, render = (value) => value) {
  const found = [];
  if (JSON.stringify(sorted(Object.keys(table))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${name} has [${Object.keys(table)}], expected exactly [${LANGS}]`);
  }
  for (const lang of LANGS) {
    const entries = table[lang] ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !== JSON.stringify(sorted(Object.keys(table.en)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      const limit = typeof max === 'function' ? max(key) : max;
      found.push(...textProblems(render(value), `${name}.${lang}.${key}`, lang, limit));
    }
  }
  return found;
}

const renderSample = (value) =>
  typeof value === 'function' ? value(12, 'Rex, Mia, Filou, Pepper, Luna, Oscar') : value;

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const options = manifest.config_schema.find((field) => field.key === 'language').options;
  assert.deepEqual(sorted(options.map((option) => option.value)), sorted(LANGS));
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 45, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is short, recognizable and the same in every language', () => {
  assert.equal(manifest.name, 'Tractive');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of LANGS) {
    assert.ok(manifest.description[lang].length >= 10, `description.${lang} is too short`);
  }
});

test('the feature names exist in every language', () => {
  assert.deepEqual(tableProblems(NAMES, 'NAMES', MAX.featureName), []);
});

test('the connection statuses and the code messages exist in every language', () => {
  const found = [
    ...Object.entries(CONNECTION_TEXT).flatMap(([key, value]) =>
      problems(value, `CONNECTION_TEXT.${key}`, MAX.message),
    ),
    ...tableProblems(MESSAGES, 'MESSAGES', MAX.message, renderSample),
  ];
  assert.deepEqual(found, []);
});

test('the widget texts exist in every language and fit their slot', () => {
  const long = new Set(['pick', 'unknown']);
  const max = (key) => (long.has(key) ? MAX.message : MAX.short);
  // Status values (≤ 40) may be longer than tile labels.
  const statusValues = new Set(['noHouse', 'powerSaving', 'unknownValue', 'offline', 'online']);
  const limit = (key) => (statusValues.has(key) ? MAX.status : max(key));
  assert.deepEqual(
    tableProblems(TEXT, 'TEXT', limit, (value) => renderSample(value)),
    [],
  );
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Pet', fr: 'Animal', de: 'Tier' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'Pet', fr: 'Animal', de: '', es: 'Mascota' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of [
    'Wählen Sie',
    'Ihr Tier',
    'Ihre E-Mail',
    'mit Ihrem',
    'Ihren',
    'Ihrer',
    'Ihres',
  ]) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].label.es;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].label has [en,fr,de], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation -------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

const headings = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,3} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four docs exist, are long enough and have the same sections', () => {
  const reference = headings(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'en: the expected sections');
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 3000, `docs/${lang}.md is too short`);
    assert.deepEqual(headings(docs[lang]), reference, `docs/${lang}.md: not the sections of en`);
  }
});

test('the docs say the integration was developed without the hardware', () => {
  const patterns = {
    en: /without the hardware/i,
    fr: /sans le matériel/i,
    de: /ohne die Hardware/i,
    es: /sin el hardware/i,
  };
  for (const lang of LANGS) {
    assert.match(docs[lang], patterns[lang], `docs/${lang}.md`);
    assert.match(docs[lang], /Tractive/);
  }
});

test('German docs say "du", never "Sie"', () => {
  assert.ok(
    !POLITE_GERMAN.test(docs.de.replace(/`[^`]*`/g, '')),
    'docs/de.md uses the polite form',
  );
});

test('the docs name every trigger, the widget and the action of the manifest', () => {
  for (const lang of LANGS) {
    for (const trigger of manifest.scene_triggers) {
      assert.ok(
        docs[lang].includes(trigger.label[lang]),
        `docs/${lang}.md: ${trigger.label[lang]}`,
      );
    }
    for (const widget of manifest.widgets) {
      assert.ok(docs[lang].includes(widget.label[lang]), `docs/${lang}.md: ${widget.label[lang]}`);
    }
    for (const action of manifest.actions) {
      assert.ok(docs[lang].includes(action.label[lang]), `docs/${lang}.md: ${action.label[lang]}`);
    }
  }
});

test('the docs name every feature in their language', () => {
  for (const lang of LANGS) {
    for (const name of Object.values(NAMES[lang])) {
      assert.ok(docs[lang].includes(name), `docs/${lang}.md: ${name}`);
    }
  }
});
