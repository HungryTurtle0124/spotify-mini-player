# Privacy

Spotify Mini Player is an unofficial browser extension. It connects directly to Spotify; the project does not run a server to collect your account data.

## Stored on your computer

The extension stores your chosen Spotify Client ID, OAuth access token, refresh token, granted permissions, and token expiry in Chrome extension local storage. Token storage is restricted to trusted extension contexts. It is not Chrome sync storage and is not included in a downloaded release ZIP or the source repository.

Recent listening data and queue information are held in memory for display and short-lived caching. The extension does not add analytics, advertising trackers, or a separate listening-history database.

## Requests to Spotify

Spotify receives authentication, token renewal, playback-state, listening-history, playlist, queue, and playback-control requests. The Spotify Web Playback SDK and its embedded player communicate with Spotify to deliver audio. Spotify handles these requests under its own privacy policy: https://www.spotify.com/legal/privacy-policy/.

## Permissions

- identity: Spotify authorization through Chrome's OAuth flow.
- storage: keep your app settings and sign-in on this computer.
- offscreen: play audio while the popup is closed.
- accounts.spotify.com and api.spotify.com: Spotify authentication and Web API requests.

No client secret or Spotify password is requested or stored by the extension. Spotify sign-in happens on Spotify's authorization pages.

## Disconnect and remove

Use Disconnect locally in Account setup to stop background playback, remove local tokens, and clear the in-memory history cache. The Client ID setting remains so you can reconnect. Remove app authorization in your Spotify account settings to revoke Spotify-side access. Uninstall the extension to remove its local extension storage.

## Support

If you report a bug, include only the visible error and steps to reproduce. Do not attach access tokens, refresh tokens, client secrets, or browser storage dumps.
