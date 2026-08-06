// ---------------------------------------------------------------------------
// PROFILE SERVICE
// A user's profile (name, role, employee id / phone / cab) lives in Firestore
// at employees/<uid>. Passwords are NEVER stored here — Firebase Auth owns those.
//
//   • On DRIVER SIGN UP, the app stashes the new profile via setPendingProfile(),
//     then creates the auth account. When Firebase reports the new user,
//     getOrCreateProfile() writes that pending profile as their document.
//   • Employees and drivers are normally provisioned by an admin
//     (adminCreateAccount), which writes the document directly.
//   • On later logins, getOrCreateProfile() just READS the existing document.
//
// IMPORTANT: getOrCreateProfile() never invents a profile for an account it
// doesn't recognise. It used to, which meant an employee the admin had removed
// got a brand-new working profile the next time they signed in. Now an account
// with no profile stays locked out until an admin provisions it.
//
// Admins are created in the Firebase console (see the header of
// firestore.rules) — the security rules do not allow self-promotion.
// ---------------------------------------------------------------------------

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  serverTimestamp, writeBatch, getDocs,
} from 'firebase/firestore';
import { initializeApp, getApp } from 'firebase/app';
import {
  getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth';
import { firestore, firebaseConfig } from './firebase';

// The roles an admin may hand out from the app. 'admin' is deliberately absent:
// HR/Admin access is granted in the Firebase console only, so nobody can create
// a second HR account from inside the app.
export const ASSIGNABLE_ROLES = ['employee', 'driver', 'coordinator'];

// Set by AppContext.signup() right before creating the account.
let pendingProfile = null;
export function setPendingProfile(profile) {
  pendingProfile = profile;
}

// Returns the user's profile, or null if this account has no profile document.
// A pending sign-up (driver self-registration) is written on first sight; any
// other unknown account returns null so the app can show "not provisioned"
// instead of silently minting an employee.
export async function getOrCreateProfile(user) {
  const email = (user.email || '').toLowerCase();
  const pending = pendingProfile;
  pendingProfile = null;

  if (!firestore) return pending;

  const ref = doc(firestore, 'employees', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  // No document, and no sign-up in flight → this may be someone HR invited but
  // who has never signed in before. Their invite is filed under their email
  // (the only thing that links a brand-new Microsoft uid to anything HR
  // entered), so try to claim it. This is what makes "Sign in with Microsoft"
  // work the very first time with no password — see claimInvite below.
  if (!pending) {
    // An invite comes FIRST because it carries what the token can't: employee
    // id, phone, home address and pickup route.
    const claimed = await claimInvite(user);
    if (claimed) return claimed;

    // No invite, but they signed in with a company Microsoft account → they
    // work here, so let them in. See selfProvisionFromDirectory below.
    const selfMade = await selfProvisionFromDirectory(user);
    if (selfMade) return selfMade;

    // A Microsoft sign-in runs this function twice, concurrently: once from the
    // sign-in call itself and once from the auth-state listener. Both may reach
    // the writes above, and only one can win — the loser's write is an UPDATE to
    // a doc it doesn't own, which the rules refuse. Re-read before reporting
    // nothing: returning null here would light up "Account not set up" for an
    // employee whose profile had just been created fine by the other caller.
    const after = await getDoc(ref);
    return after.exists() ? after.data() : null;
  }

  // First time we've seen this user → create their profile document from what
  // they entered at sign-up. The admin sets their cab / roster afterwards. We
  // stamp createdAt server-side but keep it off the returned object (it's a
  // write-only sentinel — no screen reads it).
  const data = { ...pending, email };
  await setDoc(ref, { ...data, createdAt: serverTimestamp() });
  return data;
}

// --- Invites: provisioning WITHOUT a password ------------------------------
//
// THE PROBLEM THIS SOLVES. Firebase Auth will never attach a new sign-in
// method to an existing account without proof of ownership of that account.
// So while HR pre-created an email/password login, "Sign in with Microsoft"
// arrived as a DIFFERENT uid, found no employees/<uid> document, and the only
// honest way through was to ask for the password once and link the two. That
// works, but it means explaining a confirmation screen to every new hire.
//
// So HR stops creating the login. Instead it files the person's details under
// employeeInvites/<their email>. Nobody has a password because no account
// exists yet. The employee clicks "Sign in with Microsoft"; Firebase creates
// their account; getOrCreateProfile finds no profile, finds their invite, and
// copies it into employees/<their own uid>. One click, first time, nothing to
// explain — and the uid is theirs from the start, so nothing ever needs
// re-keying.
//
// Still HR-provisioned: without an invite there is nothing to claim, and the
// rules refuse an invite carrying role 'admin'. The email is proven by our
// single-tenant Entra directory rather than by a password HR had to invent,
// transmit and hope nobody reused — see emailIsTrusted() in firestore.rules.
//
// Drivers keep email/password accounts: they are not in the company directory,
// so there is no Microsoft account for them to sign in with.

const INVITES = 'employeeInvites';

// Invites are keyed by email, so the key has to be derived identically
// everywhere — HR writing it, the rules checking it, the employee claiming it.
export function inviteKey(email) {
  return String(email || '').trim().toLowerCase();
}

// HR files an invite. `profile` carries the same fields as a real record:
// { name, empId, phone, address, route }.
export function adminCreateInvite({ email, role = 'employee', profile = {} }) {
  if (!firestore) throw new Error('Backend not configured.');
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new Error('Admin accounts are created in the Firebase console.');
  }
  const key = inviteKey(email);
  if (!key) throw new Error('An email address is required.');
  return setDoc(doc(firestore, INVITES, key), {
    // Stored as well as used for the ID: the rules cross-check the two, so a
    // mismatched copy can never be written.
    email: key,
    role,
    name: String(profile.name || '').trim(),
    empId: String(profile.empId || '').trim(),
    phone: String(profile.phone || '').trim(),
    address: String(profile.address || '').trim(),
    ...(profile.route ? { roster: { route: String(profile.route).trim() } } : {}),
    createdAt: serverTimestamp(),
  });
}

// HR revokes an invite that was never claimed (wrong address, or they never
// joined). Deleting it is enough — there is no account to disable.
export function adminRevokeInvite(email) {
  if (!firestore) throw new Error('Backend not configured.');
  return deleteDoc(doc(firestore, INVITES, inviteKey(email)));
}

// Live list of invites nobody has claimed yet, so Employee Management can show
// "invited, not signed in yet" rather than losing track of them. Each claim
// deletes its own invite, so simply everything here is outstanding.
export function subscribeInvites(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    collection(firestore, INVITES),
    (snap) => cb(snap.docs.map((d) => ({ email: d.id, ...d.data() }))),
    onError
  );
}

