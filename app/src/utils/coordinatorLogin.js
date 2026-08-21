// ---------------------------------------------------------------------------
// COORDINATOR LOGIN
//
// A coordinator signs in with TWO things: their own phone number, and a 4-digit
// passcode the transport desk hands them when the account is created.
//
//     phone 9848094029  +  passcode 4071
//
// No email, no sign-up, nothing to wait for. The account exists the moment HR
// presses save, which is the whole reason it works this way — see below.
//
// HOW THAT BECOMES A REAL LOGIN. Firebase Auth still owns the account, because
// firestore.rules identifies a coordinator by request.auth.uid and their role.
// So, exactly as with drivers (utils/driverLogin.js), the two things they type
// ARE the credentials:
//
//     Auth email     c<phone>@<COORDINATOR_EMAIL_DOMAIN>   ← the phone only
//     Auth password  the passcode FOLLOWED BY the phone    ← see below
//
// Deriving the email from the phone is what makes the phone field enough: nothing
// has to be read from Firestore before signing in, so no security rule had to be
// opened for a pre-auth lookup, and the address never changes even when the
// passcode is re-issued.
//
// WHY NOT MICROSOFT, LIKE EMPLOYEES. Because a Microsoft account only comes into
// existence for us when the person first signs in, so HR would file an invite and
// then wait — the coordinator would sit in a "pending" list, unable to be used,
// until they happened to log in. Creating the account outright removes that wait
// entirely. (Phone + SMS OTP has the same problem for the same reason: the uid
// appears at first verification, not at provisioning.)
//
// HOW THIS DIFFERS FROM THE DRIVER SCHEME, AND WHY. A driver's code is DERIVED —
// last 4 of the cab plus their phone — and therefore recomputable, which is what
// lets a half-finished rotation be repaired. This passcode is RANDOM, so the copy
// on employees/<uid>.loginCode is the only record of it anywhere. Two things pay
// for that:
//   • it is not guessable from anything printed on a vehicle or in a directory,
//     which matters because a coordinator sees every rider's home address, every
//     booking and every ride's start OTP — far more than one cab's riders;
//   • the two writes that can disagree (Auth password, profile mirror) are both
//     rolled back on failure — see adminCreateCoordinator and
//     rotateCoordinatorPasscode in services/profile.js.
// ---------------------------------------------------------------------------

// `.invalid` is reserved by RFC 2606 and can never resolve, so if Firebase ever
// tries to mail one of these accounts it cannot reach a real person's inbox.
export const COORDINATOR_EMAIL_DOMAIN =
  process.env.EXPO_PUBLIC_COORDINATOR_LOGIN_DOMAIN || 'coordinator.cab.invalid';

export const COORDINATOR_PHONE_LENGTH = 10;

// Requested at 4. Everything that touches a passcode reads this constant, so the
// length is changed here and nowhere else.
//
// WHAT 4 DIGITS COSTS, stated plainly because it is the whole secret protecting
// desk-level access — every rider's home address, every booking, every ride's
// start OTP. There are 10,000 possibilities, and this app does no rate limiting
// of its own; only Firebase Auth's own anti-abuse throttling slows a guesser
// down. It is not a number to raise the coordinator's access on top of.
export const PASSCODE_LENGTH = 4;

function digitsOf(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

// The coordinator's phone, or '' if it isn't a full 10 digits. '' means "this
// account cannot be keyed", so callers must never fall back to a partial value.
export function coordinatorPhone(phone) {
  const digits = digitsOf(phone);
  return digits.length === COORDINATOR_PHONE_LENGTH ? digits : '';
}

// The Firebase Auth email. Stable for the life of the account, because it depends
// on the phone and nothing else — re-issuing a passcode never moves it.
export function coordinatorEmail(phone) {
  const digits = coordinatorPhone(phone);
  return digits ? `c${digits}@${COORDINATOR_EMAIL_DOMAIN}` : '';
}

// The actual Firebase password: the passcode followed by the phone.
//
// WHY IT IS NOT JUST THE PASSCODE. Firebase Auth refuses any password shorter
// than 6 characters, so a 4-digit one cannot be stored at all — account creation
// comes back as auth/weak-password. Appending the phone (which the coordinator
// types anyway, in the other box) makes a 14-character password that Firebase
// accepts, with nothing extra to remember or hand over.
//
// IT ADDS NO SECRECY, AND IS NOT MEANT TO. The phone is the username; it is
// printed on their card and known to the desk. The real secret is still the
// 4 digits — 10,000 possibilities — and this is the same shape the driver login
// already uses (cab digits + phone). It exists to satisfy Firebase's length
// rule honestly, rather than by padding with a constant that would look like
// strength it doesn't have.
//
// Returns '' when the phone isn't a full 10 digits or the passcode is empty.
// It deliberately does NOT enforce PASSCODE_LENGTH: it derives from whatever is
// on file, so if that constant is ever changed, accounts issued under the old
// length still sign in instead of being locked out overnight. Length is gated by
// isPasscode() at the two places a human types one — the login screen and
// signInWithCoordinatorCode.
export function coordinatorAuthPassword(passcode, phone) {
  const digits = coordinatorPhone(phone);
  const code = String(passcode ?? '').replace(/[^0-9]/g, '');
  return digits && code ? `${code}${digits}` : '';
}

// A fresh passcode, digits only, PASSCODE_LENGTH long.
//
// Uses the platform CSPRNG where there is one. Math.random() is not a security
// primitive — its output is predictable from previous draws — and this value is
// the entire secret protecting desk-level access, so the fallback is only for an
// environment that genuinely has no crypto object.
//
// Rejection-sampled rather than `% 10`: 256 is not a multiple of 10, so the plain
// modulus would make 0-5 measurably likelier than 6-9 and shrink the real search
// space. Cheap to do correctly.
export function generatePasscode(length = PASSCODE_LENGTH) {
  const crypto = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  let out = '';
  if (crypto?.getRandomValues) {
    const buf = new Uint8Array(1);
    while (out.length < length) {
      crypto.getRandomValues(buf);
      if (buf[0] < 250) out += String(buf[0] % 10); // 250 = 25 × 10, so uniform
    }
    return out;
  }
  for (let i = 0; i < length; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

// Is this what a coordinator should be typing? Checked on the login screen so an
// obviously wrong length is refused locally rather than costing a round trip and
// coming back as a generic Firebase error.
export function isPasscode(code) {
  return digitsOf(code).length === PASSCODE_LENGTH;
}

// For reading out loud. Long codes are split in half ('40718352' → '4071 8352')
// so they don't have to be counted out one digit at a time; a short one is
// already legible and grouping it would only invent a space that isn't typed.
// Nothing parses this back — the login screen strips non-digits.
export function formatPasscode(code) {
  const digits = digitsOf(code);
  if (digits.length !== PASSCODE_LENGTH) return String(code ?? '');
  if (digits.length <= 5) return digits;
  const half = Math.ceil(digits.length / 2);
  return `${digits.slice(0, half)} ${digits.slice(half)}`;
}
