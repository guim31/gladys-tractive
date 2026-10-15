// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake
// Gladys) and returns the hub, so index.js stays a few lines and the tests
// drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { CONNECTION_TEXT } from './i18n.js';
import { TractiveHub } from './hub.js';
import { TokenStore } from './tokenStore.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'tractive-app' });

/** Keys of the manifest `actions`. */
export const ACTION_KEYS = { TEST_CONNECTION: 'test_connection' };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams, passed to the hub: tokenStore, fetch,
 *   timers, channel, timings, channelTimings, retryDelay, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new TractiveHub({
    gladys,
    tokenStore: options.tokenStore ?? new TokenStore(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    channel: options.channel ?? true,
    timings: options.timings,
    channelTimings: options.channelTimings,
    retryDelay: options.retryDelay,
    now: options.now,
  });

  // Resolved once the first start is over; every handler waits for it, so a
  // command arriving during the first refresh is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      if (started) {
        // A reconnection (Gladys restarted): resend what it may have lost.
        await hub.resync();
        return;
      }
      started = true;
      await hub.start(normalizeConfig(await gladys.getConfig()));
    } catch (err) {
      logger.error(`Initialization failed (${err.message})`);
      await gladys.setConnectionStatus(false, CONNECTION_TEXT.initFailed).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));
  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));
  // Devices are published with should_poll: false; this only serves a Gladys
  // that polls anyway (the container refreshes on its own timer).
  gladys.onPoll(whenReady((device) => hub.poll(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onConfigUpdated(
    whenReady(async (config) => {
      logger.info('New configuration received');
      await hub.reconfigure(normalizeConfig(config));
    }),
  );

  gladys.onAction(
    ACTION_KEYS.TEST_CONNECTION,
    whenReady(async () => {
      logger.info('Connection test requested');
      return hub.testConnection();
    }),
  );

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }

  return {
    hub,
    ready,
    stop: () => hub.stop(),
  };
}
