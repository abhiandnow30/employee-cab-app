// ---------------------------------------------------------------------------
// GUEST ACCOUNTS: THE ADDRESS ENTRA SIGNS THEM IN AS IS NOT THEIR ADDRESS.
//
// Somebody from another company who is invited into our Entra tenant as a B2B
// GUEST does not keep their own address as their sign-in name. Entra mints them
// a new one by mangling it into the tenant's own domain:
//
//   bhanuja.vuppala@exinent.com
//     → bhanuja.vuppala_exinent.com#EXT#@cloudfuzecom.onmicrosoft.com
//
// The '@' becomes '_', the whole thing becomes the local part, and our tenant's
// onmicrosoft.com domain is bolted on. That mangled string is what lands in the
// Firebase token, so it is what `user.email` returns, what firestore.rules sees
// as myEmail(), and what selfProvisionFromDirectory stores on their profile.
//
// EVERY PLACE THIS APP MATCHES A PERSON BY EMAIL THEN MISSES THEM:
//   • their invite is keyed on the real address, so claimInvite finds nothing
//     and they self-provision into a blank profile instead — no employee id, no
//     phone, no address, no route, and held at the cab-service form being asked
//     for details HR had already typed in;
//   • the roster sheet says the real address, so importRoster can't match them
//     and their shifts never import;
//   • the cab-assigned email is sent to whatever is on the profile, and nothing
//     delivers to an #EXT# address.
//
// So the mangling is undone HERE, at every comparison, rather than at the point
// it is stored. It cannot be fixed at storage time: firestore.rules pins a
// self-provisioned document's `email` to the token's own value
// (selfProvisionsFromDirectory), so the app is not allowed to write anything
// else at the moment the profile is created. An admin may correct it afterwards
// — adminApplyInvite does exactly that — but the profile is born mangled and
// this is what recognises it in the meantime.
//
// SAFE ON EVERYTHING ELSE. An address with no '#EXT#@' in it comes back
// lowercased and otherwise untouched, so this can be used anywhere an email is
// compared without having to know whether a guest is involved.
// ---------------------------------------------------------------------------

const GUEST_MARKER = '#ext#@';

// The person's REAL address, given whatever Entra signed them in as.
export function directoryEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  const marker = key.indexOf(GUEST_MARKER);
  if (marker === -1) return key;

  // Everything before '#EXT#@' is the original address with its '@' turned into
  // an '_'. Split on the LAST underscore, not the first: a local part may
  // legitimately contain one ("first_last@exinent.com"), a domain may not.
  const mangled = key.slice(0, marker);
  const at = mangled.lastIndexOf('_');
  // No underscore at all means this isn't the shape we thought it was. Hand back
  // what we were given rather than inventing an address out of it.
  if (at <= 0 || at === mangled.length - 1) return key;
  return `${mangled.slice(0, at)}@${mangled.slice(at + 1)}`;
}

// Is this a guest sign-in name rather than a real address? Used to decide
// whether a profile's stored email is worth correcting.
export function isGuestDirectoryEmail(email) {
  return String(email || '').toLowerCase().includes(GUEST_MARKER);
}

// Do these two addresses belong to the same person, whichever form each is in?
export function sameDirectoryPerson(a, b) {
  const left = directoryEmail(a);
  return !!left && left === directoryEmail(b);
}
