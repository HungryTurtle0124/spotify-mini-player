# Spotify Mini Player

An unofficial Chrome toolbar player with background Spotify audio, playlists, queue, shuffle, repeat, and account playback restoration. Version 0.5.0 is a developer preview.

[Download a preview](https://github.com/HungryTurtle0124/spotify-mini-player/releases) · [Install and connect](INSTALL.md) · [Privacy](PRIVACY.md)

## Install

Download the ZIP from [GitHub Releases](https://github.com/HungryTurtle0124/spotify-mini-player/releases), extract it, and use Chrome's Load unpacked option at chrome://extensions. Chrome 116 or newer and Spotify Premium are required. This extension is not yet listed in the Chrome Web Store.

For first-time setup, configure a Spotify developer app's public Client ID in the extension options and register the exact redirect URI shown by your installation. Sign in using your own Spotify account. Each installation keeps its own tokens locally; no maintainer account or saved credentials are distributed. Future visits renew the connection automatically.

A shared development app supports at most five allowlisted Spotify accounts. Using your own Spotify account does not remove that app-level restriction. People outside the shared app's test group need their own permitted developer app; unrestricted use through one publisher app requires Spotify approval. See [Spotify's access rules](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) and [distribution status](DISTRIBUTION.md).

Full setup, installation, and troubleshooting steps are in [INSTALL.md](INSTALL.md).

## Features

- Background audio continues after closing the toolbar popup.
- Playlist browsing and song selection preserve playlist context.
- Queue displays Spotify's upcoming order, including repeated tracks.
- Shuffle and repeat cycle through the active session's settings.
- The popup checks live playback, current track, then Spotify listening history.
- Opening the popup does not automatically start audio. A paused live session keeps its reported position.
- History-only restoration shows Recently played and restarts that song when you press Play; Spotify history has no paused position.
- Previous/next, seeking, volume, automatic token renewal, and local disconnect are supported.

Chrome closes an audio offscreen document after 30 seconds without audio. Press Play to recreate a player when needed. There are no silent-audio keepalives.

## Development

Node.js 22 or newer is required. There are no package dependencies.

~~~sh
npm test
npm run check
npm run build
~~~

If npm is unavailable but Node is installed:

~~~sh
node --test background.test.cjs popup.test.cjs
node --check background.js
node --check popup.js
node --check offscreen.js
node --check setup.js
node scripts/package.cjs
~~~

The build writes a versioned ZIP and SHA-256 checksum to dist/. An explicit file list excludes Git metadata, tests, local build files, and credentials. GitHub Actions runs checks on main and pull requests. Pushing a version tag matching manifest.json creates a preview release with the ZIP and checksum.

Tests cover account configuration, OAuth client selection, token renewal, account changes, paused-session restoration, history fallback, queue ordering, controls, and popup interactions using mocked Spotify/Chrome APIs. They do not replace live testing with a second Spotify account or guarantee exact cross-device continuity, browser layout, resource savings, or store approval.

## Public distribution

GitHub ZIPs are developer previews installed from trusted unpacked source. One-click installation and automatic distributed updates require a Chrome Web Store release. Spotify audience approval, SDK redistribution terms, store listing assets, stable OAuth redirect configuration, and policy review are separate requirements. See [DISTRIBUTION.md](DISTRIBUTION.md).

## Privacy and licensing

[PRIVACY.md](PRIVACY.md) describes local tokens, Spotify requests, permissions, and disconnect behavior. The project adds no analytics or separate collection server. Never submit account tokens, secrets, or browser storage dumps in bug reports.

Original project code and documentation use the MIT license. Spotify's unmodified vendor SDK loader is excluded from that license and remains subject to Spotify's terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Spotify Mini Player is not affiliated with or endorsed by Spotify.
