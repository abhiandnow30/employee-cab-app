// ---------------------------------------------------------------------------
// APP CONTEXT  (shared state for the whole app)
//
// Auth comes from Firebase Authentication; bookings, feedback and ratings all
// live in Cloud Firestore (so they persist across refreshes and sync between
// the employee and the admin in real time).
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useState, useEffect } from 'react';
import { cabs as initialCabs } from '../data/mockData';
import {
  watchAuth, signIn, signUp, signOutUser, friendlyAuthError, changePassword as changePasswordSvc,
} from '../services/auth';
import {
  getOrCreateProfile, setPendingProfile, ADMIN_SIGNUP_CODE, updateHomeLocation,
  updateProfileDetails, subscribeProfile,
} from '../services/profile';
import {
  createBooking,
  createBookings,
  assignCabToBooking,
  assignCabToBookings,
  setBookingStatus,
  markBookingNoShow,
  requestCancelBooking,
  resolveCancelRequest,
  subscribeMyBookings,
  subscribeAllBookings,
  subscribeCabBookings,
} from '../services/bookings';
import { addFeedbackDoc, addRatingDoc } from '../services/feedback';
import { subscribeCabs, addCab, updateCab, removeCab, seedDefaultCabs } from '../services/cabs';
import { subscribeTimings, saveTimings as saveTimingsSvc, DEFAULT_TIMINGS } from '../services/settings';
import { firestore } from '../services/firebase';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase auth user
  const [profile, setProfile] = useState(null); // employee profile from Firestore
  const [authReady, setAuthReady] = useState(false); // false until first auth check
  const [bookings, setBookings] = useState([]); // filled live from Firestore
  const [fleetCabs, setFleetCabs] = useState([]); // live fleet from Firestore
  const [timings, setTimings] = useState(DEFAULT_TIMINGS); // Weekly Schedule pickup/drop options
  // Use the managed fleet once it has cabs; until then fall back to the starter
  // list so the app still works before the admin seeds/adds cabs.
  const cabs = fleetCabs.length ? fleetCabs : initialCabs;

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
      }
      setAuthReady(true); // first auth check is done — safe to render
    });
    return unsub;
  }, []);

  // Keep the signed-in user's profile live: if the admin edits this employee's
  // shift roster / working days, their app reflects it without a re-login.
  useEffect(() => {
    if (!firebaseUser || !firestore) return;
    return subscribeProfile(
      firebaseUser.uid,
      (p) => setProfile((prev) => ({ ...(prev || {}), ...p })),
      (e) => console.warn('[profile] subscription error:', e.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]);

  // Signed in once we have both the Firebase user and their profile.
  const currentUser =
    firebaseUser && profile
      ? { id: firebaseUser.uid, uid: firebaseUser.uid, email: firebaseUser.email, ...profile }
      : null;

  // Sign in with email + password. Firebase validates the credentials against
  // its user store; on success the auth listener above loads the profile and
  // the app unlocks automatically.
  async function login(email, password) {
    try {
      await signIn(email, password);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Create a new account. `form` = { role, name, email, password, confirm,
  // empId?, phone?, cabId?, adminCode? }. On success the auth listener loads the
  // new profile and the app unlocks automatically.
  async function signup(form) {
    const role = form.role || 'employee';
    const name = (form.name || '').trim();
    const email = (form.email || '').trim();

    // --- Validation ---
    if (!name || !email || !form.password) {
      return { ok: false, message: 'Please fill in all required fields.' };
    }
    if (form.password.length < 6) {
      return { ok: false, message: 'Password must be at least 6 characters.' };
    }
    if (form.password !== form.confirm) {
      return { ok: false, message: 'Passwords do not match.' };
    }
    if (role === 'admin' && form.adminCode !== ADMIN_SIGNUP_CODE) {
      return { ok: false, message: 'Invalid admin code.' };
    }
    if ((role === 'employee' || role === 'admin') && !(form.empId || '').trim()) {
      return { ok: false, message: 'Please enter your Employee ID.' };
    }
    if (role === 'employee' && !(form.address || '').trim()) {
      return { ok: false, message: 'Please enter your address.' };
    }

    // Build the profile that getOrCreateProfile() will save for this new user.
    // A driver starts with NO cab — the admin assigns one afterward (cabId: null).
    // Employees also store their home address (used by the admin for pickup).
    const profileData =
      role === 'driver'
        ? { role, name, phone: (form.phone || '').trim(), cabId: null, empId: '' }
        : {
            role,
            name,
            empId: (form.empId || '').trim(),
            phone: (form.phone || '').trim(),
            ...(role === 'employee' ? { address: (form.address || '').trim() } : {}),
          };

    try {
      setPendingProfile(profileData); // picked up when the new user's auth fires
      await signUp(email, form.password);
      return { ok: true };
    } catch (e) {
      setPendingProfile(null);
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  async function logout() {
    await signOutUser();
  }

  // Change the signed-in user's password. Returns { ok, message }.
  async function changePassword(currentPassword, newPassword) {
    try {
      await changePasswordSvc(currentPassword, newPassword);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
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
    let unsub;
    if (currentUser.role === 'admin') {
      unsub = subscribeAllBookings(setBookings, onErr);
    } else if (currentUser.role === 'driver') {
      // Drivers see trips assigned to their cab.
      unsub = currentUser.cabId
        ? subscribeCabBookings(currentUser.cabId, setBookings, onErr)
        : (setBookings([]), () => {});
    } else {
      unsub = subscribeMyBookings(currentUser.uid, setBookings, onErr);
    }
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, currentUser?.cabId]);

  // --- Cabs (live fleet from Firestore) -----------------------------------
  useEffect(() => {
    if (!currentUser || !firestore) {
      setFleetCabs([]);
      return;
    }
    return subscribeCabs(setFleetCabs, (e) =>
      console.warn('[cabs] subscription error:', e.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // --- Timings config (admin-editable pickup/drop options, live) ----------
  // Global config, so we subscribe once Firebase is configured. Falls back to
  // DEFAULT_TIMINGS until the admin saves anything.
  useEffect(() => {
    if (!firestore) return;
    return subscribeTimings(setTimings, (e) =>
      console.warn('[timings] subscription error:', e.message)
    );
  }, []);

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

  // Admin assigns one cab to several bookings (carpool grouping).
  async function assignCabToGroup(bookingIds, cabId) {
    return assignCabToBookings(bookingIds, cabId);
  }

  // Employee cancels a booking → "Cancelled" (kept for history). Used internally
  // by the weekly-roster editor to drop/replace roster entries directly.
  async function cancelBooking(bookingId) {
    return setBookingStatus(bookingId, 'Cancelled');
  }

  // Employee raises a cancellation request (subject to the 4-hour cutoff, which
  // the Trip Cancel screen enforces). The ride stays active until the admin acts.
  async function requestCancel(bookingId, reason) {
    return requestCancelBooking(bookingId, reason);
  }

  // Admin accepts a cancellation request → the ride is Cancelled.
  async function approveCancel(bookingId) {
    return resolveCancelRequest(bookingId, true);
  }

  // Admin declines a cancellation request → the ride stays on.
  async function rejectCancel(bookingId) {
    return resolveCancelRequest(bookingId, false);
  }

  // Pending cancellation requests (admin view).
  function pendingCancelRequests() {
    return bookings.filter((b) => b.cancelStatus === 'Requested');
  }

  // Driver advances a trip's status (On the way → Arrived → Completed).
  async function updateBookingStatus(bookingId, status) {
    return setBookingStatus(bookingId, status);
  }

  // Driver flags a no-show: reached the pickup but the employee wasn't there.
  // Shows up flagged on the admin's Bookings screen.
  async function markNoShow(bookingId) {
    return markBookingNoShow(bookingId);
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

  // --- Cabs (admin fleet management) --------------------------------------
  async function createCab(data) {
    return addCab(data);
  }
  async function editCab(id, data) {
    return updateCab(id, data);
  }
  async function deleteCab(id) {
    return removeCab(id);
  }
  async function loadDefaultCabs() {
    return seedDefaultCabs();
  }

  // Employee saves their home/pickup location; update Firestore + local profile.
  async function saveHomeLocation(home) {
    if (!currentUser) return;
    await updateHomeLocation(currentUser.uid, home);
    setProfile((p) => ({ ...(p || {}), home }));
  }

  // User edits their own basic details (name, employee id, phone). Persists to
  // Firestore and updates the local profile so the change shows immediately.
  async function saveProfileDetails(fields) {
    if (!currentUser) return;
    if (firestore) await updateProfileDetails(currentUser.uid, fields);
    setProfile((p) => ({ ...(p || {}), ...fields }));
  }

  // Admin saves the edited Weekly Schedule timings. `pickupTimes` / `dropTimes`
  // are arrays of "hh:mm AM/PM" strings (no "NA"). The live subscription above
  // then pushes the new lists to every screen. Returns { ok, message }.
  async function saveTimings(next) {
    try {
      await saveTimingsSvc(next);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
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
    signup,
    logout,
    changePassword,
    bookings,
    cabs,
    pickupTimes: timings.pickupTimes,
    dropTimes: timings.dropTimes,
    saveTimings,
    addBooking,
    addBookings,
    assignCab,
    assignCabToGroup,
    cancelBooking,
    requestCancel,
    approveCancel,
    rejectCancel,
    pendingCancelRequests,
    updateBookingStatus,
    markNoShow,
    createCab,
    editCab,
    deleteCab,
    loadDefaultCabs,
    saveHomeLocation,
    saveProfileDetails,
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
