// ---------------------------------------------------------------------------
// PROFILE SERVICE
// An employee's profile (name, employee id, role, phone) lives in Firestore at
// employees/<uid>. On first login we create it from the defaults below.
// NOTE: no passwords are ever stored here — Firebase Auth handles those.
// ---------------------------------------------------------------------------

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestore } from './firebase';

// Seed profiles for the demo accounts (used the first time each logs in).
const DEFAULTS = {
  'employee@demo.com': { name: 'Abhilasha K', empId: '1399', role: 'employee', phone: '9000000001' },
  'admin@demo.com': { name: 'Transport Desk', empId: '900000001', role: 'admin', phone: '9000000002' },
};

// Returns the employee's profile. If Firestore isn't ready yet, falls back to
// the code defaults so login still works during setup.
export async function getOrCreateProfile(user) {
  const email = (user.email || '').toLowerCase();
  const fallback = DEFAULTS[email] || { name: email, empId: '', role: 'employee', phone: '' };

  if (!firestore) return fallback;

  try {
    const ref = doc(firestore, 'employees', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    // First login for this user → create their profile document.
    await setDoc(ref, { ...fallback, email });
    return fallback;
  } catch (e) {
    console.warn('[profile] Firestore not ready — using default profile:', e.message);
    return fallback;
  }
}
