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
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firestore, firebaseConfig } from './firebase';

// The roles an admin may hand out from the app. 'admin' is deliberately absent:
// admin access is granted in the Firebase console only.
export const ASSIGNABLE_ROLES = ['employee', 'driver'];

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

// Admin links a driver to a cab — or unlinks them when `cabId` is null.
//
// This keeps BOTH sides of the link in step, atomically:
//   • employees/<driverUid>.cabId — which cab this driver drives
//   • cabs/<cabId>.driverUid      — which driver's live location this cab shows
//     (the live-location feed is keyed by driver uid so the database rules can
//      guarantee a driver only writes their own position)
//   • cabs/<cabId>.driverName / driverPhone — kept in sync with the account, so
//     the name employees see is the person actually driving
// A cab can only have one driver, so any previous holder is unlinked first.
export async function assignCabToDriver(driverUid, cabId) {
  if (!firestore) throw new Error('Backend not configured.');
  const driverSnap = await getDoc(doc(firestore, 'employees', driverUid));
  const driver = driverSnap.exists() ? driverSnap.data() : {};
  const previousCabId = driver.cabId || null;

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'employees', driverUid), { cabId: cabId || null });

  // Leaving the old cab: forget the driver on it so nobody tracks a stale feed.
  if (previousCabId && previousCabId !== cabId) {
    batch.set(
      doc(firestore, 'cabs', previousCabId),
      { driverUid: null },
      { merge: true }
    );
  }

  if (cabId) {
    // Another driver may still be holding this cab — unlink them.
    const holders = await getDocs(
      query(collection(firestore, 'employees'), where('cabId', '==', cabId))
    );
    holders.docs
      .filter((d) => d.id !== driverUid)
      .forEach((d) => batch.update(d.ref, { cabId: null }));

    batch.set(
      doc(firestore, 'cabs', cabId),
      {
        driverUid,
        driverName: driver.name || '',
        driverPhone: driver.phone || '',
      },
      { merge: true }
    );
  }

  return batch.commit();
}

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
//     shift:       '1:00 PM – 10:00 PM',       // shift timing (day / night)
//     workingDays: ['Mon','Tue','Wed','Thu','Fri'],  // may include Sat/Sun
//   }
// `workingDays` is the source of truth for which days an employee may book a
// cab — an employee rostered on Sat/Sun can book weekend rides; others can't.
export function updateEmployeeRoster(uid, roster) {
  return updateDoc(doc(firestore, 'employees', uid), { roster });
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
