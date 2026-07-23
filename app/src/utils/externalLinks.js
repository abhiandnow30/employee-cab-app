// ---------------------------------------------------------------------------
// EXTERNAL LINKS  (maps + phone)
// Launching a maps app or the phone dialer differs per platform, so this is the
// one place that knows how. Screens just call openDirections() / callNumber().
//
//   • Web     → opens Google Maps in a NEW browser tab.
//   • iOS     → Google Maps app → Apple Maps → Google Maps website (fallbacks).
//   • Android → turn-by-turn navigation → generic geo: handler → website.
//
// Each native platform tries its preferred deep links first and falls back to
// the universal https link, so navigation always opens *something*.
//
// NOTE for iOS: for canOpenURL('comgooglemaps://') to work (i.e. to detect the
// Google Maps app), "comgooglemaps" must be listed under
// ios.infoPlist.LSApplicationQueriesSchemes in app.json — it is. Apple Maps
// (maps://) and tel: are system schemes and need no declaration.
// ---------------------------------------------------------------------------

import { Platform, Linking } from 'react-native';

// Destination string Maps understands: exact "lat,lng" when we have coordinates,
// otherwise the URL-encoded address text (Maps resolves it by search).
function targetQuery({ coords, label } = {}) {
  return coords && typeof coords.latitude === 'number'
    ? `${coords.latitude},${coords.longitude}`
    : encodeURIComponent(label || '');
}

// Universal Google Maps DIRECTIONS link — the cross-platform fallback.
export function webDirectionsUrl(target) {
  return `https://www.google.com/maps/dir/?api=1&destination=${targetQuery(
    target
  )}&travelmode=driving`;
}

// Try each url in order; open the first the device can handle. As a last resort,
// attempt the final url anyway (canOpenURL can be over-cautious). Returns true
// if anything opened.
async function openFirstSupported(urls) {
  for (const url of urls) {
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return true;
      }
    } catch {
      // ignore and try the next candidate
    }
  }
  try {
    await Linking.openURL(urls[urls.length - 1]);
    return true;
  } catch {
    return false;
  }
}

// Open driving directions to a { coords, label } target. Returns true if a maps
// app/tab was launched.
export async function openDirections(target) {
  const q = targetQuery(target);
  const web = webDirectionsUrl(target);

  if (Platform.OS === 'web') {
    // New tab so the app itself isn't navigated away.
    window.open(web, '_blank', 'noopener,noreferrer');
    return true;
  }

  if (Platform.OS === 'ios') {
    return openFirstSupported([
      `comgooglemaps://?daddr=${q}&directionsmode=driving`, // Google Maps app
      `maps://?daddr=${q}&dirflg=d`, // Apple Maps (always present)
      web,
    ]);
  }

  // Android: google.navigation starts turn-by-turn; geo: lets the user pick any
  // installed maps app; https is the final fallback.
  return openFirstSupported([
    `google.navigation:q=${q}`,
    `geo:0,0?q=${q}${target?.label ? `(${encodeURIComponent(target.label)})` : ''}`,
    web,
  ]);
}

// Start a phone call to `phone`. Returns true if the dialer/handler opened.
export async function callNumber(phone) {
  if (!phone) return false;
  // Keep digits and a leading +; strip spaces, dashes, brackets.
  const tel = `tel:${String(phone).replace(/[^\d+]/g, '')}`;

  if (Platform.OS === 'web') {
    // location.href triggers the OS/browser tel handler without unloading the app.
    window.location.href = tel;
    return true;
  }
  return openFirstSupported([tel]);
}
