// ---------------------------------------------------------------------------
// APP CONTEXT  (shared state for the whole app)
//
// This is a small in-memory "store" so different screens share the same data.
// Example: when an employee creates a booking, the admin's list updates too,
// because both read from here.
//
// It lives only in memory, so it resets when you reload the app. That's fine
// for a mock front-end. Real persistence comes with the backend + database.
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useState, useEffect } from 'react';
import { cabs as initialCabs, initialBookings } from '../data/mockData';
import { watchAuth, signIn, signOutUser, friendlyAuthError } from '../services/auth';
import { getOrCreateProfile } from '../services/profile';

const AppContext = createContext(null);

// A tiny id generator for new bookings (b2, b3, ...). Good enough for a demo.
let bookingCounter = initialBookings.length;
function nextBookingId() {
  bookingCounter += 1;
  return 'b' + bookingCounter;
}

export function AppProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase auth user
  const [profile, setProfile] = useState(null); // employee profile from Firestore
  const [awaitingOtp, setAwaitingOtp] = useState(false); // gate the OTP step
  const [bookings, setBookings] = useState(initialBookings);
  const [cabs] = useState(initialCabs);
  const [feedbacks, setFeedbacks] = useState([]);
  const [ratings, setRatings] = useState([]);

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

  // --- Bookings -----------------------------------------------------------
  // Fills in the fields every booking needs, then lets `data` add/override
  // the rest (date, shift, direction, source, reason, comment, ...).
  function buildBooking(data) {
    return {
      id: nextBookingId(),
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      status: 'Booked',
      assignedCabId: null,
      ...data,
    };
  }

  // Employee creates a single booking (used by the Ad-hoc request page).
  function addBooking(data) {
    const newBooking = buildBooking(data);
    setBookings((prev) => [newBooking, ...prev]);
    return newBooking;
  }

  // Create several bookings at once (used by the weekly Self Roster).
  function addBookings(entries) {
    const created = entries.map((e) => buildBooking(e));
    setBookings((prev) => [...created, ...prev]);
    return created;
  }

  // Admin assigns a cab to a booking. It moves to "Cab assigned".
  function assignCab(bookingId, cabId) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId ? { ...b, assignedCabId: cabId, status: 'Cab assigned' } : b
      )
    );
  }

  // Employee cancels a booking. It moves to "Cancelled" (kept for history).
  // This one change is reflected everywhere the booking is shown.
  function cancelBooking(bookingId) {
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status: 'Cancelled' } : b))
    );
  }

  // Employee feedback (kept in memory for the demo).
  function addFeedback({ category, message }) {
    setFeedbacks((prev) => [
      { id: 'f' + (prev.length + 1), employeeName: currentUser.name, category, message },
      ...prev,
    ]);
  }

  // Employee rating (1–5 stars + optional comment).
  function addRating({ stars, comment }) {
    setRatings((prev) => [
      { id: 'r' + (prev.length + 1), employeeName: currentUser.name, stars, comment },
      ...prev,
    ]);
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
    feedbacks,
    addFeedback,
    ratings,
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
