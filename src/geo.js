// -----------------------------------------------------------------------------
// Distance to the house and "at home", computed in the container: Gladys has
// no device feature for a latitude/longitude, so the position itself is never
// published, only the distance to the chosen Gladys house.
// -----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle distance in meters between two [lat, lon] points (haversine). */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A position less precise than this (a cell-tower fix) never moves the pet in
// or out of the house: it would make a cat asleep on the sofa "leave home".
export const MAX_ACCURACY_FOR_PRESENCE_M = 500;

/** Extra distance needed to count as gone once at home, against GPS jitter. */
export const leaveMargin = (radius) => Math.max(25, Math.round(radius * 0.2));

/**
 * Next "at home" value, with a hysteresis: the pet comes home inside the
 * radius, and leaves beyond the radius plus a margin.
 * @param {boolean|null} previous null when unknown (start, new house)
 * @param {number} distance meters from the house
 * @param {number|null} accuracy meters, null when unknown
 * @param {number} radius meters
 * @returns {boolean|null} null while unknown and not decidable
 */
export function nextAtHome(previous, distance, accuracy, radius) {
  const precise =
    accuracy === null || accuracy === undefined || accuracy <= MAX_ACCURACY_FOR_PRESENCE_M;
  if (previous === null || previous === undefined) {
    // First known position: take it as it is, even imprecise, so the state
    // is not left empty; no scene trigger fires on a first value anyway.
    return distance <= radius;
  }
  if (!precise) {
    return previous;
  }
  if (previous) {
    return distance > radius + leaveMargin(radius) ? false : true;
  }
  return distance <= radius;
}
