// ---------------------------------------------------------------------------
// DRIVER LOGIN CODE
//
// A driver signs in with ONE number and nothing else: the last 4 digits of the
// cab they are on, followed by their own 10-digit phone number.
//
//     cab TS 08 TR 3456  +  phone 9263565755   →   3456 9263565755
//                                                  └┬─┘ └────┬───┘
//                                               last 4     phone
//
// No email, no password, no sign-up. The transport desk hands the code over when
// it links them to a cab.
//
// HOW THAT BECOMES A REAL LOGIN. Drivers still have to be genuine Firebase Auth
// users — firestore.rules identifies a driver by request.auth.uid (see
// isDriverForCab()), and live location is written to driverLocations/<uid> — so
// the code does not replace Firebase Auth. It BECOMES the credentials, worked out
// the same way every time:
//
//     Auth email     d<phone>@<DRIVER_EMAIL_DOMAIN>   ← the phone only
//     Auth password  the whole login code             ← cab + phone
//
// Deriving the email from the PHONE ALONE is what makes one field enough: the
// last 10 digits of whatever they typed give us the email, and the whole thing is
// the password. Nothing has to be looked up in Firestore before signing in, so no
// security rule had to be opened up to allow a pre-login read.
//
// The flip side is that the password changes whenever their cab does. Keeping the
// email fixed is what makes that survivable: the desk can sign in as them on a
// throwaway secondary app using the code currently on file and call
// updatePassword — see rotateDriverLoginCode() in services/profile.js.
//
// WHAT THIS IS NOT. A 14-digit number whose last 10 are a phone number and whose
// first 4 are painted on the side of the vehicle is weaker than a password
// somebody chose. It was asked for deliberately, it only ever unlocks
// driver-level access (one cab's riders for one day), and it stops working the
// moment that cab is reassigned. Do not extend the same trick to any other role.
// ---------------------------------------------------------------------------

// Where the synthesized addresses live. `.invalid` is reserved by RFC 2606 and can
// never resolve, so if Firebase ever tries to mail one of these accounts it cannot
// reach a real person's inbox. Overridable only because a Firebase project may
// one day refuse the TLD — nothing else in the design cares what it is.
export const DRIVER_EMAIL_DOMAIN =
  process.env.EXPO_PUBLIC_DRIVER_LOGIN_DOMAIN || 'driver.cab.invalid';

export const DRIVER_PHONE_LENGTH = 10;
export const CAB_CODE_LENGTH = 4;
export const DRIVER_CODE_LENGTH = CAB_CODE_LENGTH + DRIVER_PHONE_LENGTH; // 14

// Everything here works off digits only, so "TS 08 TR 3456", "ts08tr3456" and
// "TS-08-TR-3456" all produce the same code. A cab number that has been re-typed
// with different spacing must not silently invalidate a driver's login.
function digitsOf(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

// The driver's phone, or '' if it isn't a full 10 digits. Anything shorter cannot
// key an account, so callers treat '' as "this driver has no usable login".
export function driverPhone(phone) {
  const digits = digitsOf(phone);
  return digits.length === DRIVER_PHONE_LENGTH ? digits : '';
}

// The Firebase Auth email for a driver. Stable for the life of the account,
// because it depends on the phone and nothing else.
export function driverEmail(phone) {
  const digits = driverPhone(phone);
  return digits ? `d${digits}@${DRIVER_EMAIL_DOMAIN}` : '';
}

// The cab's contribution: the last 4 DIGITS of its number, not its last 4
// characters. 'TS 08 TR 3456' has digits '083456', so this is '3456' — the letter
// groups and the spacing can never leak into a code.
export function cabCodePart(cabNumber) {
  const digits = digitsOf(cabNumber);
  return digits.length >= CAB_CODE_LENGTH ? digits.slice(-CAB_CODE_LENGTH) : '';
}

// The full code, or '' if either half is unusable (a cab number with fewer than 4
// digits, or a phone that isn't 10). '' means "no code can be issued" — callers
// must never fall back to a partial one, since a driver typing a 10-digit code
// would then be signing in with their phone number alone.
export function driverLoginCode(cabNumber, phone) {
  const cab = cabCodePart(cabNumber);
  const digits = driverPhone(phone);
  return cab && digits ? `${cab}${digits}` : '';
}

// Recover the phone (and therefore the Auth email) from a typed code. The phone is
// the TAIL, so this holds even if a cab number ever contributes more or fewer
// digits than expected.
export function phoneFromLoginCode(code) {
  return digitsOf(code).slice(-DRIVER_PHONE_LENGTH);
}

// Is this what a driver should be typing? Checked on the login screen so an
// obviously wrong length is refused locally instead of costing a round trip and
// coming back as a generic Firebase error.
export function isDriverLoginCode(code) {
  const digits = digitsOf(code);
  return digits.length === DRIVER_CODE_LENGTH;
}

// For display on the desk's screens: '34569263565755' → '3456 9263565755', so the
// two halves are legible when reading a code out to a driver over the phone.
export function formatLoginCode(code) {
  const digits = digitsOf(code);
  if (digits.length !== DRIVER_CODE_LENGTH) return String(code ?? '');
  return `${digits.slice(0, CAB_CODE_LENGTH)} ${digits.slice(CAB_CODE_LENGTH)}`;
}

// The password held by a driver who is on NO CAB. Their phone, on its own.
//
// WHY NOT SOMETHING RANDOM. It was random at first, and that made
// employees/<uid>.loginCode the only record of it anywhere — so if that one write
// was ever refused or lost, nobody (not even the desk) could sign in as that
// driver to change their password again, and the account was scrap. Deriving it
// makes every password this system issues RECOMPUTABLE, which is what lets
// rotateDriverLoginCode() recover from a half-finished rotation instead of
// stranding the driver.
//
// AND IT IS STILL NOT A WAY IN. The app refuses anything that isn't a full
// 14-digit code (isDriverLoginCode, checked on the login screen and again in
// loginDriver), so there is no path through the UI that accepts a bare phone
// number. Someone hand-crafting a Firebase call with it would authenticate as a
// driver who holds no cab — and isDriverForCab() in firestore.rules refuses a
// null cabId, so they can read no bookings, no riders and no addresses. Nothing
// is exposed that a cab assignment doesn't grant.
export function unassignedLoginCode(phone) {
  return driverPhone(phone);
}

// Is the code on a driver's profile a real, shareable one? A driver with no cab
// holds the unassigned value above, which is NOT a code: it must never be
// displayed or handed out, and this is what keeps it off the desk's screens.
export function isShareableCode(code) {
  return isDriverLoginCode(code);
}

// Every password this driver's account could currently be holding, best guess
// first — what we believe it is, what we are trying to set, and the unassigned
// value they started life with. Rotation walks this list, which is what makes a
// rotation that failed halfway retryable rather than terminal.
export function loginCodeCandidates({ phone, currentCode, nextCode }) {
  const all = [currentCode, nextCode, unassignedLoginCode(phone)];
  return all.filter((c, i) => c && all.indexOf(c) === i);
}
