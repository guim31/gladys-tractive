# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Tractive GPS trackers for dogs and cats, through the Tractive account
  (e-mail address and password): one device per pet with a tracker.
- Battery, charging, distance from a chosen Gladys house, position accuracy,
  at home (configurable radius, with a margin against GPS jitter), tracker
  online, power saving, activity and rest of the day, daily activity goal.
- Live tracking, buzzer and light (LED) switches, with a clear message when the
  tracker is in its power saving zone or the subscription refuses.
- Real-time updates through the Tractive event stream, and a full refresh every
  15 minutes (5 to 60) on the integration's own timer.
- Scene triggers "Pet left home", "Pet came home" and "Tractive battery low".
- Dashboard widget "Tractive pet": distance, battery, activity, at home,
  tracker state, buzzer and light buttons.
- "Test the connection" action.
- Feature names, messages and documentation in English, French, German and
  Spanish.

[Unreleased]: https://github.com/guim31/gladys-tractive/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-tractive/releases/tag/v1.0.1
