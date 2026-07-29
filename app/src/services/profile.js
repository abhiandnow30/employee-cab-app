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

  // No document. Only a sign-up in progress may create one.
  if (!pending) return null;

  // First time we've seen this user → create their profile document from what
  // they entered at sign-up. The admin sets their cab / roster afterwards. We
  // stamp createdAt server-side but keep it off the returned object (it's a
  // write-only sentinel — no screen reads it).
  const data = { ...pending, email };
  await setDoc(ref, { ...data, createdAt: serverTimestamp() });
  return data;
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
  // A departing driver must not stay linked to a cab.
  if (cabId) batch.set(doc(firestore, 'cabs', cabId), { driverUid: null }, { merge: true });
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
    await setDoc(doc(firestore, 'employees', uid), {
      ...profile,
      email: cleanEmail,
      role,
      // A driver starts with no cab — the admin links one from Manage Drivers.
      ...(role === 'driver' ? { cabId: null } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
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
      return 'That email already has an account';
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
      const uid = await adminCreateAccount({
        email,
        password: throwawayPassword(),
        role,
        profile: {
          name,
          empId: String(p.empId || '').trim(),
          phone: String(p.phone || '').trim(),
          address: String(p.address || '').trim(),
          // The route the sheet named, if any — the coordinator groups rides by it.
          ...(p.route ? { roster: { route: String(p.route).trim() } } : {}),
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

// Set one route on many employees at once — the fast path for a fresh company or
// a re-drawn route map, where doing it one card at a time is what stops it from
// happening at all. Chunked because Firestore commits at most 500 writes a batch.
export async function bulkSetEmployeeRoute(uids, route) {
  if (!firestore) throw new Error('Backend not configured.');
  const list = (uids || []).filter(Boolean);
  if (!list.length) return 0;
  const value = route ? String(route).trim() : null;

  const LIMIT = 450;
  for (let i = 0; i < list.length; i += LIMIT) {
    const batch = writeBatch(firestore);
    list.slice(i, i + LIMIT).forEach((uid) => {
      batch.update(doc(firestore, 'employees', uid), { 'roster.route': value });
    });
    await batch.commit();
  }
  return list.length;
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
