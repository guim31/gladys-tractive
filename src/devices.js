// -----------------------------------------------------------------------------
// One Gladys device per pet with a tracker, and the states of its features.
//
// The device is keyed on the pet (Tractive's trackable object id), not on the
// tracker: a pet keeps its history and its scenes when its tracker is
// replaced. The features depend on what the tracker can do (its Tractive
// "capabilities"), never on the configuration, so the structure stays stable.
//
// Couples and bounds follow the Gladys core (test/gladys-rules.test.js):
// every feature has numeric min/max, the switches are the only writable ones.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { NAMES } from './i18n.js';
import { isOnline } from './tractive/status.js';

export const DEVICE_TYPE = 'pet';

// Half the circumference of the Earth: no pet is farther from home.
const MAX_DISTANCE_M = 20_040_000;
const MAX_ACCURACY_M = 100_000;
const MINUTES_PER_DAY = 1440;

const sensor = { read_only: true, has_feedback: false };
const control = { read_only: false, has_feedback: true, min: 0, max: 1 };

/**
 * Feature definitions, by key (the key is part of the external id: frozen).
 * `when` tells whether the tracker has the feature.
 */
export const FEATURES = [
  {
    key: 'battery',
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    ...sensor,
  },
  {
    key: 'charging',
    category: C.BATTERY,
    type: T.BATTERY.CHARGING,
    min: 0,
    max: 1,
    ...sensor,
    when: (pet) => pet.reportsCharging,
  },
  {
    key: 'distance',
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.M,
    min: 0,
    max: MAX_DISTANCE_M,
    ...sensor,
  },
  {
    key: 'accuracy',
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.M,
    min: 0,
    max: MAX_ACCURACY_M,
    ...sensor,
  },
  {
    key: 'at_home',
    category: C.PRESENCE_SENSOR,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    ...sensor,
  },
  { key: 'online', category: C.INPUT, type: T.INPUT.BINARY, min: 0, max: 1, ...sensor },
  { key: 'power_saving', category: C.INPUT, type: T.INPUT.BINARY, min: 0, max: 1, ...sensor },
  {
    key: 'activity',
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: MINUTES_PER_DAY,
    ...sensor,
    when: (pet) => pet.capabilities.has('ACTIVITY_TRACKING'),
  },
  {
    key: 'activity_goal',
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: MINUTES_PER_DAY,
    ...sensor,
    when: (pet) => pet.capabilities.has('ACTIVITY_TRACKING'),
  },
  {
    key: 'rest',
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: MINUTES_PER_DAY,
    ...sensor,
    when: (pet) => pet.capabilities.has('SLEEP_TRACKING'),
  },
  {
    key: 'live_tracking',
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    ...control,
    when: (pet) => pet.capabilities.has('LT'),
  },
  {
    key: 'buzzer',
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    ...control,
    when: (pet) => pet.capabilities.has('BUZZER'),
  },
  {
    key: 'led',
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    ...control,
    when: (pet) => pet.capabilities.has('LED'),
  },
];

/** The commands a switch feature sends (client.command). */
export const SWITCH_COMMANDS = { live_tracking: 'live_tracking', buzzer: 'buzzer', led: 'led' };

export const deviceIds = (gladys, petId) => gladys.externalIds(DEVICE_TYPE, petId);

/** The feature keys a pet's tracker has. */
export const featureKeys = (pet) =>
  FEATURES.filter((feature) => !feature.when || feature.when(pet)).map((feature) => feature.key);

/**
 * The Gladys device of a pet.
 * @param {object} gladys GladysIntegration
 * @param {object} pet status from tractive/status.js
 * @param {string} language feature names language
 */
export function buildDevice(gladys, pet, language) {
  const ids = deviceIds(gladys, pet.petId);
  const names = NAMES[language] ?? NAMES.fr;
  const keys = new Set(featureKeys(pet));
  const params = [
    { name: 'tracker_model', value: pet.model ?? '' },
    { name: 'tracker_firmware', value: pet.firmware ?? '' },
  ].filter((param) => param.value !== '');
  return {
    name: pet.name,
    external_id: ids.device,
    // States are pushed by the container (channel + its own refresh timer):
    // the Gladys scheduler is not relied on (GladysAssistant/Gladys#3198).
    should_poll: false,
    params,
    features: FEATURES.filter((feature) => keys.has(feature.key)).map((feature) => {
      // eslint-disable-next-line no-unused-vars
      const { key, when, ...definition } = feature;
      return {
        ...definition,
        name: names[key],
        external_id: ids.feature(key),
        keep_history: true,
      };
    }),
  };
}

/**
 * The states of a pet's features that are known now.
 * @param {object} gladys
 * @param {object} pet status
 * @param {object} presence `{ distance, atHome }` from the hub (null values when unknown)
 * @returns {{ device_feature_external_id: string, state: number }[]}
 */
export function buildStates(gladys, pet, presence) {
  const ids = deviceIds(gladys, pet.petId);
  const keys = new Set(featureKeys(pet));
  const bool = (value) => (value === null || value === undefined ? null : value ? 1 : 0);
  const values = {
    battery: pet.battery,
    charging: bool(pet.charging),
    distance: presence.distance === null ? null : Math.round(presence.distance),
    accuracy: pet.accuracy === null ? null : Math.round(pet.accuracy),
    at_home: bool(presence.atHome),
    online: bool(isOnline(pet)),
    power_saving: bool(pet.powerSaving),
    activity: pet.activityMinutes,
    activity_goal: pet.activityGoal,
    rest: pet.restMinutes,
    live_tracking: bool(pet.liveTracking),
    buzzer: bool(pet.buzzer),
    led: bool(pet.led),
  };
  return Object.entries(values)
    .filter(([key, value]) => keys.has(key) && Number.isFinite(value))
    .map(([key, value]) => ({ device_feature_external_id: ids.feature(key), state: value }));
}
