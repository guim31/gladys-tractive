// -----------------------------------------------------------------------------
// A simulated Tractive cloud behind a `fetch` function: the REST answers come
// from test/fixtures/tractive (real answers, anonymized), the real-time
// channel is a stream the tests write to. It checks what the real API checks
// (the client header, the login, the bearer token) and records every request.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/tractive/${name}.json`, import.meta.url), 'utf8'));

export const EMAIL = 'pet.owner@example.com';
export const PASSWORD = 'correct horse battery staple';
export const HOME = { latitude: 48.8566, longitude: 2.3522 };

export const PETS = {
  dog: { petId: 'PETDOG01', trackerId: 'TRDOG001', name: 'Rex' },
  cat: { petId: 'PETCAT02', trackerId: 'TRCAT002', name: 'Mia' },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Every REST answer, by pet; tests may change them between cycles. */
export function defaultData() {
  return {
    auth: fixture('auth_response'),
    trackableObjects: fixture('trackable_objects'),
    objects: {
      PETDOG01: fixture('trackable_object_dog'),
      PETCAT02: fixture('trackable_object_cat'),
      PETSHR03: fixture('trackable_object_shared'),
      PETNOT04: fixture('trackable_object_no_tracker'),
    },
    trackers: { TRDOG001: fixture('tracker_dog'), TRCAT002: fixture('tracker_cat') },
    hardware: { TRDOG001: fixture('hw_report_dog'), TRCAT002: fixture('hw_report_cat') },
    positions: { TRDOG001: fixture('pos_report_dog'), TRCAT002: fixture('pos_report_cat') },
    health: { PETDOG01: fixture('health_overview_dog'), PETCAT02: fixture('health_overview_cat') },
  };
}

export const trackerStatusEvent = () => fixture('tracker_status_event');

/**
 * @param {object} [options]
 * @param {string} [options.password] the password Tractive accepts
 */
export function createFakeTractive({ password = PASSWORD } = {}) {
  const data = defaultData();
  const requests = [];
  const tokens = new Set();
  let tokenCounter = 0;
  /** Forced answers: path regexp → status (or function returning a Response). */
  const overrides = [];
  /** Open channel streams. */
  const channels = [];
  let channelStatus = 200;
  /** Set to false to make every request fail like a network error. */
  let online = true;

  const fake = {
    data,
    requests,
    channels,
    /** Answer `status` (or call `respond`) for the requests matching `pattern`, `times` times. */
    override(pattern, respond, times = Infinity) {
      overrides.push({ pattern, respond, times });
    },
    clearOverrides() {
      overrides.length = 0;
    },
    setOnline(value) {
      online = value;
    },
    setChannelStatus(status) {
      channelStatus = status;
    },
    /** Revoke every token issued so far. */
    revokeTokens() {
      tokens.clear();
    },
    /** Count of the requests whose path matches. */
    count(pattern) {
      return requests.filter((request) => pattern.test(request.path)).length;
    },
    /** The open channel the integration listens to (the last one). */
    get channel() {
      return channels.filter((channel) => !channel.closed).at(-1);
    },
    fetch,
  };

  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const path = `${url.host}${url.pathname}`;
    requests.push({ method, path, headers, body: init.body });
    if (!online) {
      throw new TypeError('fetch failed');
    }
    if (headers['x-tractive-client'] !== '625e533dc3c3b41c28a669f0') {
      return json({ message: 'unknown client' }, 400);
    }
    for (const override of overrides) {
      if (override.times > 0 && override.pattern.test(path)) {
        override.times -= 1;
        return typeof override.respond === 'function'
          ? override.respond({ path, method, headers })
          : json({ message: 'forced' }, override.respond);
      }
    }

    if (path === 'graph.tractive.com/4/auth/token' && method === 'POST') {
      const body = JSON.parse(init.body);
      if (body.platform_token !== password || body.grant_type !== 'tractive') {
        return json({ code: 4002, message: 'Invalid credentials' }, 401);
      }
      tokenCounter += 1;
      const token = `${data.auth.access_token}-${tokenCounter}`;
      tokens.add(token);
      return json({ ...data.auth, access_token: token });
    }

    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (!tokens.has(token) || headers['x-tractive-user'] !== data.auth.user_id) {
      return json({ message: 'unauthorized' }, 401);
    }

    if (path === 'channel.tractive.com/3/channel' && method === 'POST') {
      if (channelStatus !== 200) {
        return json({ message: 'channel refused' }, channelStatus);
      }
      return openChannel(init.signal);
    }

    let match;
    if ((match = path.match(/^graph\.tractive\.com\/4\/user\/([^/]+)\/trackable_objects$/))) {
      return match[1] === data.auth.user_id ? json(data.trackableObjects) : json({}, 403);
    }
    if ((match = path.match(/^graph\.tractive\.com\/4\/trackable_object\/([^/]+)$/))) {
      return data.objects[match[1]] ? json(data.objects[match[1]]) : json({}, 404);
    }
    if ((match = path.match(/^graph\.tractive\.com\/4\/tracker\/([^/]+)$/))) {
      return data.trackers[match[1]] ? json(data.trackers[match[1]]) : json({}, 404);
    }
    if ((match = path.match(/^graph\.tractive\.com\/4\/device_hw_report\/([^/]+)\/$/))) {
      return json(data.hardware[match[1]] ?? {});
    }
    if ((match = path.match(/^graph\.tractive\.com\/4\/device_pos_report\/([^/]+)$/))) {
      return json(data.positions[match[1]] ?? {});
    }
    if ((match = path.match(/^aps-api\.tractive\.com\/api\/1\/pet\/([^/]+)\/health\/overview$/))) {
      return data.health[match[1]] ? json(data.health[match[1]]) : json({ message: 'none' }, 400);
    }
    if (
      (match = path.match(
        /^graph\.tractive\.com\/4\/tracker\/([^/]+)\/command\/(buzzer_control|led_control|live_tracking)\/(on|off)$/,
      ))
    ) {
      return data.trackers[match[1]] ? json({ pending: true }) : json({}, 404);
    }
    return json({ message: `no route for ${path}` }, 404);
  }

  function openChannel(signal) {
    const encoder = new TextEncoder();
    const channel = { closed: false, controller: null };
    const stream = new ReadableStream({
      start(controller) {
        channel.controller = controller;
      },
      cancel() {
        channel.closed = true;
      },
    });
    channel.push = (message) => {
      if (!channel.closed) {
        channel.controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      }
    };
    channel.pushRaw = (text) => {
      if (!channel.closed) {
        channel.controller.enqueue(encoder.encode(text));
      }
    };
    channel.close = () => {
      if (!channel.closed) {
        channel.closed = true;
        channel.controller.close();
      }
    };
    channel.fail = (message = 'socket hang up') => {
      if (!channel.closed) {
        channel.closed = true;
        channel.controller.error(new TypeError(message));
      }
    };
    signal?.addEventListener('abort', () => {
      if (!channel.closed) {
        channel.closed = true;
        channel.controller.error(new DOMException('aborted', 'AbortError'));
      }
    });
    channels.push(channel);
    return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
  }

  return fake;
}
