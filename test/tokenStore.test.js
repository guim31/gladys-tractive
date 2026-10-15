import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore, accountTag } from '../src/tokenStore.js';

const credentials = { user_id: 'u1', access_token: 'token-1', expires_at: 4102444800 };

test('the token is saved for its account only, readable by its owner only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-tractive-'));
  const store = new TokenStore(dir);
  assert.equal(await store.load('a@example.com'), null);
  await store.save('A@example.com ', credentials);
  assert.deepEqual(await store.load('a@example.com'), credentials, 'case and spaces ignored');
  assert.equal(await store.load('b@example.com'), null);
  const file = readFileSync(join(dir, 'tractive-token.json'), 'utf8');
  assert.ok(!file.includes('a@example.com'), 'the e-mail address is not written');
  assert.equal(JSON.parse(file).account, accountTag('a@example.com'));
  assert.equal(statSync(join(dir, 'tractive-token.json')).mode & 0o777, 0o600);
  await store.clear();
  assert.equal(await store.load('a@example.com'), null);
});

test('a damaged file reads as no token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-tractive-'));
  writeFileSync(join(dir, 'tractive-token.json'), '{oops');
  assert.equal(await new TokenStore(dir).load('a@example.com'), null);
});

test('a /data that cannot be written makes save reject (the caller logs it once)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-tractive-'));
  writeFileSync(join(dir, 'not-a-dir'), '');
  const store = new TokenStore(join(dir, 'not-a-dir'));
  await assert.rejects(store.save('a@example.com', credentials));
  assert.equal(await store.load('a@example.com'), null);
});
