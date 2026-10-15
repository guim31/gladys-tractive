// -----------------------------------------------------------------------------
// The pet status, merged from REST and channel messages: the cases of
// aiotractive's own tests (tests/test_tractive.py), on its payloads.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyHardwareReport,
  applyHealthOverview,
  applyPositionReport,
  applyTrackerEvent,
  createPetStatus,
  isOnline,
} from '../src/tractive/status.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/tractive/${name}.json`, import.meta.url), 'utf8'));

// aiotractive's FULL_EVENT.
const FULL_EVENT = {
  message: 'tracker_status',
  tracker_id: 'TRDOG001',
  tracker_state: 'NOT_REPORTING',
  tracker_state_reason: 'POWER_SAVING',
  charging_state: 'CHARGING',
  hardware: { time: 1, battery_level: 80, power_saving_zone_id: 'zone' },
  position: { time: 1, latlong: [1.5, 2.5], accuracy: 10, sensor_used: 'GPS' },
  buzzer_control: { active: true },
  led_control: { active: false },
  live_tracking: { active: true },
};

const dog = () => createPetStatus(fixture('trackable_object_dog'), fixture('tracker_dog'));

test('a pet from its REST details', () => {
  const pet = dog();
  assert.equal(pet.petId, 'PETDOG01');
  assert.equal(pet.trackerId, 'TRDOG001');
  assert.equal(pet.name, 'Rex');
  assert.equal(pet.trackerState, 'operational');
  assert.equal(pet.charging, false);
  assert.equal(pet.powerSaving, false);
  assert.equal(pet.reportsCharging, true);
  assert.ok(pet.capabilities.has('LED'));
  assert.equal(isOnline(pet), true);

  const cat = createPetStatus(fixture('trackable_object_cat'), fixture('tracker_cat'));
  assert.equal(cat.reportsCharging, false);
  assert.equal(cat.charging, null);
  assert.equal(cat.powerSaving, true);
});

test('the REST reports: battery, power saving zone, position, activity', () => {
  const pet = dog();
  applyHardwareReport(pet, fixture('hw_report_cat'));
  assert.equal(pet.battery, 41);
  assert.equal(pet.powerSavingZone, true);
  applyPositionReport(pet, fixture('pos_report_dog'));
  assert.deepEqual([pet.latitude, pet.longitude, pet.accuracy], [48.85695, 2.3522, 30]);
  assert.equal(pet.sensorUsed, 'KNOWN_WIFI');
  applyHealthOverview(pet, fixture('health_overview_dog'));
  assert.deepEqual([pet.activityMinutes, pet.activityGoal, pet.restMinutes], [150, 200, 122]);
  // Without sleep data, the rest is unknown, not zero.
  applyHealthOverview(pet, fixture('health_overview_cat'));
  assert.equal(pet.restMinutes, null);
});

test('a full tracker event updates every field (aiotractive FULL_EVENT)', () => {
  const pet = dog();
  applyTrackerEvent(pet, FULL_EVENT);
  assert.equal(pet.battery, 80);
  assert.equal(pet.trackerState, 'not_reporting');
  assert.equal(isOnline(pet), false);
  assert.equal(pet.charging, true);
  assert.equal(pet.powerSaving, true);
  assert.equal(pet.powerSavingZone, true);
  assert.deepEqual(
    [pet.latitude, pet.longitude, pet.accuracy, pet.sensorUsed],
    [1.5, 2.5, 10, 'GPS'],
  );
  assert.deepEqual([pet.buzzer, pet.led, pet.liveTracking], [true, false, true]);
});

test('an event only overwrites what it carries', () => {
  const pet = dog();
  applyTrackerEvent(pet, FULL_EVENT);
  const before = { ...pet };
  applyTrackerEvent(pet, { tracker_id: 'TRDOG001' });
  applyTrackerEvent(pet, { message: 'tracker_status' });
  assert.deepEqual(pet, before);
});

test('an explicit state without a reason clears power saving', () => {
  const pet = dog();
  applyTrackerEvent(pet, {
    tracker_state: 'OPERATIONAL',
    tracker_state_reason: 'POWER_SAVING',
    hardware: { time: 1758615993, battery_level: 98, power_saving_zone_id: 'zone' },
  });
  assert.equal(pet.powerSaving, true);
  assert.equal(pet.powerSavingZone, true);
  applyTrackerEvent(pet, {
    tracker_state: 'OPERATIONAL',
    hardware: { time: 1758645110, battery_level: 97, power_saving_zone_id: null },
  });
  assert.equal(pet.battery, 97);
  assert.equal(pet.powerSaving, false);
  assert.equal(pet.powerSavingZone, false);
});

test('an older hardware or position report is ignored', () => {
  const pet = dog();
  applyTrackerEvent(pet, {
    hardware: { time: 200, battery_level: 50 },
    position: { time: 200, latlong: [1, 1] },
  });
  applyTrackerEvent(pet, {
    hardware: { time: 100, battery_level: 90 },
    position: { time: 100, latlong: [2, 2] },
  });
  applyHardwareReport(pet, { time: 150, battery_level: 70 });
  assert.equal(pet.battery, 50);
  assert.deepEqual([pet.latitude, pet.longitude], [1, 1]);
});

test('a buzzer or LED with no time remaining is off; live tracking keeps its value', () => {
  const pet = dog();
  applyTrackerEvent(pet, {
    buzzer_control: { active: true, remaining: 0 },
    led_control: { active: true, remaining: 12 },
    live_tracking: { active: true, remaining: 0 },
  });
  assert.deepEqual([pet.buzzer, pet.led, pet.liveTracking], [false, true, true]);
});

test('a malformed position is ignored', () => {
  const pet = dog();
  applyTrackerEvent(pet, { position: { time: 5, latlong: [1] } });
  applyTrackerEvent(pet, { position: { time: 6, latlong: ['a', 'b'] } });
  assert.equal(pet.latitude, null);
});

test('online unknown before any state', () => {
  const pet = createPetStatus(fixture('trackable_object_dog'), { _id: 'X' });
  assert.equal(isOnline(pet), null);
});
