// -----------------------------------------------------------------------------
// The integration's state and lifecycle: the Tractive session, the pets, the
// states published to Gladys, the scene triggers and the commands.
//
// Where the states come from:
//   - the real-time channel (channel.tractive.com) pushes battery, position,
//     buzzer, LED and live tracking as they change — the main source, like in
//     the Tractive app and in Home Assistant;
//   - a REST refresh of the pets added to Gladys runs on the container's own
//     timer (every `refresh_minutes`, 15 by default): activity of the day,
//     and a safety net when the channel is down. The devices are published
//     with `should_poll: false` (the Gladys scheduler cannot be relied on,
//     GladysAssistant/Gladys#3198); onPoll stays as a fallback and refreshes
//     only when the timer has not done it for 90 % of a period.
//
// Only the changes are published (publishChangedStates), with a heartbeat
// every 6 hours so a stable value never shows "no recent value" in Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hasCredentials, normalizeConfig } from './config.js';
import { SWITCH_COMMANDS, buildDevice, buildStates, deviceIds, featureKeys } from './devices.js';
import { distanceMeters, nextAtHome } from './geo.js';
import { CONNECTION_TEXT, allLanguages, messagesFor } from './i18n.js';
import { IssueLog } from './issues.js';
import { TractiveChannel } from './tractive/channel.js';
import { TractiveClient } from './tractive/client.js';
import { ERROR_KINDS } from './tractive/errors.js';
import {
  applyHardwareReport,
  applyHealthOverview,
  applyPositionReport,
  applyTrackerDetails,
  applyTrackerEvent,
  createPetStatus,
} from './tractive/status.js';

const logger = createLogger({ name: 'tractive' });

export const WIDGET_KEY = 'pet';

export const TRIGGERS = {
  LEFT_HOME: 'pet_left_home',
  CAME_HOME: 'pet_came_home',
  BATTERY_LOW: 'battery_low',
};

/** Points above the threshold the battery must climb back to re-arm the alert. */
export const BATTERY_REARM_MARGIN = 5;

export const DEFAULT_TIMINGS = {
  // Pause between the REST requests of two pets (aiotractive's fetch_delay).
  petDelayMs: 2000,
  // Republish an unchanged value this often (Gladys flags a value older than
  // 48 h as not recent).
  heartbeatMs: 6 * 3600 * 1000,
  // First retry after a failed connection, doubled up to the refresh period.
  retryBaseMs: 60_000,
  // The core drops widget nudges closer than 10 s.
  widgetRefreshMs: 10_000,
};

