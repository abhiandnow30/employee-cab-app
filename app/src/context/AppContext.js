// ---------------------------------------------------------------------------
// APP CONTEXT  (shared state for the whole app)
//
// Auth comes from Firebase Authentication; bookings, feedback and ratings all
// live in Cloud Firestore (so they persist across refreshes and sync between
// the employee and the admin in real time).
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useState, useEffect } from 'react';
import { cabs as initialCabs } from '../data/mockData';
import { watchAuth, signIn, signOutUser, friendlyAuthError } from '../services/auth';
import { getOrCreateProfile } from '../services/profile';
import {
  createBooking,
  createBookings,
  assignCabToBooking,
  setBookingStatus,
  subscribeMyBookings,
  subscribeAllBookings,
} from '../services/bookings';
import { addFeedbackDoc, addRatingDoc } from '../services/feedback';
import { firestore } from '../services/firebase';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase auth user
  const [profile, setProfile] = useState(null); // employee profile from Firestore
  const [awaitingOtp, setAwaitingOtp] = useState(false); // gate the OTP step
  const [authReady, setAuthReady] = useState(false); // false until first auth check
  const [bookings, setBookings] = useState([]); // filled live from Firestore
  const [cabs] = useState(initialCabs);

  // --- Auth ---------------------------------------------------------------
  // Watch Firebase login state and load the profile when signed in.
  useEffect(() => {
    const unsub = watchAuth(async (user) => {
      setFirebaseUser(user);
      if (user) {
        const p = await getOrCreateProfile(user);
        setProfile(p);
      } else {
        setProfile(null);
        setAwaitingOtp(false);
      }
      setAuthReady(true); // first auth check is done — safe to render
    });
    return unsub;
  }, []);

  // The app treats you as logged in only once you're signed in AND past the OTP
  // gate. A refreshed/restored session has awaitingOtp=false, so it skips OTP.
  const currentUser =
    firebaseUser && profile && !awaitingOtp
      ? { id: firebaseUser.uid, uid: firebaseUser.uid, email: firebaseUser.email, ...profile }
      : null;

  // Step 1: verify email + password with Firebase. On success we still require
  // the OTP step (a demo gate) before the app unlocks.
  async function login(email, password) {
    try {
      await signIn(email, password);
      setAwaitingOtp(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Step 2: OTP confirmed → unlock the app.
  function confirmOtp() {
    setAwaitingOtp(false);
  }

  async function logout() {
    await signOutUser();
    setAwaitingOtp(false);
  }

  // --- Bookings (live from Firestore) -------------------------------------
  // Subscribe to bookings for the signed-in user: employees see their own,
  // the admin sees all. The list updates automatically on any change.
  useEffect(() => {
    if (!currentUser || !firestore) {
      setBookings([]);
      return;
    }
    const onErr = (e) =>
      console.warn('[bookings] Firestore subscription error:', e.message);
    const unsub =
      currentUser.role === 'admin'
        ? subscribeAllBookings(setBookings, onErr)
        : subscribeMyBookings(currentUser.uid, setBookings, onErr);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // The fields every new booking needs; `data` fills in the rest.
  function newBookingPayload(data) {
    return {
      employeeId: currentUser.uid,
      employeeName: currentUser.name,
      status: 'Booked',
      assignedCabId: null,
      ...data,
    };
  }

  // Employee creates a single booking (Ad-hoc page). Saved to Firestore;
  // the live subscription then shows it.
  async function addBooking(data) {
    return createBooking(newBookingPayload(data));
  }

  // Create several bookings at once (weekly Self Roster).
  async function addBookings(entries) {
    return createBookings(entries.map((e) => newBookingPayload(e)));
  }

  // Admin assigns a cab → booking moves to "Cab assigned".
  async function assignCab(bookingId, cabId) {
    return assignCabToBooking(bookingId, cabId);
  }

  // Employee cancels a booking → "Cancelled" (kept for history).
  async function cancelBooking(bookingId) {
    return setBookingStatus(bookingId, 'Cancelled');
  }

  // Employee feedback → Firestore.
  async function addFeedback({ category, message }) {
    return addFeedbackDoc({
      employeeId: currentUser.uid,
      employeeName: currentUser.name,
      category,
      message,
    });
  }

  // Employee rating (1–5 stars + optional comment) → Firestore.
  async function addRating({ stars, comment }) {
    return addRatingDoc({
      employeeId: currentUser.uid,
      employeeName: currentUser.name,
      stars,
      comment,
    });
  }

  // My bookings that are still active (not cancelled) — for View Roster & Trip Cancel.
  function myActiveBookings() {
    return myBookings().filter((b) => b.status !== 'Cancelled');
  }

  // Helpers used by screens.
  function getCabById(cabId) {
    return cabs.find((c) => c.id === cabId) || null;
  }

  // Only the logged-in employee's own bookings (for "My Rides").
  function myBookings() {
    if (!currentUser) return [];
    return bookings.filter((b) => b.employeeId === currentUser.id);
  }

  const value = {
    currentUser,
    authReady,
    login,
    confirmOtp,
    logout,
    bookings,
    cabs,
    addBooking,
    addBookings,
    assignCab,
    cancelBooking,
    getCabById,
    myBookings,
    myActiveBookings,
    addFeedback,
    addRating,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Small hook so screens can do:  const { login } = useApp();
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
