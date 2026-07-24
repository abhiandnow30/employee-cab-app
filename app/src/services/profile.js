// ---------------------------------------------------------------------------
// PROFILE SERVICE
// A user's profile (name, role, employee id / phone / cab) lives in Firestore
// at employees/<uid>. Passwords are NEVER stored here — Firebase Auth owns those.
//
//   • On SIGN UP, the app stashes the new profile via setPendingProfile(), then
//     creates the auth account. When Firebase reports the new user,
//     getOrCreateProfile() writes that pending profile as their document.
//   • On later logins, getOrCreateProfile() just reads the existing document.
// ---------------------------------------------------------------------------

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { initializeApp, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { firestore, firebaseConfig } from './firebase';

// Secret code required to sign up as an Admin. NOTE: this lives in the app, so
// it's a deterrent, not strong security — real admin control should be granted
// server-side. Change this to whatever you hand out to admins.
export const ADMIN_SIGNUP_CODE = 'CAB-ADMIN-2026';

// Seed profiles for the original demo accounts (used if they have no document
// yet). New real users come from the sign-up form instead.
const DEFAULTS = {
  'employee@demo.com': { name: 'Abhilasha K', empId: '1399', role: 'employee', phone: '9000000001' },
  'admin@demo.com': { name: 'Transport Desk', empId: '900000001', role: 'admin', phone: '9000000002' },
  'driver@demo.com': { name: 'Ramesh', empId: 'D001', role: 'driver', phone: '9111111111', cabId: 'c1' },
};

// Set by AppContext.signup() right before creating the account.
let pendingProfile = null;
export function setPendingProfile(profile) {
  pendingProfile = profile;
}

// Returns the user's profile. Creates the document on first sight, preferring
// (1) a pending sign-up profile, then (2) a demo default, then (3) a minimal one.
export async function getOrCreateProfile(user) {
  const email = (user.email || '').toLowerCase();
  const fallback =
    pendingProfile || DEFAULTS[email] || { name: email, empId: '', role: 'employee', phone: '' };

  if (!firestore) {
    pendingProfile = null;
    return fallback;
  }

  try {
    const ref = doc(firestore, 'employees', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      pendingProfile = null;
      return snap.data();
    }
    // First time we've seen this user → create their profile document from
    // whatever they entered at sign-up. The admin sets their route / shift /
    // working days afterwards in the Shift Roster screen. We stamp createdAt
    // server-side but keep it off the returned object (it's a write-only
    // sentinel — no screen reads it).
    const data = { ...fallback, email };
    await setDoc(ref, { ...data, createdAt: serverTimestamp() });
    pendingProfile = null;
    return data;
  } catch (e) {
    console.warn('[profile] Firestore not ready — using fallback profile:', e.message);
    pendingProfile = null;
    return fallback;
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

// Admin links a driver to a cab (writes cabId on the driver's profile).
export function assignCabToDriver(driverUid, cabId) {
  return updateDoc(doc(firestore, 'employees', driverUid), { cabId });
}

// An employee saves their home/pickup location on their own profile.
// home = { latitude, longitude, label }
export function updateHomeLocation(uid, home) {
  return updateDoc(doc(firestore, 'employees', uid), { home });
}

// A user edits their own basic details (name, employee id, phone). Only the
// provided fields are written. Used to fill in profiles that were created
// without an Employee ID (e.g. accounts made outside the sign-up form).
// setDoc(merge) creates the document if it doesn't exist yet, so this never
// fails with "no document to update" for a profile that was never written.
export function updateProfileDetails(uid, fields) {
  return setDoc(doc(firestore, 'employees', uid), fields, { merge: true });
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
// the Firebase console if you also want to revoke their sign-in. Enforced
// admin-only by the security rules.
export function adminDeleteEmployee(uid) {
  return deleteDoc(doc(firestore, 'employees', uid));
}

// Admin creates a brand-new employee LOGIN + profile in one step.
//
// Firebase's client SDK signs a newly-created user into the CURRENT app, which
// would kick the admin out. To avoid that we create the account on a throwaway
// SECONDARY Firebase app, then sign that secondary app out — the admin's
// primary session is never touched. The profile document is written through the
// primary (admin) connection, so the security rules authorise it as an admin.
const PROVISIONER_APP = 'employee-provisioner';
export async function adminCreateEmployeeAccount({ email, password, profile }) {
  if (!firestore) throw new Error('Backend not configured.');
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
      role: 'employee',
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
// employee's `worksWeekends` / `shiftRoster` up to date after the admin edits
// them — no re-login needed. Returns an unsubscribe function.
export function subscribeProfile(uid, cb, onError) {
  if (!firestore) return () => {};
  return onSnapshot(
    doc(firestore, 'employees', uid),
    (snap) => {
      if (snap.exists()) cb(snap.data());
    },
    onError
  );
}
