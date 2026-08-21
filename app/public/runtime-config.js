// ---------------------------------------------------------------------------
// RUNTIME CONFIGURATION — read when the page loads, NOT compiled into the bundle.
//
// WHY THIS FILE EXISTS. Metro freezes every `process.env.EXPO_PUBLIC_*` value
// into the JavaScript it emits, so a bundle built with analytics on can never be
// turned off, and one built without an ID can never be turned on — not without a
// full rebuild and a redeploy. Everything in `public/` is copied verbatim into
// `dist/` instead of being bundled, so this file can be edited on the server
// after a build: no rebuild, no Node, no toolchain.
//
// That is exactly how the deploy uses it. `deploy/remote_deploy.sh` writes the
// Hotjar Site ID in here from the GitHub Actions repository variable
// HOTJAR_SITE_ID, on the server, immediately before `docker compose build`. The
// value committed below stays blank so nothing is recorded from a local `expo
// start --web` or a build by anyone who hasn't opted in.
//
// Loaded from public/index.html BEFORE the app bundle — see the <script> there.
// ---------------------------------------------------------------------------
window.__APP_CONFIG__ = {
  // Hotjar Site ID (digits only). NOT a secret: it ships inside client-side
  // JavaScript that any visitor can read, which is why it lives in a GitHub
  // *variable* rather than a secret. Blank = Hotjar fully off — no script is
  // requested and no session is recorded.
  hotjarSiteId: "",
};
