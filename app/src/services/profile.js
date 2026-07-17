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
  doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot,
} from 'firebase/firestore';
import { firestore } from './firebase';

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
    // First time we've seen this user → create their profile document.
    const data = { ...fallback, email };
    await setDoc(ref, data);
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
