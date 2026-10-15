# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the e-mail address and password of the Tractive account live in
  the Gladys configuration (the password in a `secret` field, never sent back
  to the browser). The integration never writes the password to disk and never
  logs it, nor the e-mail address, nor the token.
- **`/data`**: `tractive-token.json`, the Tractive session token (user id,
  access token, expiry), bound to a hash of the e-mail address and readable by
  the container user only. Deleting it only forces a new login.
- **Network**: outbound HTTPS only, to `graph.tractive.com`,
  `aps-api.tractive.com` and `channel.tractive.com`. No port is opened.
- **Location**: the integration reads the coordinates of the Gladys houses
  (`location: true`) to compute distances; positions of the pets stay in
  memory and are never logged nor stored in Gladys, only the distance is.
- **Commands**: live tracking, buzzer and light only. Nothing opens, unlocks
  or disarms anything.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Tractive's services and trackers.
