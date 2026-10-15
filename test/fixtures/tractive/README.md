# Tractive API fixtures

Answers of the Tractive API (`graph.tractive.com`, `aps-api.tractive.com`,
`channel.tractive.com`), adapted from the test fixtures of
[aiotractive](https://github.com/zhulik/aiotractive) (MIT, Gleb Sinyavskiy) and
of the Home Assistant `tractive` integration (Apache-2.0). Identifiers, names
and the access token are invented; the positions are placed around a public
landmark used as the test house (48.8566, 2.3522).

- `tracker_dog.json`: a TG4422 tracker with every capability (live tracking,
  buzzer, LED, activity and sleep tracking) and a charging state.
- `tracker_cat.json`: a tracker without LED and sleep tracking, which reports
  no charging state, sleeping in its power saving zone (home Wi-Fi).
- `trackable_object_shared.json`: a tracker shared by another account (no
  details: skipped, like aiotractive does); `trackable_object_no_tracker.json`:
  a pet without a tracker (skipped).
