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
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  EmailAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithCredential,
  linkWithPopup,
  linkWithCredential,
  unlink,
} from 'firebase/auth';
import { auth } from './firebase';

// --- Microsoft (Entra ID / Azure AD) sign-in --------------------------------
// Company work accounts only — see the tenant id below. Added ALONGSIDE
// email/password, never replacing it: an employee's Firebase account (and
// their employees/{uid} profile) is always created by the admin first with
// email/password; Microsoft is an extra credential linked onto that SAME
// account afterward (see linkMicrosoftPopup/linkMicrosoftCredential), so
// linking never changes the uid a profile is keyed to.
//
// EXPO_PUBLIC_MICROSOFT_TENANT_ID is your Microsoft Entra tenant id (a GUID
// or your verified domain, e.g. "cloudfuze.onmicrosoft.com") — NOT a secret,
// same as the Google Maps key in .env. Restricting to one tenant (rather than
// 'common') means only accounts inside your own company directory can even
// attempt to sign in.
const MICROSOFT_TENANT_ID = process.env.EXPO_PUBLIC_MICROSOFT_TENANT_ID || 'common';

function microsoftProvider() {
  const provider = new OAuthProvider('microsoft.com');
  provider.setCustomParameters({ tenant: MICROSOFT_TENANT_ID });
  return provider;
}

// WEB ONLY — a plain popup Firebase drives entirely itself. Phones have no
// popup; see the *Credential variants below, used with useMicrosoftAuthRequest.
export function signInWithMicrosoftPopup() {
  return signInWithPopup(auth, microsoftProvider());
}

export function linkMicrosoftPopup() {
  const user = auth?.currentUser;
  if (!user) throw new Error('You are not signed in.');
  return linkWithPopup(user, microsoftProvider());
}

// NATIVE — built from the id_token (and the raw nonce that hashed into the
// request) that useMicrosoftAuthRequest got back from the system browser.
function microsoftCredential(idToken, rawNonce) {
  return new OAuthProvider('microsoft.com').credential({ idToken, rawNonce });
}

export function signInWithMicrosoftCredential(idToken, rawNonce) {
  return signInWithCredential(auth, microsoftCredential(idToken, rawNonce));
}

export function linkMicrosoftCredential(idToken, rawNonce) {
  const user = auth?.currentUser;
  if (!user) throw new Error('You are not signed in.');
  return linkWithCredential(user, microsoftCredential(idToken, rawNonce));
}

export function unlinkMicrosoft() {
  const user = auth?.currentUser;
  if (!user) throw new Error('You are not signed in.');
  return unlink(user, 'microsoft.com');
}

// Reads the linked-providers list Firebase already tracks on the user object
// — no extra Firestore field needed, this is exactly what Firebase itself
// checks before allowing a second credential of the same type to link.
export function isMicrosoftLinked(firebaseUser) {
  return !!firebaseUser?.providerData?.some((p) => p.providerId === 'microsoft.com');
}

export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

// Send a password-reset email. Firebase mails a secure link the user follows to
// set a new password — we never see or handle the password ourselves.
export function sendPasswordReset(email) {
  if (!auth) throw new Error('Backend not configured.');
  return sendPasswordResetEmail(auth, email.trim());
}

// Create a brand-new account (used by Sign Up). Firebase stores the password
// securely and signs the new user in automatically.
export function signUp(email, password) {
  return createUserWithEmailAndPassword(auth, email.trim(), password);
}

export function signOutUser() {
  if (!auth) return Promise.resolve();
  return signOut(auth);
}

// Change the signed-in user's password. Firebase requires a recent login, so we
// re-verify the current password first, then set the new one.
export async function changePassword(currentPassword, newPassword) {
  const user = auth?.currentUser;
  if (!user) throw new Error('You are not signed in.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred); // proves the current password
  await updatePassword(user, newPassword);
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
      // Firebase throws this SAME code for any disabled sign-in method, not
      // just email/password — Microsoft included. A generic message here
      // avoids blaming the wrong provider (this one used to always say
      // "Email/password", which was actively misleading while debugging a
      // Microsoft-specific config issue).
      return 'This sign-in method is not enabled in Firebase yet.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak — use at least 6 characters.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return ''; // the person just closed the popup — not a real error
    case 'auth/credential-already-in-use':
      return 'That Microsoft account is already linked to a different employee.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists for that email with a different sign-in method.';
    case 'auth/provider-already-linked':
      return 'A Microsoft account is already linked to this profile.';
    default:
      return e?.message || 'Could not sign in. Please try again.';
  }
}