// Turn the invite HR filed for this email into a real profile at
// employees/<uid>, and consume the invite so it can only be used once. Returns
// the new profile, or null if there is nothing to claim.
//
// Both writes go in ONE batch: a claim that created the profile but left the
// invite behind would leave a second person able to claim the same identity if
// the address were ever reassigned.
async function claimInvite(user) {
  const key = inviteKey(user?.email);
  if (!firestore || !key) return null;
  try {
    const inviteRef = doc(firestore, INVITES, key);
    const snap = await getDoc(inviteRef);
    if (!snap.exists()) return null;

    const invite = snap.data();
    const data = {
      name: invite.name || '',
      empId: invite.empId || '',
      phone: invite.phone || '',
      address: invite.address || '',
      // Copied, not chosen: the rules check this against the invite, and refuse
      // an invite that says 'admin'.
      role: invite.role || 'employee',
      email: key,
      ...(invite.roster ? { roster: invite.roster } : {}),
    };

    const batch = writeBatch(firestore);
    // createdAt is stamped server-side but kept off the returned object — it's
    // a write-only sentinel, same as in getOrCreateProfile above.
    batch.set(doc(firestore, 'employees', user.uid), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.delete(inviteRef);
    await batch.commit();
    return data;
  } catch (e) {
    // A failed claim must not look like a crash: the caller falls back to
    // "Account not set up" (or the password-confirm screen), which is the
    // correct outcome for anyone with no valid invite. Logged because a
    // permission-denied here usually means the rules haven't been deployed.
    console.warn('[invite] could not claim invite for', key, '—', e?.message);
    return null;
  }
}

// --- Self-provisioning from the company directory ---------------------------
//
// WHY THIS EXISTS. The two scheduled rides come off the monthly roster, but an
// employee who is NOT on that roster still needs a cab sometimes — and the way
// they get one is to ask the desk. They cannot ask if they cannot sign in. So
// signing in with a company Microsoft account is itself enough to get a
// profile: if Entra says you work here, you work here.
//
// The gate is the PROVIDER, not the email address. Our Azure app registration
// is single-tenant, so Microsoft refuses to issue a token for anyone outside
// the company directory — that is what makes this "every employee" rather than
// "everyone". A verified email would NOT be good enough: anyone can verify
// their own personal address. Mirrored by signedInWithDirectory() in
// firestore.rules, which is the half that actually enforces it.
//
// What they DON'T get: no employee id, no phone, no home address, and no
// pickup route — a rider must not pick the route that decides which cab
// collects them, and the address is HR-owned (it changes via
// addressChangeRequests). They are flagged `selfProvisioned` so the desk can
// tell them apart from someone HR entered and fill in what's missing. Until
// then they can sign in and ask for a cab, but not be routed into one.
const DIRECTORY_PROVIDER = 'microsoft.com';

function signedInWithDirectory(user) {
  return !!user?.providerData?.some((p) => p.providerId === DIRECTORY_PROVIDER);
}

async function selfProvisionFromDirectory(user) {
  if (!firestore || !signedInWithDirectory(user)) return null;
  const email = inviteKey(user?.email);
  if (!email) return null;
  // Keep these keys in step with the hasOnly() list in firestore.rules — the
  // rules pin the document to exactly this shape, so an extra field here fails
  // the whole write rather than being quietly dropped.
  const data = {
    name: String(user.displayName || '').trim() || email,
    email,
    role: 'employee',
    selfProvisioned: true,
  };
  try {
    await setDoc(doc(firestore, 'employees', user.uid), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return data;
  } catch (e) {
    console.warn('[directory] could not self-provision', email, '—', e?.message);
    return null;
  }
}

// --- Admin: manage drivers -------------------------------------------------

// Live list of all driver accounts. Calls cb with [{ uid, ...profile }].
export function subscribeDrivers(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  const q = query(collection(firestore, 'employees'), where('role', '==', 'driver'));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    onError
  );
}

// NOTE: driver↔cab linking lives in services/cabs.js (linkCabDriver), because the
// COORDINATOR owns the fleet. It writes both sides together:
//   cabs/<cabId>.driverUid  ←→  employees/<uid>.cabId
// Neither side is ever writable by the driver — `cabId` is what grants read
// access to that cab's riders.

// Admin edits an employee's profile (Employee Management screen). Only the admin
// may write another user's profile — enforced by the Firestore security rules.
// Stamps `updatedAt` so the record shows when it was last touched. Uses
// setDoc(merge) so it also works for profiles that predate this field set.
export function adminUpdateEmployee(uid, fields) {
  return setDoc(
    doc(firestore, 'employees', uid),
    { ...fields, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// Admin removes an employee's profile (e.g. they left the organisation). This
// deletes the Firestore profile document only — the Firebase Auth login can
// only be removed with the Admin SDK (server-side), so disable/delete that in
// the Firebase console if you also want to revoke their sign-in. Until then the
// account can still authenticate, but it has no profile, so the app locks it out
// (see getOrCreateProfile) instead of recreating it.
export async function adminDeleteEmployee(uid) {
  if (!firestore) throw new Error('Backend not configured.');
  const snap = await getDoc(doc(firestore, 'employees', uid));
  const cabId = snap.exists() ? snap.data().cabId : null;
  const batch = writeBatch(firestore);
  // A departing driver must not stay linked to a cab — but only detach a cab that
  // still exists. set(merge) on a cab that has already been removed would CREATE
  // it, and the rules reject a cab with no number, so a stale cabId on the profile
  // would have blocked the removal entirely.
  if (cabId) {
    const cab = await getDoc(doc(firestore, 'cabs', cabId));
    if (cab.exists()) batch.update(cab.ref, { driverUid: null });
  }
  batch.delete(doc(firestore, 'employees', uid));
  return batch.commit();
}

// Admin creates a brand-new LOGIN + profile in one step, for an employee or a
// driver (`role`). Admin accounts are NOT created here — see firestore.rules.
//
// Firebase's client SDK signs a newly-created user into the CURRENT app, which
// would kick the admin out. To avoid that we create the account on a throwaway
// SECONDARY Firebase app, then sign that secondary app out — the admin's
// primary session is never touched. The profile document is written through the
// primary (admin) connection, so the security rules authorise it as an admin.
const PROVISIONER_APP = 'employee-provisioner';
export async function adminCreateAccount({ email, password, role = 'employee', profile }) {
  if (!firestore) throw new Error('Backend not configured.');
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw new Error('Admin accounts are created in the Firebase console.');
  }
  const cleanEmail = (email || '').trim().toLowerCase();

  let secondary;
  try {
    secondary = getApp(PROVISIONER_APP);
  } catch {
    secondary = initializeApp(firebaseConfig, PROVISIONER_APP);
  }
  const secondaryAuth = getAuth(secondary);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, password);
    const uid = cred.user.uid;
    try {
      await setDoc(doc(firestore, 'employees', uid), {
        ...profile,
        email: cleanEmail,
        role,
        // A driver starts with no cab — the desk links one from the Fleet screen.
        ...(role === 'driver' ? { cabId: null } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      // THE LOGIN EXISTS BUT THE PROFILE DOESN'T — undo the login.
      //
      // Two steps, two systems: the account is created in Firebase Auth, then the
      // profile is written to Firestore. When the second half failed (most often
      // rules that hadn't been deployed yet) the login survived, invisible in the
      // app but very much there in Auth — so every retry came back "That email
      // already has an account" and the only cure was deleting the user in the
      // console. The secondary app is still signed in as this brand-new user, so
      // it can delete itself; if even that fails there is nothing more we can do
      // from the client, and the original error is the one worth reporting.
      await cred.user.delete().catch((delErr) =>
        console.warn('[provision] could not roll back the new login:', delErr?.message)
      );
      throw e;
    }
    return uid;
  } finally {
    // Always drop the secondary session, even if the profile write failed.
    await signOut(secondaryAuth).catch(() => {});
  }
}

// --- Admin: provision a whole roster's worth of people ----------------------
//
// HR's monthly sheet already names everyone, with their id, email, phone and home
// address. Re-typing all of that into a dialog once per person is the slowest,
// most error-prone part of onboarding — and an id typed differently from the sheet
// silently drops that person out of the roster.
//
// So the sheet provisions them. Three decisions worth keeping:
//
//   * NOBODY IS GIVEN A PASSWORD. Each account is created with a throwaway random
//     one that is never shown to anyone, then Firebase emails the person a link to
//     set their own. HR never invents, stores or distributes a password.
//   * ONE AT A TIME, not in parallel. Every create runs through the same secondary
//     Firebase app, and each one signs *into* it; overlapping creates would race
//     over that single session.
//   * ONE FAILURE IS NOT A FAILED BATCH. A duplicate email or a typo'd address
//     stops that person only — everyone else is still created, and the caller gets
//     a per-person reason for whatever didn't work.

// A password nobody will ever type. It exists only because Firebase requires one
// at creation; the reset email is how the person actually gets in.
function throwawayPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const size = 24;
  let out = '';
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(size);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }
  // No Web Crypto (very old browser). Still unguessable enough for a value that is
  // discarded before anyone could try it.
  for (let i = 0; i < size; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Turn Firebase's auth codes into something HR can act on.
function inviteError(e) {
  switch (e?.code) {
    case 'auth/email-already-in-use':
      // Say where to look: the account exists in Firebase Auth, which is not the
      // same thing as appearing in this list — it may have been created with a
      // different role, or left behind by an attempt that failed halfway.
      return "That email already has an account. If they're not in this list, it was created with a different role — ask HR to check, or use another address";
    case 'auth/invalid-email':
      return 'That email address is not valid';
    case 'auth/weak-password':
      return 'Firebase rejected the generated password — try again';
    case 'auth/too-many-requests':
      return 'Firebase is rate-limiting new accounts — wait a minute and retry';
    case 'permission-denied':
      return 'Not allowed to create employee records — check the Firestore rules';
    default:
      return e?.message || 'Could not create this account';
  }
}

// `people`: [{ email, name, empId, phone, address, route }]
// `onProgress(done, total, label)` is called as each one finishes, so a long batch
// can show real progress rather than an indeterminate spinner.
export async function adminInviteEmployees(people, { onProgress, role = 'employee' } = {}) {
  if (!firestore) throw new Error('Backend not configured.');
  const list = Array.isArray(people) ? people : [];
  const created = [];
  const failed = [];

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const email = String(p?.email || '').trim().toLowerCase();
    const name = String(p?.name || '').trim();
    try {
      if (!email) throw new Error('No email address for this person');
      if (!name) throw new Error('No name for this person');
      const profile = {
        name,
        empId: String(p.empId || '').trim(),
        phone: String(p.phone || '').trim(),
        address: String(p.address || '').trim(),
        route: p.route ? String(p.route).trim() : '',
      };

      if (role === 'driver') {
        // Drivers are not in the company Microsoft directory, so they still get
        // a real login plus a set-your-own-password email (see the invite
        // section above for why employees no longer do).
        const uid = await adminCreateAccount({
          email,
          password: throwawayPassword(),
          role,
          profile: {
            name: profile.name,
            empId: profile.empId,
            phone: profile.phone,
            address: profile.address,
            // The route the sheet named, if any — the coordinator groups rides by it.
            ...(profile.route ? { roster: { route: profile.route } } : {}),
          },
        });
        // The account exists; now let them set their own password. A failure here is
        // NOT a failed creation — the account is real and HR can resend the email —
        // so it is reported separately rather than rolled back.
        let invited = true;
        try {
          await sendPasswordResetEmail(getAuth(), email);
        } catch {
          invited = false;
        }
        created.push({ uid, email, name, empId: p.empId, invited });
      } else {
        // Employees: file an invite, create nothing. There is no account and no
        // password, so there is also nothing that can half-succeed the way
        // "login created but profile write failed" used to — and no set-password
        // email to send, because they sign in with Microsoft instead.
        await adminCreateInvite({ email, role, profile });
        // `uid` is genuinely not known yet — it comes into existence when they
        // first sign in. Null rather than absent so callers reading it get a
        // clear value instead of undefined.
        created.push({ uid: null, email, name, empId: p.empId, invited: true });
      }
    } catch (e) {
      failed.push({ email, name, empId: p?.empId, reason: inviteError(e) });
    }
    onProgress?.(i + 1, list.length, name || email);
  }

  return {
    created,
    failed,
    createdCount: created.length,
    failedCount: failed.length,
    // Accounts that exist but whose "set your password" email didn't send.
    notInvited: created.filter((c) => !c.invited),
  };
}

// --- Admin: shift roster ---------------------------------------------------

// Live list of all EMPLOYEE accounts (the people the admin rosters). Calls cb
// with [{ uid, ...profile }].
export function subscribeEmployees(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  const q = query(collection(firestore, 'employees'), where('role', '==', 'employee'));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    onError
  );
}

// Admin saves an employee's shift roster. `roster` is:
//   {
//     route:       'JNTU Cab',                 // cab location / pickup route
//     shift:       '1:00 PM – 10:00 PM',       // legacy, no longer read
//     workingDays: ['Mon','Tue','Wed','Thu','Fri'],  // legacy, no longer read
//   }
// Shifts now come from the monthly roster HR uploads (services/roster.js), so
// `route` is the only field of this map anything still reads. Kept whole-map for
// the documents that already carry the old fields.
export function updateEmployeeRoster(uid, roster) {
  return updateDoc(doc(firestore, 'employees', uid), { roster });
}

// --- Pickup route ----------------------------------------------------------
//
// THE ROUTE IS THE UNIT THE COORDINATOR WORKS IN. Everyone on one route is a
// cabful of people who live near each other, so grouping today's rides by route
// is what turns ~200 rides into ~15 assignment decisions. An employee with no
// route lands in "No route set" and has to be grouped by hand, every single day
// of the month — which is why setting it is worth this much plumbing.
//
// Stored at employees/<uid>.roster.route, and written with a DOTTED PATH so the
// legacy shift / workingDays fields beside it survive the write. Sending the
// whole `roster` map would silently drop them.
//
// The rules let HR write it, and let a coordinator write THIS FIELD ONLY, so a
// missing route can be fixed by whoever notices it at 9 PM without waiting for
// HR the next morning.
export function updateEmployeeRoute(uid, route) {
  if (!firestore || !uid) return Promise.resolve();
  const value = route ? String(route).trim() : null;
  return updateDoc(doc(firestore, 'employees', uid), { 'roster.route': value });
}


// Live view of ONE user's own profile document. Used to keep the signed-in
// employee's roster up to date after the admin edits it — no re-login needed.
// `onMissing` fires if the document isn't there (an account the admin removed),
// so the app can lock the session out instead of running on stale state.
// Returns an unsubscribe function.
export function subscribeProfile(uid, cb, onError, onMissing) {
  if (!firestore) return () => {};
  return onSnapshot(
    doc(firestore, 'employees', uid),
    (snap) => {
      if (snap.exists()) cb(snap.data());
      else if (onMissing) onMissing();
    },
    onError
  );
}
