// ---------------------------------------------------------------------------
// AUTH SERVICE
// Thin wrapper around Firebase Authentication (email/password).
//   • signIn        — verify email + password
//   • signOutUser   — sign out
//   • watchAuth     — get notified whenever the login state changes
// Firebase securely stores & checks the passwords; we never see them.
// ---------------------------------------------------------------------------

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth } from './firebase';

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export function signOutUser() {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

// Calls `callback(user | null)` now and on every future login/logout.
// Returns an unsubscribe function.
export function watchAuth(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

// Turn Firebase error codes into friendly messages for the UI.
export function friendlyAuthError(e) {
  switch (e?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled in Firebase yet.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return e?.message || 'Could not sign in. Please try again.';
  }
}
