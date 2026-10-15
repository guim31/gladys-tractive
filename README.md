# Tractive for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that follows [Tractive](https://tractive.com) GPS trackers for dogs and cats:
at home or not, distance from home, battery, activity of the day, and the
buzzer and the light to find the pet. It uses the cloud API of the Tractive
app (`graph.tractive.com`) and its real-time event stream, like the Home
Assistant `tractive` integration.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against recorded answers of the Tractive API (from the
> aiotractive and Home Assistant test suites, anonymized), not against a real
> tracker or account. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-tractive/issues).

## Features

- **One device per pet** with a tracker: battery, charging, distance from home,
  position accuracy, at home, tracker online, power saving, activity and rest
  of the day, daily activity goal. The features follow the tracker's
  capabilities (no light feature on a tracker without LED).
- **Commands**: live tracking, buzzer and light (LED), with a clear message
  when the tracker sleeps in its power saving zone or the subscription does not
  allow the function. Nothing opens, unlocks or disarms anything.
- **Real time**: battery, positions and switches arrive through the Tractive
  event stream (`channel.tractive.com`); a full refresh runs every 15 minutes
  (5 to 60) on the container's own timer.
- **Distance and presence computed locally**: Gladys has no feature for a
  latitude/longitude, so the integration computes the distance to a Gladys
  house of your choice and "at home" (configurable radius, hysteresis, imprecise
  fixes ignored). The position itself is never stored in Gladys.
- **Scene triggers**: _Pet left home_, _Pet came home_, _Tractive battery low_
  (once per crossing, not while charging), with the pet's name, the distance or
  the battery as variables.
- **Dashboard widget** "Tractive pet": distance, battery, activity against the
  goal, at home, position age, tracker state, and buzzer and light buttons.
- **Test the connection** action, feature names and messages in English,
  French, German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (house picker in the configuration).
- A Tractive tracker with an active subscription, and the e-mail address and
  password of its Tractive account (an account opened with Apple or Google
  needs a password set in the Tractive app).
- A Gladys house with a location, for the distance and "at home".
- Internet access from Gladys.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-tractive` (or install **Tractive** from
   the catalog once it is listed). The install screen asks to read the location
   of your houses.
2. In **Configuration**, enter the e-mail address and password of your
   Tractive account, choose the house and the home radius, save, then press
   **Test the connection**.
3. Open the **Discovery** tab and add your pets.

The user guide is in [`docs/en.md`](docs/en.md) (also
[French](docs/fr.md), [German](docs/de.md), [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Login**: `POST /4/auth/token` with the account credentials, as aiotractive
  does. The token is kept in `/data/tractive-token.json` (bound to a hash of the
  e-mail address, never the password) and reused across restarts until an hour
  before it expires. A refused password is not retried until the configuration
  changes or the connection test is pressed.
- **Pets**: `user/<id>/trackable_objects`, then each pet and its tracker.
  Shared trackers (no details) and pets without a tracker are skipped. The
  device is keyed on the pet id, so a replaced tracker keeps the history.
- **States**: the event stream first; the REST refresh (tracker, hardware
  report, position report, health overview) reads only the pets added to
  Gladys, one request at a time, 2 s between pets, 429 retried after 8 s then up
  to 60 s. Only changed values are published, with a 6-hour heartbeat. The
  devices use `should_poll: false` (GladysAssistant/Gladys#3198); `onPoll` stays
  as a fallback.
- **Logs**: one line per lifecycle event or user action at info; every update
  at debug (`LOG_LEVEL=debug`). No password, token, e-mail address or position
  is ever logged.

## Limitations

- Developed without the hardware (see above).
- The Tractive API is not public: Tractive may change it without notice.
- No map in Gladys, only the distance to one house; one Tractive account per
  Gladys.
- Switch states (buzzer, light, live tracking) are only known once the event
  stream reports them.
- Geofences, history and health alerts of the Tractive app are not available.
- The client id is the aiotractive library's default (the Home Assistant one is
  reserved to Home Assistant).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: fake Gladys (SDK) + simulated Tractive cloud
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node scripts/probe.mjs                           # real API, fake account, read-only
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/app.js                handlers: discovery, commands, poll fallback, action, widget
src/hub.js                session, refresh timer, channel, presence, triggers, commands
src/devices.js            one Gladys device per pet, its features and states
src/geo.js                distance to the house, "at home" with hysteresis
src/tractive/client.js    REST client (login, token, 429 backoff, endpoints)
src/tractive/channel.js   real-time event stream (keep-alive, reconnection)
src/tractive/status.js    pet status merged from REST and events
src/tokenStore.js         the token in /data
src/widgets.js            "Tractive pet" dashboard widget
src/i18n.js               feature names and messages in four languages
scripts/probe.mjs         read-only probe of the real API
test/                     node --test; test/fixtures/tractive: recorded answers
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [aiotractive](https://github.com/zhulik/aiotractive) by Gleb Sinyavskiy and
  contributors (MIT): the API endpoints, the login, the event stream handling
  and the status rules are ported from it, and the test fixtures come from its
  test suite (anonymized).
- Home Assistant's
  [`tractive`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/tractive)
  integration (Apache-2.0): which entities make sense, the switches refused in
  the power saving zone, its test fixtures.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Tractive GmbH.
"Tractive" is a trademark of its owner.

## License

Apache-2.0