export class TractiveHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.tokenStore where the Tractive token is kept
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers] run the refresh timer
   * @param {boolean} [options.channel] open the real-time channel
   * @param {object} [options.timings] DEFAULT_TIMINGS overrides
   * @param {object} [options.channelTimings] channel timing overrides
   * @param {(attempt: number) => number} [options.retryDelay] 429 backoff
   * @param {() => number} [options.now]
   */
  constructor({
    gladys,
    tokenStore,
    fetch = globalThis.fetch,
    timers = true,
    channel = true,
    timings = {},
    channelTimings = {},
    retryDelay,
    now = () => Date.now(),
  }) {
    this.gladys = gladys;
    this.tokenStore = tokenStore;
    this.fetch = fetch;
    this.useTimers = timers;
    this.useChannel = channel;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.channelTimings = channelTimings;
    this.retryDelay = retryDelay;
    this.now = now;
    this.issues = new IssueLog(logger);

    this.config = normalizeConfig();
    this.client = null;
    this.channel = null;
    /** @type {Map<string, object>} petId → status */
    this.pets = new Map();
    /** @type {Map<string, string>} trackerId → petId */
    this.trackerToPet = new Map();
    /** @type {Map<string, { distance: number|null, atHome: boolean|null }>} */
    this.presence = new Map();
    /** @type {Map<string, boolean>} petId → the low-battery alert can fire */
    this.batteryArmed = new Map();
    /** Coordinates of the house the distance is measured from, or null. */
    this.home = null;
    /** 'idle' | 'no_credentials' | 'login_refused' | 'unreachable' | 'connected' */
    this.phase = 'idle';
    this.discovered = false;
    this.lastRefreshAt = null;
    this.failures = 0;
    this.refreshing = null;
    this.timer = null;
    this.widgetTimer = null;
    this.widgetPending = false;
    this.lastWidgetRefreshAt = null;
    this.stopped = true;
    this.generation = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)start with a configuration: new session, first refresh, timer, channel. */
  async start(config) {
    await this.shutdown();
    this.stopped = false;
    this.generation += 1;
    this.config = config;
    this.phase = 'idle';
    this.issues.reset();
    this.pets.clear();
    this.trackerToPet.clear();
    this.presence.clear();
    this.batteryArmed.clear();
    this.discovered = false;
    this.lastRefreshAt = null;
    this.failures = 0;
    await this.loadHome();

    if (!hasCredentials(config)) {
      this.phase = 'no_credentials';
      logger.info('Waiting for the Tractive e-mail address and password in the configuration');
      await this.setConnectionStatus(false, CONNECTION_TEXT.noCredentials);
      await this.publishDiscovered();
      return;
    }
    this.client = new TractiveClient({
      email: config.email,
      password: config.password,
      tokenStore: this.tokenStore,
      fetch: this.fetch,
      retryDelay: this.retryDelay,
      now: this.now,
      onStoreError: (err) =>
        this.issues.fail(
          'token-store',
          `The Tractive token cannot be saved in /data (${err.code ?? err.message})`,
        ),
    });
    await this.refresh({ force: true });
    this.schedule();
  }

  /** Gladys came back (it restarted): resend what it may have lost. */
  async resync() {
    if (this.stopped) {
      return;
    }
    await this.loadHome();
    this.recomputePresence();
    await this.publishDiscovered();
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
    this.requestWidgetRefresh();
  }

  /** A new configuration from the Configuration screen. */
  async reconfigure(config) {
    const previous = this.config;
    const sessionChanged =
      previous.email !== config.email || previous.password !== config.password || this.stopped;
    if (sessionChanged || this.phase !== 'connected') {
      await this.start(config);
      return;
    }
    this.config = config;
    if (previous.house !== config.house || previous.home_radius !== config.home_radius) {
      await this.loadHome();
      // A new house or radius: "at home" starts over, without firing triggers.
      this.presence.clear();
      this.recomputePresence();
    }
    if (previous.battery_low_threshold !== config.battery_low_threshold) {
      this.batteryArmed.clear();
    }
    // New feature names apply to the devices not added yet.
    await this.publishDiscovered();
    await this.publishAll();
    this.requestWidgetRefresh();
    if (previous.refresh_minutes !== config.refresh_minutes) {
      this.schedule();
    }
  }

  async shutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    clearTimeout(this.widgetTimer);
    this.widgetTimer = null;
    const channel = this.channel;
    this.channel = null;
    await channel?.stop();
    await this.refreshing?.catch(() => {});
  }

  /** Stop for good (container shutdown). */
  async stop() {
    await this.shutdown();
  }

  periodMs() {
    return this.config.refresh_minutes * 60_000;
  }

  /** The next refresh: one period, or sooner while the connection fails. */
  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.useTimers || this.stopped || this.phase === 'login_refused' || !this.client) {
      return;
    }
    const delay =
      this.phase === 'connected'
        ? this.periodMs()
        : Math.min(this.periodMs(), this.timings.retryBaseMs * 2 ** Math.max(0, this.failures - 1));
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.refresh();
      } finally {
        this.schedule();
      }
    }, delay);
  }

  // --- Houses ----------------------------------------------------------------

  async loadHome() {
    let houses = [];
    try {
      houses = await this.gladys.getHouses();
      this.issues.recover('houses', 'The Gladys houses can be read again');
    } catch (err) {
      this.issues.fail('houses', `The Gladys houses cannot be read (${err.message})`);
    }
    const located = (house) =>
      Number.isFinite(house?.latitude) && Number.isFinite(house?.longitude);
    const chosen = this.config.house
      ? houses.find((house) => house.selector === this.config.house)
      : houses.find(located);
    this.home = located(chosen) ? { latitude: chosen.latitude, longitude: chosen.longitude } : null;
    if (this.home) {
      this.issues.recover(
        'no-home',
        'A located Gladys house is available: distances are computed again',
      );
    } else {
      this.issues.fail(
        'no-home',
        this.config.house
          ? 'The chosen Gladys house has no location: the distance and "at home" stay empty'
          : 'No Gladys house has a location: the distance and "at home" stay empty',
      );
    }
  }

  // --- Refresh ---------------------------------------------------------------

  /**
   * One REST cycle: the pet list on the first run, then the states of the pets
   * added to Gladys. Never throws: problems are logged and shown as the
   * connection status. Concurrent callers share the cycle in progress.
   * @param {object} [options]
   * @param {boolean} [options.force] refresh even if the timer just did
   * @param {string[]} [options.petIds] only these pets (a device just added)
   */
  refresh(options = {}) {
    if (this.refreshing) {
      // A forced or targeted refresh asked during a cycle runs after it: the
      // cycle in progress may predate what the caller wants (a new scan).
      return this.refreshing.then(() =>
        options.petIds || options.force ? this.refresh(options) : undefined,
      );
    }
    this.refreshing = this.runRefresh(options).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async runRefresh({ petIds } = {}) {
    if (!this.client || this.stopped || this.phase === 'login_refused') {
      return;
    }
    const generation = this.generation;
    try {
      if (!this.discovered) {
        await this.discover();
        if (generation !== this.generation) return;
      }
      const targets = this.createdPets().filter((pet) => !petIds || petIds.includes(pet.petId));
      for (const [index, pet] of targets.entries()) {
        if (index > 0) {
          await this.pause();
        }
        await this.refreshPet(pet);
        if (generation !== this.generation) return;
      }
      if (!petIds) {
        this.lastRefreshAt = this.now();
      }
      await this.onConnected();
      // (Re)open the real-time channel: first cycle, or after it gave up on a
      // refused token (at most one attempt per cycle).
      if (this.useChannel && !this.channel && !this.stopped) {
        this.startChannel();
      }
      await this.publishAll(targets);
    } catch (err) {
      if (generation === this.generation) {
        await this.onFailure(err);
      }
    }
  }

  /** Read the pets with a tracker, then publish them in the Discovery tab. */
  async discover() {
    const objects = await this.client.trackableObjects();
    const found = new Map();
    for (const [index, object] of objects.entries()) {
      if (index > 0) {
        await this.pause();
      }
      const pet = await this.client.trackableObject(object._id);
      if (!pet?.device_id) {
        logger.debug(`Pet ${object._id} has no tracker: skipped`);
        continue;
      }
      if (!pet.details || Object.keys(pet.details).length === 0) {
        // Tractive gives no details for a tracker shared by another account.
        logger.debug(`Pet ${object._id} is shared from another account: skipped`);
        continue;
      }
      const tracker = await this.client.tracker(pet.device_id);
      if (!tracker?._id) {
        logger.debug(`Tracker of pet ${object._id} has no details: skipped`);
        continue;
      }
      const previous = this.pets.get(String(pet._id));
      const status = createPetStatus(pet, tracker);
      if (previous && previous.trackerId === status.trackerId) {
        // Keep what the channel told since: only the details are new.
        Object.assign(previous, {
          name: status.name,
          model: status.model,
          firmware: status.firmware,
        });
        applyTrackerDetails(previous, tracker);
        found.set(previous.petId, previous);
      } else {
        found.set(status.petId, status);
      }
    }
    this.pets = found;
    this.trackerToPet = new Map([...found.values()].map((pet) => [pet.trackerId, pet.petId]));
    this.discovered = true;
    await this.publishDiscovered();
  }

  async refreshPet(pet) {
    const tracker = await this.client.tracker(pet.trackerId);
    if (tracker) {
      applyTrackerDetails(pet, tracker);
    }
    applyHardwareReport(pet, await this.client.hardwareReport(pet.trackerId));
    applyPositionReport(pet, await this.client.positionReport(pet.trackerId));
    if (featureKeys(pet).includes('activity') || featureKeys(pet).includes('rest')) {
      const health = await this.client.healthOverview(pet.petId);
      if (health && Object.keys(health).length > 0) {
        applyHealthOverview(pet, health);
      }
    }
  }

  async onConnected() {
    this.failures = 0;
    const wasConnected = this.phase === 'connected';
    this.phase = 'connected';
    const recovered = this.issues.recover('tractive', 'Tractive answers again');
    if (!wasConnected) {
      if (!recovered) {
        logger.info(`Connected to Tractive: ${this.pets.size} pet(s) with a tracker`);
      }
      await this.setConnectionStatus(true);
    }
  }

  async onFailure(err) {
    if (err.kind === ERROR_KINDS.UNAUTHORIZED && err.auth) {
      this.phase = 'login_refused';
      logger.error(
        'Tractive refused the e-mail address or the password: fix them in the configuration',
      );
      await this.client?.invalidateToken();
      const channel = this.channel;
      this.channel = null;
      await channel?.stop();
      clearTimeout(this.timer);
      this.timer = null;
      await this.setConnectionStatus(false, CONNECTION_TEXT.loginRefused);
      return;
    }
    this.failures += 1;
    const wasConnected = this.phase === 'connected';
    this.phase = 'unreachable';
    this.issues.fail(
      'tractive',
      `Tractive refresh failed (${err.message})`,
      wasConnected ? 'warn' : 'error',
    );
    await this.setConnectionStatus(false, CONNECTION_TEXT.unreachable);
  }

  /** The core's onPoll (fallback): refresh unless the timer just did. */
  async poll(device) {
    if (!this.petByDevice(device)) {
      logger.debug(`onPoll ignored for ${device.external_id}`);
      return;
    }
    if (this.lastRefreshAt !== null && this.now() - this.lastRefreshAt < this.periodMs() * 0.9) {
      logger.debug('onPoll skipped: refreshed recently');
      return;
    }
    await this.refresh();
  }

  /** A device was added (or updated) in Gladys: read it and send its states now. */
  async onDeviceCreated(device) {
    const pet = this.petByDevice(device);
    if (!pet) {
      return;
    }
    // The SDK forgot what was published for it; Gladys dropped the states sent
    // before the device existed.
    await this.refresh({ petIds: [pet.petId] });
    await this.publishAll([pet]);
    this.requestWidgetRefresh();
  }

  async rediscover() {
    if (!this.client || this.phase === 'login_refused' || this.stopped) {
      await this.publishDiscovered();
      return;
    }
    this.discovered = false;
    await this.refresh({ force: true });
  }

  pause() {
    const ms = this.timings.petDelayMs;
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  // --- Real-time channel -----------------------------------------------------

  startChannel() {
    const channel = new TractiveChannel({
      client: this.client,
      fetch: this.fetch,
      timings: this.channelTimings,
      now: this.now,
      onEvent: (event) => {
        this.handleEvent(event).catch((err) =>
          logger.error(`Channel event failed (${err.message})`),
        );
      },
      onConnected: () => {
        if (!this.issues.recover('channel', 'Tractive real-time updates are back')) {
          logger.debug('Tractive real-time channel connected');
        }
      },
      onError: (err) =>
        this.issues.fail(
          'channel',
          `Tractive real-time updates lost (${err.message}): the states refresh every ${this.config.refresh_minutes} min until they are back`,
        ),
      onStopped: (err) => {
        // Given up on a refused token: the next REST cycle logs in again if
        // needed (or reports refused credentials) and reopens it. Never at
        // once: a channel refused for good would turn into a request loop.
        this.issues.fail('channel', `Tractive real-time updates stopped (${err.message})`);
        if (this.channel === channel) {
          this.channel = null;
        }
      },
    });
    this.channel = channel;
    channel.start();
  }

  async handleEvent(event) {
    if (event.message === 'health_overview') {
      const data = event.content && typeof event.content === 'object' ? event.content : event;
      const pet = this.pets.get(String(data.petId));
      if (!pet) return;
      applyHealthOverview(pet, data);
      logger.debug(`Activity update for ${pet.name}`);
      await this.publishPet(pet);
      return;
    }
    const petId = this.trackerToPet.get(String(event.tracker_id));
    if (!petId) {
      return;
    }
    const pet = this.pets.get(petId);
    applyTrackerEvent(pet, event);
    logger.debug(`Tracker update for ${pet.name}`);
    await this.publishPet(pet);
  }

  // --- Presence and triggers -------------------------------------------------

  /** Update the distance and "at home" of a pet; returns the transition, if any. */
  updatePresence(pet) {
    const previous = this.presence.get(pet.petId) ?? { distance: null, atHome: null };
    if (!this.home || pet.latitude === null || pet.longitude === null) {
      this.presence.set(pet.petId, { distance: null, atHome: null });
      return null;
    }
    const distance = distanceMeters(
      this.home.latitude,
      this.home.longitude,
      pet.latitude,
      pet.longitude,
    );
    const atHome = nextAtHome(previous.atHome, distance, pet.accuracy, this.config.home_radius);
    this.presence.set(pet.petId, { distance, atHome });
    if (previous.atHome === null || atHome === previous.atHome) {
      return null;
    }
    return atHome ? TRIGGERS.CAME_HOME : TRIGGERS.LEFT_HOME;
  }

  recomputePresence() {
    for (const pet of this.pets.values()) {
      this.updatePresence(pet);
    }
  }

  /** True when the low-battery alert must fire now (once per crossing). */
  updateBattery(pet) {
    if (!Number.isFinite(pet.battery)) {
      return false;
    }
    const threshold = this.config.battery_low_threshold;
    const armed = this.batteryArmed.get(pet.petId);
    if (armed === undefined) {
      // First value: no crossing observed, no alert.
      this.batteryArmed.set(pet.petId, pet.battery >= threshold);
      return false;
    }
    if (armed && pet.battery < threshold && pet.charging !== true) {
      this.batteryArmed.set(pet.petId, false);
      return true;
    }
    if (!armed && pet.battery >= threshold + BATTERY_REARM_MARGIN) {
      this.batteryArmed.set(pet.petId, true);
    }
    return false;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      logger.debug(`Scene trigger ${key} fired for ${data.pet_name}`);
    } catch (err) {
      logger.warn(`Scene trigger ${key} not delivered (${err.message})`);
    }
  }

  // --- Publication -----------------------------------------------------------

  /** The pets whose device the user added to Gladys. */
  createdPets() {
    const created = new Set((this.gladys.devices ?? []).map((device) => device.external_id));
    return [...this.pets.values()].filter((pet) =>
      created.has(deviceIds(this.gladys, pet.petId).device),
    );
  }

  isCreated(pet) {
    const id = deviceIds(this.gladys, pet.petId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  petByDevice(device) {
    return [...this.pets.values()].find(
      (pet) => deviceIds(this.gladys, pet.petId).device === device?.external_id,
    );
  }

  async publishDiscovered() {
    const devices = [...this.pets.values()].map((pet) =>
      buildDevice(this.gladys, pet, this.config.language),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.issues.recover('discovery', 'The pets are published in the Discovery tab again');
    } catch (err) {
      this.issues.fail('discovery', `The pets cannot be published in Gladys (${err.message})`);
    }
  }

  /** Presence, triggers and states of one pet (after a channel event). */
  async publishPet(pet) {
    const transition = this.updatePresence(pet);
    const batteryLow = this.updateBattery(pet);
    if (!this.isCreated(pet)) {
      return;
    }
    const changed = await this.publishStates(
      buildStates(this.gladys, pet, this.presence.get(pet.petId)),
    );
    const device = deviceIds(this.gladys, pet.petId).device;
    if (transition) {
      const { distance } = this.presence.get(pet.petId);
      await this.fire(transition, { device, pet_name: pet.name, distance: Math.round(distance) });
    }
    if (batteryLow) {
      await this.fire(TRIGGERS.BATTERY_LOW, { device, pet_name: pet.name, battery: pet.battery });
    }
    if (changed > 0) {
      this.requestWidgetRefresh();
    }
  }

  /** Publish the states of the given pets (default: every added pet). */
  async publishAll(pets = this.createdPets()) {
    const created = pets.filter((pet) => this.isCreated(pet));
    let changed = 0;
    for (const pet of created) {
      const transition = this.updatePresence(pet);
      const batteryLow = this.updateBattery(pet);
      changed += await this.publishStates(
        buildStates(this.gladys, pet, this.presence.get(pet.petId)),
      );
      const device = deviceIds(this.gladys, pet.petId).device;
      if (transition) {
        const { distance } = this.presence.get(pet.petId);
        await this.fire(transition, { device, pet_name: pet.name, distance: Math.round(distance) });
      }
      if (batteryLow) {
        await this.fire(TRIGGERS.BATTERY_LOW, { device, pet_name: pet.name, battery: pet.battery });
      }
    }
    if (changed > 0) {
      this.requestWidgetRefresh();
    }
  }

  /** @returns {Promise<number>} the number of states really sent */
  async publishStates(states) {
    if (states.length === 0 || this.gladys.connected === false) {
      return 0;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      this.issues.recover('publish', 'The states reach Gladys again');
      return count ?? 0;
    } catch (err) {
      this.issues.fail('publish', `The states cannot be sent to Gladys (${err.message})`);
      return 0;
    }
  }

  /** Nudge the open dashboards, at most once per 10 s (the core drops more). */
  requestWidgetRefresh() {
    if (this.stopped) {
      return;
    }
    const send = () => {
      this.widgetTimer = null;
      this.widgetPending = false;
      this.lastWidgetRefreshAt = this.now();
      try {
        this.gladys.requestWidgetRefresh(WIDGET_KEY);
      } catch (err) {
        logger.debug(`Widget refresh not sent (${err.message})`);
      }
    };
    const since =
      this.lastWidgetRefreshAt === null ? Infinity : this.now() - this.lastWidgetRefreshAt;
    if (since >= this.timings.widgetRefreshMs && !this.widgetTimer) {
      send();
      return;
    }
    if (!this.widgetTimer && this.useTimers) {
      this.widgetPending = true;
      this.widgetTimer = setTimeout(send, Math.max(0, this.timings.widgetRefreshMs - since));
    }
  }

  async setConnectionStatus(connected, message) {
    try {
      await this.gladys.setConnectionStatus(connected, message);
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  // --- Commands --------------------------------------------------------------

  /**
   * Turn a tracker function on or off (a switch feature, a widget button).
   * @param {object} pet
   * @param {'buzzer'|'led'|'live_tracking'} key
   * @param {boolean} on
   * @throws {Error} a message for the user, in the configured language
   */
  async command(pet, key, on) {
    const text = messagesFor(this.config.language);
    if (!this.client || this.phase !== 'connected') {
      throw new Error(text.notConnected);
    }
    if (!featureKeys(pet).includes(key)) {
      throw new Error(text.unsupported);
    }
    if (on && pet.powerSavingZone) {
      // Home Assistant marks these switches unavailable in the power saving
      // zone: the tracker sleeps on the home Wi-Fi and does not take them.
      throw new Error(text.powerSaving);
    }
    let answer;
    try {
      answer = await this.client.command(pet.trackerId, SWITCH_COMMANDS[key], on);
    } catch (err) {
      logger.warn(`${key} ${on ? 'on' : 'off'} for ${pet.name} refused (${err.message})`);
      if (err.kind === ERROR_KINDS.FORBIDDEN) {
        throw new Error(text.forbidden, { cause: err });
      }
      if (err.kind === ERROR_KINDS.NOT_FOUND) {
        throw new Error(text.unknownPet, { cause: err });
      }
      throw new Error(text.failed(err.status ? `HTTP ${err.status}` : err.message), {
        cause: err,
      });
    }
    logger.info(`${key} ${on ? 'on' : 'off'} for ${pet.name}`);
    if (answer?.pending !== false) {
      // Accepted: show it now, the channel confirms (or corrects) shortly.
      const field = key === 'live_tracking' ? 'liveTracking' : key;
      pet[field] = on;
      await this.publishPet(pet);
    }
  }

  /** onSetValue: a switch of a pet device. */
  async setValue(device, feature, value) {
    const pet = this.petByDevice(device);
    if (!pet) {
      throw new Error(messagesFor(this.config.language).unknownPet);
    }
    const key = Object.keys(SWITCH_COMMANDS).find(
      (candidate) => deviceIds(this.gladys, pet.petId).feature(candidate) === feature.external_id,
    );
    if (!key) {
      throw new Error(messagesFor(this.config.language).unsupported);
    }
    await this.command(pet, key, Number(value) === 1);
  }

  // --- Report ----------------------------------------------------------------

  /** The "Test the connection" report, in every language. */
  async testConnection() {
    const config = this.config;
    if (!hasCredentials(config)) {
      return CONNECTION_TEXT.noCredentials;
    }
    if (this.phase !== 'connected') {
      // Try now (a refused login is retried only from this button or a new config).
      await this.start(config);
    } else {
      await this.rediscover();
    }
    if (this.phase === 'login_refused') {
      return CONNECTION_TEXT.loginRefused;
    }
    if (this.phase !== 'connected') {
      return CONNECTION_TEXT.unreachable;
    }
    const pets = [...this.pets.values()];
    const parts = [
      pets.length === 0
        ? allLanguages('testNoPets')
        : allLanguages('testOk', pets.length, pets.map((pet) => pet.name).join(', ')),
    ];
    if (this.useChannel) {
      parts.push(allLanguages(this.channel?.connected ? 'channelUp' : 'channelDown'));
    }
    if (!this.home) {
      parts.push(allLanguages('noHouse'));
    }
    return Object.fromEntries(
      Object.keys(parts[0]).map((language) => [
        language,
        parts.map((part) => part[language]).join(' '),
      ]),
    );
  }
}
