// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, test/manifest.test.js checks it) and normalization,
// so the rest of the code never deals with strings, blanks or out-of-range
// numbers coming from the form.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, for the feature names and messages. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // Selector of the Gladys house the distance is measured from; empty: the
  // first house that has a location.
  house: '',
  home_radius: 100,
  battery_low_threshold: 15,
  refresh_minutes: 15,
  language: 'fr',
};

// Bounds of the numeric fields (same as the manifest): a value typed outside
// is brought back inside rather than refused.
const BOUNDS = {
  home_radius: [20, 5000],
  battery_low_threshold: [5, 50],
  refresh_minutes: [5, 60],
};

function boundedInteger(value, key) {
  const [min, max] = BOUNDS[key];
  // The form may send "100", "100,0" or nothing.
  const number = Number(String(value ?? '').replace(',', '.'));
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) {
    return DEFAULT_CONFIG[key];
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    email: text(raw.email),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    house: text(raw.house),
    home_radius: boundedInteger(raw.home_radius, 'home_radius'),
    battery_low_threshold: boundedInteger(raw.battery_low_threshold, 'battery_low_threshold'),
    refresh_minutes: boundedInteger(raw.refresh_minutes, 'refresh_minutes'),
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language,
  };
}

/** True when the credentials needed to log in are filled in. */
export const hasCredentials = (config) => config.email !== '' && config.password !== '';
