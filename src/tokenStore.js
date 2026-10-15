// -----------------------------------------------------------------------------
// The Tractive access token, kept in /data (the only writable volume) so a
// restart of the container does not log in again: Tractive tokens last for
// weeks, and every login is a request the account did not need.
//
// The file is bound to the account by a hash of the e-mail address: changing
// the account in the configuration ignores the token of the previous one. The
// password is never written there.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
const FILE = 'tractive-token.json';

/** Short, non-reversible tag of an account. */
export const accountTag = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

export class TokenStore {
  /** @param {string} [dir] directory of the token file */
  constructor(dir = DEFAULT_DATA_DIR) {
    this.path = join(dir, FILE);
    this.dir = dir;
  }

  /**
   * The saved credentials of this account, or null.
   * @returns {Promise<{ user_id: string, access_token: string, expires_at: number } | null>}
   */
  async load(email) {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        saved?.account !== accountTag(email) ||
        typeof saved.access_token !== 'string' ||
        typeof saved.user_id !== 'string' ||
        typeof saved.expires_at !== 'number'
      ) {
        return null;
      }
      return {
        user_id: saved.user_id,
        access_token: saved.access_token,
        expires_at: saved.expires_at,
      };
    } catch {
      return null;
    }
  }

  /** Save the credentials of this account (readable by the container user only). */
  async save(email, { user_id, access_token, expires_at }) {
    await mkdir(this.dir, { recursive: true });
    const body = JSON.stringify({ account: accountTag(email), user_id, access_token, expires_at });
    await writeFile(this.path, `${body}\n`, { mode: 0o600 });
  }

  async clear() {
    await rm(this.path, { force: true });
  }
}

/** A store that keeps nothing (tests, or a /data that cannot be written). */
export class MemoryTokenStore {
  constructor() {
    this.saved = new Map();
  }
  async load(email) {
    return this.saved.get(accountTag(email)) ?? null;
  }
  async save(email, credentials) {
    this.saved.set(accountTag(email), { ...credentials });
  }
  async clear() {
    this.saved.clear();
  }
}
