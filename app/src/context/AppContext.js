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

  // --- Auth ---------------------------------------------------------------
  // Returns { ok: true } on success, or { ok: false, message } on failure.
  function login(email, password) {
    const user = employees.find(
      (e) => e.email.toLowerCase() === email.trim().toLowerCase() && e.password === password
    );
    if (!user) {
      return { ok: false, message: 'Wrong email or password.' };
    }
    setCurrentUser(user);
    return { ok: true };
  }

  function logout() {
    setCurrentUser(null);
  }

  // --- Bookings -----------------------------------------------------------
  // Employee creates a new booking. It starts in the "Booked" state.
  function addBooking({ date, shift, direction, pickup }) {
    const newBooking = {
      id: nextBookingId(),
      employeeId: currentUser.id,
      employeeName: currentUser.name,
      date,
      shift,
      direction,
      pickup,
      status: 'Booked',
      assignedCabId: null,
    };
    setBookings((prev) => [newBooking, ...prev]);
    return newBooking;
  }

  // Admin assigns a cab to a booking. It moves to "Cab assigned".
  function assignCab(bookingId, cabId) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id === bookingId ? { ...b, assignedCabId: cabId, status: 'Cab assigned' } : b
      )
    );
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
    logout,
    bookings,
    cabs,
    addBooking,
    assignCab,
    getCabById,
    myBookings,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Small hook so screens can do:  const { login } = useApp();
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
