// ---------------------------------------------------------------------------
// RIDE-START OTP
//
// The six digits the rider reads out when the cab pulls up, and the driver types
// in to move the trip to "On board". It is the only proof the system has that a
// person actually got into the vehicle — every other signal on a trip is the
// driver's own tap.
//
// WHY THE CODE LIVES IN A SUBCOLLECTION AND NOT ON THE BOOKING
//
// The assigned cab's driver is allowed to READ the whole booking document (see
// the `bookings` read rule), and Firestore has no field-level read security. So a
// `startOtp` field on the booking would be plainly visible to the one person the
// code exists to test. It lives here instead:
//
//     bookings/<id>              ← the driver reads this
//     bookings/<id>/private/otp  ← the rider and the desk read this; NOT the driver
//
// The check still happens server-side with no server involved: `get()` inside
// firestore.rules runs with full privileges, independent of what the caller may
// read. So the rule can compare the driver's typed attempt against a document the
// driver cannot open. That is what makes this enforcement rather than decoration,
// on a project with no Cloud Functions and no Blaze plan.
//
// The code is issued by the DESK, in the same atomic write that assigns the cab
// (see services/bookings.js) — a ride can never have a cab without a code. Re-
// assigning a ride to another cab re-issues it, so a code overheard on the first
// cab is dead by the time the second one arrives.
// ---------------------------------------------------------------------------

import { doc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import * as Crypto from 'expo-crypto';
import { firestore } from './firebase';
import { RIDE_OTP_LENGTH } from '../data/mockData';

// One fixed document id, so the rules and every reader agree on the path without
// having to list a subcollection.
const PRIVATE = 'private';
const OTP_DOC = 'otp';

// bookings/<bookingId>/private/otp
export function rideOtpRef(bookingId) {
  return doc(firestore, 'bookings', bookingId, PRIVATE, OTP_DOC);
}

// A fresh code. `expo-crypto` is used rather than Math.random() because this
// value is a credential — Math.random() is seeded predictably enough that a
// stream of codes issued in one session can be reproduced.
//
// Bytes of 250 and above are THROWN AWAY rather than folded in with `% 10`.
// 256 isn't a multiple of 10, so a plain modulo would make the digits 0-5 turn up
// slightly more often than 6-9 — a small bias, but it is free to avoid: 250 is
// 25×10, so every byte below it maps to a digit uniformly.
export function generateRideOtp(length = RIDE_OTP_LENGTH) {
  const digits = [];
  while (digits.length < length) {
    // Over-draw so the common case takes a single call into native crypto.
    const bytes = Crypto.getRandomBytes(length * 2);
    for (let i = 0; i < bytes.length && digits.length < length; i += 1) {
      if (bytes[i] < 250) digits.push(bytes[i] % 10);
    }
  }
  return digits.join('');
}

// What the desk writes when it assigns a cab. Kept here (rather than inline in
// bookings.js) so the shape the rules read is defined in exactly one place.
export function rideOtpPayload() {
  return { code: generateRideOtp(), issuedAt: serverTimestamp() };
}

// Add the code to a batch/transaction that is already assigning a cab. Takes the
// writer so it works with both writeBatch() and runTransaction() — they share the
// `.set(ref, data)` shape. Issuing the code in the SAME commit as the assignment
// is what stops a ride existing with a cab and no code (which the rules would
// then have to wave through).
export function issueRideOtp(writer, bookingId) {
  writer.set(rideOtpRef(bookingId), rideOtpPayload());
}

// One-off read of a ride's code. Returns null when there isn't one — a ride
// assigned before this feature shipped, or one with no cab yet.
export async function getRideOtp(bookingId) {
  if (!firestore || !bookingId) return null;
  const snap = await getDoc(rideOtpRef(bookingId));
  return snap.exists() ? snap.data()?.code || null : null;
}

// Live version, for the rider's own screen: a re-assignment re-issues the code,
// and someone standing at the kerb reading out a stale one is exactly the
// confusion this avoids. Returns an unsubscribe function.
//
// The error callback matters more than usual here: a driver's session reaching
// this path gets permission-denied by design, and swallowing that silently would
// leave a blank space where a code should be.
export function subscribeRideOtp(bookingId, cb, onError) {
  if (!firestore || !bookingId) return () => {};
  return onSnapshot(
    rideOtpRef(bookingId),
    (snap) => cb(snap.exists() ? snap.data()?.code || null : null),
    onError
  );
}
