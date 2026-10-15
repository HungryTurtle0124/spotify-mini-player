# Install Spotify Mini Player

This is a developer preview for Chrome 116 or later. Audio playback requires Spotify Premium. It is not yet listed in the Chrome Web Store.

## Download and load

1. Download the versioned ZIP from this project's GitHub Releases page, or use the ZIP supplied by the maintainer.
2. Extract it into a folder you plan to keep. Do not load the ZIP itself or move the folder after installing.
3. Open chrome://extensions, enable Developer mode, choose Load unpacked, and select the extracted folder containing manifest.json.
4. Open the extension's Details page and then Extension options, or click the toolbar icon. First-time users are taken to account setup.

You are loading source code in developer mode. Normal one-click installation and automatic distributed updates require a Chrome Web Store release.

## Connect your Spotify account

1. Visit https://developer.spotify.com/dashboard and create a Spotify developer app for your own account. Select the Web API and Web Playback SDK if prompted. The app owner needs Premium. If the dashboard needs a redirect URI during creation, first copy the address displayed in extension setup.
2. Copy the app's public Client ID into the extension's account setup and save it. Never paste a client secret.
3. Copy the exact redirect address shown by your installed extension into that Spotify app's Redirect URIs and save the app settings. Another person's unpacked extension can have a different extension ID and redirect address.
4. Click Connect Spotify and approve access using your own Spotify account.
5. Open the toolbar player. Future visits renew and restore the saved connection automatically.

If a maintainer supplies a shared Client ID instead, they must add your Spotify account to that app's allowlist and register your exact extension redirect URI. Signing in alone does not guarantee API access: Spotify may return 403 for unapproved accounts. Development mode is limited to five authenticated users; public unlimited use requires Spotify approval. This extension does not bypass those limits.

Each installation stores its own tokens locally. Your sign-in does not sign other users into your account. Existing users of the original local build keep their saved connection when upgrading in the same folder.

## Use

- The popup shows a recoverable Spotify session without automatically playing it. Press Play or Continue on this PC to move playback here.
- When only listening history is available, the recent track and playlist context appear stopped. History has no paused position, so Play restarts that track.
- Open Your playlists, choose a playlist, then choose a song or Play playlist on this PC.
- Queue shows Spotify's upcoming playback order. Shuffle and repeat reflect the active session.
- Music continues after closing the popup. After a long pause, press Play to recreate the background player if needed.

## Troubleshooting

- 403: verify Premium, the configured Client ID, and the app's allowed Spotify users.
- Redirect error: copy the exact redirect address from this installation and save it in the same app as the configured Client ID.
- New permissions: Spotify may request consent once for added playback/history access.
- Unknown request after an upgrade: the popup attempts one automatic background refresh. Reopen it if it closes.
- Moving to a different Spotify app signs out the previous connection. Disconnect locally stops audio and removes saved tokens.

Report visible errors and reproduction steps. Do not include tokens, secrets, or browser storage dumps. See PRIVACY.md for stored data and network requests.

References: https://developer.spotify.com/documentation/web-api/concepts/quota-modes and https://developer.chrome.com/docs/extensions/how-to/distribute.
