// -----------------------------------------------------------------------------
// The Tractive real-time channel (channel.tractive.com), the event stream the
// Tractive app listens to: one long-lived HTTP response carrying one JSON
// message per line — `handshake` once connected, `keep-alive` every few
// seconds, then `tracker_status` (battery, position, buzzer, LED, live
// tracking) and `health_overview` (activity) messages as they happen.
//
// Same behaviour as aiotractive's Channel: a stream closed by Tractive after
// it delivered data is normal and reconnects at once; no keep-alive for 60 s
// means a dead connection, closed and reopened; a failed connection waits
// before the next attempt (10 s, doubling up to 5 min) so an outage never
// turns into a request loop. A refused token (401/403) gets one fresh login,
// then the channel stops and reports it: the REST cycle owns the login
// problems.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, TractiveError, kindForStatus } from './errors.js';

export const CHANNEL_URL = 'https://channel.tractive.com/3/channel';

export const DEFAULT_CHANNEL_TIMINGS = {
  keepAliveTimeoutMs: 60_000,
  watchdogMs: 5000,
  retryBaseMs: 10_000,
  retryMaxMs: 300_000,
};

export class TractiveChannel {
  /**
   * @param {object} options
   * @param {import('./client.js').TractiveClient} options.client
   * @param {typeof fetch} [options.fetch]
   * @param {(event: object) => void} options.onEvent
   * @param {() => void} [options.onConnected] handshake received
   * @param {(err: Error) => void} [options.onError] a connection failed or dropped
   * @param {(err: Error) => void} [options.onStopped] given up (refused token)
   * @param {object} [options.timings] DEFAULT_CHANNEL_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({
    client,
    fetch = globalThis.fetch,
    onEvent,
    onConnected = () => {},
    onError = () => {},
    onStopped = () => {},
    timings = {},
    now = () => Date.now(),
  }) {
    this.client = client;
    this.fetch = fetch;
    this.onEvent = onEvent;
    this.onConnected = onConnected;
    this.onError = onError;
    this.onStopped = onStopped;
    this.timings = { ...DEFAULT_CHANNEL_TIMINGS, ...timings };
    this.now = now;
    this.running = false;
    this.connected = false;
    this.controller = null;
    this.wait = null;
    this.loop = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  /** Stop and wait for the loop to end. */
  async stop() {
    this.running = false;
    this.connected = false;
    this.controller?.abort();
    this.wait?.cancel();
    await this.loop;
    this.loop = null;
  }

  async run() {
    let failures = 0;
    let renewedToken = false;
    while (this.running) {
      let receivedData = false;
      try {
        receivedData = await this.connectOnce();
        if (!this.running) {
          break;
        }
        // Closed by Tractive. After data, a routine close: reconnect now.
        if (!receivedData) {
          throw new TractiveError(ERROR_KINDS.NETWORK, 'The channel closed without any message');
        }
        failures = 0;
        renewedToken = false;
        continue;
      } catch (err) {
        if (!this.running) {
          break;
        }
        this.connected = false;
        if (receivedData) {
          failures = 0;
          renewedToken = false;
        }
        if (err.kind === ERROR_KINDS.UNAUTHORIZED || err.kind === ERROR_KINDS.FORBIDDEN) {
          if (err.auth || renewedToken) {
            // The login itself failed, or a fresh token is refused too.
            this.running = false;
            this.onStopped(err);
            break;
          }
          renewedToken = true;
          await this.client.invalidateToken();
          continue;
        }
        this.onError(err);
        failures += 1;
        const delay = Math.min(
          this.timings.retryMaxMs,
          this.timings.retryBaseMs * 2 ** Math.max(0, failures - 1),
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * One connection, until it ends.
   * @returns {Promise<boolean>} true when at least one message was received
   */
  async connectOnce() {
    const headers = await this.client.authHeaders();
    const controller = new AbortController();
    this.controller = controller;
    let lastMessage = this.now();
    let timedOut = false;
    const watchdog = setInterval(() => {
      if (this.now() - lastMessage > this.timings.keepAliveTimeoutMs) {
        timedOut = true;
        controller.abort();
      }
    }, this.timings.watchdogMs);
    let receivedData = false;
    try {
      let response;
      try {
        response = await this.fetch(CHANNEL_URL, {
          method: 'POST',
          headers,
          signal: controller.signal,
        });
      } catch (err) {
        if (timedOut) {
          throw new TractiveError(ERROR_KINDS.NETWORK, 'The channel did not answer');
        }
        throw new TractiveError(ERROR_KINDS.NETWORK, `Channel unreachable (${err.message})`);
      }
      if (!response.ok) {
        throw new TractiveError(
          kindForStatus(response.status),
          `The channel answered HTTP ${response.status}`,
          { status: response.status },
        );
      }
      try {
        for await (const line of readLines(response.body)) {
          lastMessage = this.now();
          receivedData = true;
          this.handleLine(line);
        }
      } catch (err) {
        if (!this.running) {
          return receivedData;
        }
        if (timedOut) {
          // A silent connection: no keep-alive for a minute.
          return receivedData;
        }
        if (receivedData) {
          // Tractive cuts the long-lived stream from time to time without a
          // clean end: normal, reconnect.
          return true;
        }
        throw new TractiveError(ERROR_KINDS.NETWORK, `Channel dropped (${err.message})`);
      }
      return receivedData;
    } finally {
      clearInterval(watchdog);
      this.controller = null;
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.message === 'keep-alive') {
      return;
    }
    if (message.message === 'handshake') {
      this.connected = true;
      this.onConnected();
      return;
    }
    this.onEvent(message);
  }

  /** A cancellable pause (stop() ends it at once). */
  sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const wait = { cancel: done };
      this.wait = wait;
      function done() {
        clearTimeout(timer);
        resolve();
      }
    }).finally(() => {
      this.wait = null;
    });
  }
}

/** The lines of a web ReadableStream of bytes, as strings (empty lines skipped). */
export async function* readLines(body) {
  if (!body) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') {
        yield line;
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() !== '') {
    yield buffer.trim();
  }
}
