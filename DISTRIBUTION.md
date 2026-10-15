# Distribution status and release checklist

## Available now

The release ZIP supports unpacked developer installation with each user's own Spotify account and configured Client ID. GitHub source and ZIP releases are separate from Chrome Web Store publication. No app credentials or account tokens are bundled in the ZIP. A public OAuth identifier remains in source solely for migration of existing local sign-ins; new installations cannot use that fallback without an existing local authorization.

Run npm test, npm run check, and npm run build. The build uses an explicit file list, puts manifest.json at the ZIP root, includes the SDK loader and user documentation, and writes a SHA-256 checksum in dist/. Dist files are ignored by Git.

Pushing a version tag, for example v0.5.0, triggers the release workflow to run checks and attach the ZIP and checksum to a GitHub release. The workflow checks that the tag and manifest version match. The account creating the repository must allow GitHub Actions; the release job needs contents:write permission.

## Spotify audience limits

Development mode supports up to five authenticated allowlisted accounts. New users must be added to the chosen app's allowed users before its Web API works for them. The app owner requires Premium, and SDK audio playback requires a Premium account.

A shared Client ID plus personal user sign-in is the usual OAuth model. Giving everyone their own account does not remove the shared app's audience or quota restrictions. Configuring a user's own developer app supports personal development use subject to Spotify's current rules; it is not a route around those rules or a one-click public product.

Wider use under one shared app requires Spotify extended access. Current eligibility is restrictive and aimed at qualifying organizations. Check the current policy before promising public unrestricted playback:

- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates
- https://developer.spotify.com/documentation/web-playback-sdk

## Chrome Web Store release

Before submitting a store listing:

1. Confirm Spotify app permissions, audience approval, and the applicable SDK redistribution terms. See THIRD_PARTY_NOTICES.md. This repository does not claim Spotify or Chrome approval.
2. Create the Chrome Web Store developer account/listing. Review any registration fee yourself; the build process does not pay or submit a listing.
3. Obtain the listing's stable extension ID and register its exact OAuth redirect URI with the publisher's Spotify app. Decide whether the store build uses an approved publisher Client ID or retains personal developer configuration.
4. Add original extension icons, listing screenshots, description, support information, and a public privacy-policy URL. PRIVACY.md is a source draft for that policy; host the published policy and review all store disclosures against the implementation.
5. Review the SDK iframe and remotely delivered playback code against current Chrome Web Store policies. The local loader embeds https://sdk.scdn.co/embedded/index.html; public distribution approval has not been established.
6. Test clean installation with another permitted Spotify account, token renewal, redirect flow, playback, queue, controls, session continuity, disconnect, and update behavior.
7. Upload the ZIP and submit for review. Publication and approval are distinct from building the ZIP or creating a GitHub repository.

Official distribution guide: https://developer.chrome.com/docs/extensions/how-to/distribute.
