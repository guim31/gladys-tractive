// -----------------------------------------------------------------------------
// What the integration knows of each pet, merged from the REST answers and the
// channel events. Pure functions, ported from aiotractive's models (MIT, Gleb
// Sinyavskiy) with the same rules: a payload only overwrites the fields it
// carries, an event older than the last one applied is ignored, and a buzzer
// or LED that timed out on the tracker is off even if Tractive still says
// "active" (it keeps reporting it with no time remaining).
// -----------------------------------------------------------------------------

// Tracker states meaning the tracker does not report any more. Any other state
// (OPERATIONAL, INACCURATE_POSITION, SYSTEM_STARTUP, a future one) is online.
const OFFLINE_STATES = new Set(['not_reporting', 'system_shutdown_user']);

const SWITCH_EVENT_KEYS = {
  buzzer_control: 'buzzer',
  led_control: 'led',
  live_tracking: 'liveTracking',
};

/**
 * A pet with its tracker, from the REST details.
 * @param {object} pet trackable_object answer
 * @param {object} tracker tracker answer
 */
export function createPetStatus(pet, tracker) {
  const status = {
    petId: String(pet._id),
    trackerId: String(pet.device_id),
    name: String(pet.details?.name ?? '').trim() || String(pet.device_id),
    petType: pet.details?.pet_type ?? null,
    model: tracker.model_number ?? null,
    firmware: tracker.fw_version ?? null,
    capabilities: new Set(Array.isArray(tracker.capabilities) ? tracker.capabilities : []),
    // The charging state exists on the trackers that report it (Home
    // Assistant only creates its "charging" entity then).
    reportsCharging: tracker.charging_state !== undefined && tracker.charging_state !== null,
    battery: null,
    charging: null,
    trackerState: null,
    powerSaving: null,
    powerSavingZone: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    sensorUsed: null,
    positionTime: null,
    hardwareTime: null,
    buzzer: null,
    led: null,
    liveTracking: null,
    activityMinutes: null,
    restMinutes: null,
    activityGoal: null,
  };
  applyTrackerDetails(status, tracker);
  return status;
}

/** The tracker answer (state, charging, power saving). */
export function applyTrackerDetails(status, details) {
  if (typeof details.state === 'string') {
    status.trackerState = details.state.toLowerCase();
  }
  if ('charging_state' in details && details.charging_state !== null) {
    status.charging = details.charging_state === 'CHARGING';
  }
  if ('state_reason' in details) {
    status.powerSaving = details.state_reason === 'POWER_SAVING';
  }
  if (Array.isArray(details.capabilities)) {
    status.capabilities = new Set(details.capabilities);
  }
}

/** The REST hardware report (battery, power saving zone). */
export function applyHardwareReport(status, report) {
  if (
    Number.isFinite(report.time) &&
    status.hardwareTime !== null &&
    report.time < status.hardwareTime
  ) {
    return;
  }
  if (Number.isFinite(report.battery_level)) {
    status.battery = report.battery_level;
  }
  if ('power_saving_zone_id' in report) {
    status.powerSavingZone = report.power_saving_zone_id !== null;
  }
  if (Number.isFinite(report.time)) {
    status.hardwareTime = report.time;
  }
}

/** The REST position report. */
export function applyPositionReport(status, report) {
  applyPosition(status, {
    time: report.time,
    latlong: report.latlong,
    accuracy: report.pos_uncertainty,
    sensor_used: report.sensor_used,
  });
}

function applyPosition(status, position) {
  if (
    Number.isFinite(position.time) &&
    status.positionTime !== null &&
    position.time <= status.positionTime
  ) {
    // Same or older fix than the one applied: nothing new.
    return false;
  }
  const latlong = position.latlong;
  if (
    !Array.isArray(latlong) ||
    latlong.length !== 2 ||
    !Number.isFinite(latlong[0]) ||
    !Number.isFinite(latlong[1])
  ) {
    return false;
  }
  [status.latitude, status.longitude] = latlong;
  if ('accuracy' in position) {
    status.accuracy = Number.isFinite(position.accuracy) ? position.accuracy : null;
  }
  if ('sensor_used' in position) {
    status.sensorUsed = position.sensor_used ?? null;
  }
  if (Number.isFinite(position.time)) {
    status.positionTime = position.time;
  }
  return true;
}

/**
 * The activity of the day (REST health overview, or the channel message).
 * A missing block means unknown values, not zero.
 */
export function applyHealthOverview(status, data) {
  const activity = data.activity ?? {};
  const sleep = data.sleep ?? {};
  status.activityGoal = numberOrNull(activity.minutesGoal);
  status.activityMinutes = numberOrNull(activity.minutesActive);
  status.restMinutes = numberOrNull(sleep.minutesCalm);
}

/** A `tracker_status` message of the channel. */
export function applyTrackerEvent(status, event) {
  const hardware = event.hardware;
  if (hardware && typeof hardware === 'object') {
    const time = hardware.time;
    const isNew =
      !Number.isFinite(time) || status.hardwareTime === null || time > status.hardwareTime;
    if (isNew) {
      if (Number.isFinite(hardware.battery_level)) {
        status.battery = hardware.battery_level;
      }
      if (typeof event.tracker_state === 'string') {
        status.trackerState = event.tracker_state.toLowerCase();
      }
      if ('charging_state' in event && event.charging_state !== null) {
        status.charging = event.charging_state === 'CHARGING';
      }
      // An explicit tracker state without a reason clears power saving.
      if (typeof event.tracker_state === 'string' || 'tracker_state_reason' in event) {
        status.powerSaving = event.tracker_state_reason === 'POWER_SAVING';
      }
      if (Number.isFinite(time)) {
        status.hardwareTime = time;
      }
    }
    if ('power_saving_zone_id' in hardware) {
      status.powerSavingZone = hardware.power_saving_zone_id !== null;
    }
  }
  if (event.position && typeof event.position === 'object') {
    applyPosition(status, event.position);
  }
  for (const [eventKey, statusKey] of Object.entries(SWITCH_EVENT_KEYS)) {
    const data = event[eventKey];
    if (!data || typeof data !== 'object' || typeof data.active !== 'boolean') {
      continue;
    }
    let active = data.active;
    if (eventKey !== 'live_tracking' && data.remaining === 0) {
      active = false;
    }
    status[statusKey] = active;
  }
}

/** True / false once the tracker state is known, null before. */
export function isOnline(status) {
  if (status.trackerState === null) {
    return null;
  }
  return !OFFLINE_STATES.has(status.trackerState);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
