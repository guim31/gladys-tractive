// -----------------------------------------------------------------------------
// Client of the Tractive cloud API: the one the Tractive app and web app use
// (graph.tractive.com), as the aiotractive library (MIT, Gleb Sinyavskiy)
// reads it for Home Assistant. It is not a public, documented API.
//
// Being a good citizen of an API we were not invited to:
//   - one login per token lifetime: the token is kept in /data and reused
//     across restarts, renewed one hour before it expires;
//   - requests are sequential, never in parallel (see hub.js for the pause
//     between pets);
//   - a 429 is retried after 8 s, then up to 60 s, three times at most, like
//     aiotractive; past that the error goes up and the next cycle tries again;
//   - a refused login is not retried until the configuration changes (hub.js),
//     so a wrong password never hammers the account.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, TractiveError, kindForStatus } from './errors.js';

export const API_URL = 'https://graph.tractive.com/4/';
export const APS_API_URL = 'https://aps-api.tractive.com/api/1/';

// Client id of the aiotractive library (its default). The Home Assistant one
// was issued to Home Assistant only and must not be reused.
export const CLIENT_ID = '625e533dc3c3b41c28a669f0';

// Renew the token this long before it expires (aiotractive does the same).
const TOKEN_RENEW_MARGIN_S = 3600;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_COUNT = 3;

/** aiotractive's backoff on 429: 8 s, then a random wait up to 60 s. */
export const defaultRetryDelay = (attempt) =>
  Math.min(60_000, 8000 + Math.random() * 8000 * (2 ** attempt - 2));

export const COMMANDS = {
  buzzer: 'buzzer_control',
  led: 'led_control',
  live_tracking: 'live_tracking',
};

export class TractiveClient {
  /**
   * @param {object} options
   * @param {string} options.email
   * @param {string} options.password
   * @param {object} options.tokenStore TokenStore or MemoryTokenStore
   * @param {typeof fetch} [options.fetch]
   * @param {(attempt: number) => number} [options.retryDelay] ms before retry n (1-based)
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.now] ms since the epoch
   * @param {(err: Error) => void} [options.onStoreError] the token could not be saved
   */
  constructor({
    email,
    password,
    tokenStore,
    fetch = globalThis.fetch,
    retryDelay = defaultRetryDelay,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    onStoreError = () => {},
  }) {
    this.email = email;
    this.password = password;
    this.tokenStore = tokenStore;
    this.fetch = fetch;
    this.retryDelay = retryDelay;
    this.sleep = sleep;
    this.now = now;
    this.onStoreError = onStoreError;
    /** @type {{ user_id: string, access_token: string, expires_at: number } | null} */
    this.credentials = null;
    this.loaded = false;
    /** @type {Promise<object> | null} a login in progress, shared by every caller */
    this.loggingIn = null;
    /** Counts the logins really sent to Tractive (tests, diagnostics). */
    this.loginCount = 0;
  }

  baseHeaders() {
    return {
      'x-tractive-client': CLIENT_ID,
      'content-type': 'application/json;charset=UTF-8',
      accept: 'application/json, text/plain, */*',
    };
  }

  fresh(credentials) {
    return credentials && credentials.expires_at - this.now() / 1000 >= TOKEN_RENEW_MARGIN_S;
  }

