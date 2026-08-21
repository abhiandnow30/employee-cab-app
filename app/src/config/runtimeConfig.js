// ---------------------------------------------------------------------------
// RUNTIME CONFIG RESOLVER — one value, two places it can come from.
//
//   1. window.__APP_CONFIG__   public/runtime-config.js, read at page load.
//                              Editable on the server after a build.
//   2. process.env.EXPO_PUBLIC_*  frozen into the bundle by Metro at build time.
//
// Runtime wins, build-time is the fallback. That ordering is what lets the deploy
// turn Hotjar on for an already-built bundle by writing one line on the server.
//
// NOTE THE ASYMMETRY, because it will surprise someone eventually: writing an ID
// into runtime-config.js turns recording ON for a bundle built without one.
// Writing "" there does NOT turn it back OFF if a value was baked in at build
// time — a blank runtime value falls through to the build-time one. To switch off
// a bundle that has an ID baked in, rebuild without EXPO_PUBLIC_HOTJAR_SITE_ID.
//
// ON NATIVE (iOS/Android) there is no window.__APP_CONFIG__ and no public/ folder,
// so only the build-time value exists. That is fine: Hotjar is a web-only tool and
// the module in ../analytics/hotjar.js no-ops off-web regardless.
//
// `process.env.EXPO_PUBLIC_HOTJAR_SITE_ID` must be written out literally, right
// here — Metro substitutes the text of that expression at build time and cannot
// resolve it if the name is computed.
// ---------------------------------------------------------------------------

const runtime =
  typeof window !== 'undefined' && window.__APP_CONFIG__ ? window.__APP_CONFIG__ : {};

// Treated as "not set": undefined, null, blank, and anything shaped like
// __PLACEHOLDER__ — the form a substitution step leaves behind when it didn't
// run. An unsubstituted placeholder must fall through to the next source rather
// than being handed on as if it were a real value.
function isUnset(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  return !trimmed || /^__.*__$/.test(trimmed);
}

function resolve(...sources) {
  for (const raw of sources) {
    if (!isUnset(raw)) return raw.trim();
  }
  return '';
}

export const HOTJAR_SITE_ID = resolve(
  runtime.hotjarSiteId,
  process.env.EXPO_PUBLIC_HOTJAR_SITE_ID
);
