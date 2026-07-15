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

import React, { createContext, useContext, useState } from 'react';
import { employees, cabs as initialCabs, initialBookings } from '../data/mockData';

const AppContext = createContext(null);

// A tiny id generator for new bookings (b2, b3, ...). Good enough for a demo.
let bookingCounter = initialBookings.length;
function nextBookingId() {
  bookingCounter += 1;
  return 'b' + bookingCounter;
}

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null); // null = logged out
  const [bookings, setBookings] = useState(initialBookings);
  const [cabs] = useState(initialCabs);
  const [feedbacks, setFeedbacks] = useState([]);
  const [ratings, setRatings] = useState([]);

  // --- Auth ---------------------------------------------------------------
  // Step 1: check email + password. Does NOT log the user in yet — the OTP
  // screen does that. Returns { ok, message?, user? }.
  function verifyCredentials(email, password) {
    const user = employees.find(
      (e) => e.email.toLowerCase() === email.trim().toLowerCase() && e.password === password
    );
    if (!user) {
      return { ok: false, message: 'Wrong email or password.' };
    }
    return { ok: true, user };
  }

  // Step 2 (after OTP is confirmed): actually log the user in by email.
  function signInByEmail(email) {
    const user = employees.find(
      (e) => e.email.toLowerCase() === email.trim().toLowerCase()
    );
    if (user) setCurrentUser(user);
    return !!user;
  }

  function logout() {
    setCurrentUser(null);
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
    verifyCredentials,
    signInByEmail,
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