  /** Valid credentials: the ones in memory, else the saved ones, else a login. */
  async authenticate() {
    if (!this.loaded) {
      this.loaded = true;
      this.credentials = await this.tokenStore.load(this.email).catch(() => null);
    }
    if (this.fresh(this.credentials)) {
      return this.credentials;
    }
    this.loggingIn ??= this.login().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async login() {
    this.loginCount += 1;
    let response;
    try {
      response = await this.fetch(new URL('auth/token', API_URL), {
        method: 'POST',
        headers: this.baseHeaders(),
        body: JSON.stringify({
          platform_email: this.email,
          platform_token: this.password,
          grant_type: 'tractive',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new TractiveError(ERROR_KINDS.NETWORK, `Tractive unreachable (${err.message})`);
    }
    if (!response.ok) {
      // 401 and 403 both mean "these credentials are refused".
      const kind = [401, 403].includes(response.status)
        ? ERROR_KINDS.UNAUTHORIZED
        : kindForStatus(response.status);
      throw new TractiveError(kind, `Tractive login refused (HTTP ${response.status})`, {
        status: response.status,
        auth: true,
      });
    }
    const body = await response.json().catch(() => null);
    if (!body || typeof body.access_token !== 'string' || body.user_id === undefined) {
      throw new TractiveError(ERROR_KINDS.INVALID, 'Unexpected answer to the Tractive login', {
        auth: true,
      });
    }
    this.credentials = {
      user_id: String(body.user_id),
      access_token: body.access_token,
      // Without an expiry, assume a day and log in again then.
      expires_at: Number.isFinite(body.expires_at) ? body.expires_at : this.now() / 1000 + 86400,
    };
    try {
      await this.tokenStore.save(this.email, this.credentials);
    } catch (err) {
      this.onStoreError(err);
    }
    return this.credentials;
  }

  /** Forget the token (refused by Tractive): the next call logs in again. */
  async invalidateToken() {
    this.credentials = null;
    await this.tokenStore.clear().catch(() => {});
  }

  async authHeaders() {
    const { user_id, access_token } = await this.authenticate();
    return {
      ...this.baseHeaders(),
      'x-tractive-user': user_id,
      authorization: `Bearer ${access_token}`,
    };
  }

  async userId() {
    return (await this.authenticate()).user_id;
  }

  /**
   * One API request, with the 429 retries and one new login on a refused token.
   * @param {string} path relative to the base URL
   * @param {object} [options]
   * @param {string} [options.base]
   */
  async request(path, { base = API_URL } = {}) {
    let renewed = false;
    for (let attempt = 1; ; attempt += 1) {
      const headers = await this.authHeaders();
      let response;
      try {
        response = await this.fetch(new URL(path, base), {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new TractiveError(ERROR_KINDS.NETWORK, `Tractive unreachable (${err.message})`);
      }
      if (response.status === 429 && attempt <= RETRY_COUNT) {
        await this.sleep(this.retryDelay(attempt));
        continue;
      }
      if (response.status === 401 && !renewed) {
        // The saved token was revoked or expired early: one fresh login.
        renewed = true;
        await this.invalidateToken();
        continue;
      }
      if (!response.ok) {
        throw new TractiveError(
          kindForStatus(response.status),
          `Tractive answered HTTP ${response.status} to ${describe(path)}`,
          { status: response.status },
        );
      }
      const type = response.headers.get('content-type') ?? '';
      if (!type.includes('application/json')) {
        return null;
      }
      return response.json().catch(() => {
        throw new TractiveError(ERROR_KINDS.INVALID, `Invalid JSON from ${describe(path)}`);
      });
    }
  }

  async trackableObjects() {
    const list = await this.request(
      `user/${encodeURIComponent(await this.userId())}/trackable_objects`,
    );
    return Array.isArray(list) ? list : [];
  }

  trackableObject(id) {
    return this.request(`trackable_object/${encodeURIComponent(id)}`);
  }

  tracker(id) {
    return this.request(`tracker/${encodeURIComponent(id)}`);
  }

  async hardwareReport(id) {
    return (await this.request(`device_hw_report/${encodeURIComponent(id)}/`)) ?? {};
  }

  async positionReport(id) {
    return (await this.request(`device_pos_report/${encodeURIComponent(id)}`)) ?? {};
  }

  /**
   * Activity and rest of the day. Empty when the pet has none: Tractive
   * answers 400 for a tracker that does not measure it, and 403 when the
   * subscription of the tracker is inactive (aiotractive).
   */
  async healthOverview(petId) {
    try {
      return (
        (await this.request(`pet/${encodeURIComponent(petId)}/health/overview`, {
          base: APS_API_URL,
        })) ?? {}
      );
    } catch (err) {
      if (err.kind === ERROR_KINDS.BAD_REQUEST || err.kind === ERROR_KINDS.FORBIDDEN) {
        return {};
      }
      throw err;
    }
  }

  /**
   * Turn a tracker function on or off.
   * @param {string} trackerId
   * @param {'buzzer'|'led'|'live_tracking'} command
   * @param {boolean} on
   * @returns {Promise<object>} Tractive's answer, `{ pending: true }` when accepted
   */
  async command(trackerId, command, on) {
    const name = COMMANDS[command];
    if (!name) {
      throw new Error(`Unknown command ${command}`);
    }
    return (
      (await this.request(
        `tracker/${encodeURIComponent(trackerId)}/command/${name}/${on ? 'on' : 'off'}`,
      )) ?? {}
    );
  }
}

// The endpoint without its identifiers, for the logs.
const describe = (path) => path.split('/')[0];
