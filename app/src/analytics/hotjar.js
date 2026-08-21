// ---------------------------------------------------------------------------
// HOTJAR — session recordings and heatmaps, web only.
//
// WHAT THIS IS FOR. The desk screens are where people get stuck: assigning a cab
// to fifteen carpools at 8 PM, chasing an unrouted rider, uploading a roster that
// half-validates. Recordings show where the hesitation actually is, which no
// amount of reading the code tells you.
//
// OFF BY DEFAULT AND THAT IS A REAL STATE, not a stub. With no Site ID
// configured, initHotjar() returns false, no script is requested and no session
// is recorded — which is what every local `expo start --web` should do, and what
// a deploy that hasn't opted in does too. See ../config/runtimeConfig.js for
// where the ID comes from and how it is switched on without a rebuild.
//
// WEB ONLY, BY NATURE. Hotjar is a browser script; there is no native SDK here
// and none is wanted. The `typeof document` guard below IS the native check —
// React Native defines a global `window` but never a `document`, so this module
// is safe to import from index.js on all three platforms and simply does nothing
// on iOS and Android.
// ---------------------------------------------------------------------------

import { HOTJAR_SITE_ID } from '../config/runtimeConfig';

const SCRIPT_ID = 'hotjar-snippet';

// The snippet version Hotjar expects, in both _hjSettings and the script URL.
// Bumping this is Hotjar's call, not ours — it changes only when they ship a new
// loader contract.
const SNIPPET_VERSION = 6;

export function isHotjarEnabled() {
  return Boolean(HOTJAR_SITE_ID);
}

/**
 * Injects the Hotjar snippet. Returns true only when this call actually injected
 * it — false is the ordinary answer, not a failure.
 *
 * Idempotent on purpose. React re-renders, Fast Refresh and StrictMode all
 * re-run module and effect code in development, and two copies of the snippet
 * would open two recordings for a single page view.
 */
export function initHotjar() {
  if (!isHotjarEnabled()) return false;
  // No document = native (or a server render). Nothing to instrument.
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.getElementById(SCRIPT_ID)) return false;

  // A non-numeric ID would quietly request hotjar-NaN.js and fail with nothing
  // in the console pointing at the cause — indistinguishable from Hotjar being
  // deliberately switched off. Say which it is instead.
  if (!/^\d+$/.test(HOTJAR_SITE_ID)) {
    console.warn(
      `[analytics] Ignoring hotjarSiteId="${HOTJAR_SITE_ID}": a Hotjar Site ID is ` +
        'digits only (e.g. "1234567"). Find it under Settings → Sites & ' +
        'Organizations in Hotjar. Recording is off.'
    );
    return false;
  }

  // The queue has to exist before the remote script loads, so anything called in
  // the meantime — identifyUser, in particular, which can fire on the very first
  // render for an already-signed-in session — is replayed instead of dropped.
  window.hj =
    window.hj ||
    function () {
      (window.hj.q = window.hj.q || []).push(arguments);
    };

  // Number, not string: Hotjar's own snippet emits `hjid:1234567` as a numeric
  // literal and the remote script reads this value back. The digits-only guard
  // above is what guarantees Number() cannot produce NaN here.
  window._hjSettings = { hjid: Number(HOTJAR_SITE_ID), hjsv: SNIPPET_VERSION };

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://static.hotjar.com/c/hotjar-${HOTJAR_SITE_ID}.js?sv=${SNIPPET_VERSION}`;
  document.head.appendChild(script);
  return true;
}

/**
 * Tags the current recording with WHO is using the app, so a session can be
 * traced back to the person who reported the problem.
 *
 * THE IDENTIFIER IS THE FIREBASE UID, NOT THE EMAIL, and that is deliberate.
 * Two of the four roles here have a *synthesized* address built from their mobile
 * number — `d<phone>@driver.cab.invalid`, `c<phone>@coordinator.cab.invalid`
 * (see utils/driverLogin.js and utils/coordinatorLogin.js) — so identifying by
 * email would ship a driver's phone number to a third party as their primary key.
 * The uid is opaque, stable for the life of the account, and the desk can look it
 * up in Firestore when it actually needs to.
 *
 * The email is still sent as an attribute WHEN IT IS A REAL ONE, because a
 * company address is what makes "show me Jane's session" possible. Anything on a
 * `.invalid` host is dropped: that TLD is reserved by RFC 2606 precisely because
 * it can never be a real inbox, so an address on it is always a stand-in for a
 * phone number rather than a way of reaching someone.
 *
 * Filtering recordings by these attributes is a paid Hotjar feature. On a tier
 * without it the call is accepted and ignored, so this is safe to ship on any plan.
 *
 * @returns {boolean} true only when an identify call was actually sent.
 */
export function identifyHotjarUser(user) {
  if (!isHotjarEnabled()) return false;
  if (typeof window === 'undefined' || typeof window.hj !== 'function') return false;

  const uid = user?.uid || user?.id || '';
  if (!uid) return false;

  const attributes = { role: user?.role || 'UNKNOWN' };

  // Lowercased so one person signing in as Jane.Doe@ and jane.doe@ is not two
  // different people in Hotjar.
  const email = String(user?.email || '').trim().toLowerCase();
  if (email && !/\.invalid$/.test(email)) attributes.email = email;

  // Whether the desk has ever entered this person, or the directory simply let
  // them in. A self-provisioned rider has no route and no address, so their
  // session looks broken for a reason worth being able to filter on.
  if (user?.selfProvisioned) attributes.selfProvisioned = true;

  window.hj('identify', uid, attributes);
  return true;
}

/**
 * Spread onto any element whose contents must never reach a recording:
 *
 *     <Text {...HJ_SUPPRESS}>{employee.address}</Text>
 *
 * `dataSet` is react-native-web's documented route to a real `data-*` attribute
 * on the DOM node (RNW filters unknown props, so `data-hj-suppress={...}` alone
 * would be dropped). On iOS and Android it is an ignored prop, which is the
 * correct outcome — there is no recording there to suppress.
 *
 * Hotjar masks `<input type="password">` on its own and NOTHING ELSE. Every
 * credential in this app is a numeric field rather than a password input — the
 * ride-start OTP, the driver's 14-digit code, the coordinator's passcode — so
 * each one has to be suppressed by hand or it is legible in the recording.
 */
export const HJ_SUPPRESS = { dataSet: { hjSuppress: 'true' } };
