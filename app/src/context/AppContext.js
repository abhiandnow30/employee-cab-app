// ---------------------------------------------------------------------------
// APP CONTEXT  (shared state for the whole app)
//
// Auth comes from Firebase Authentication; bookings, feedback and ratings all
// live in Cloud Firestore (so they persist across refreshes and sync between
// the employee and the admin in real time).
//
// Every action here returns { ok, message? } and AWAITS its write. Nothing is
// fire-and-forget: a screen must never be able to say "saved ✓" for a write
// that failed.
// ---------------------------------------------------------------------------

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import { cabs as initialCabs, STATUS, CANCEL_STATUS, CANCEL_CUTOFF_HOURS } from '../data/mockData';
import {
  watchAuth, signIn, signUp, signOutUser, friendlyAuthError,
  changePassword as changePasswordSvc, sendPasswordReset,
} from '../services/auth';
import {
  getOrCreateProfile, setPendingProfile, subscribeProfile, adminUpdateEmployee,
  adminCreateAccount, adminDeleteEmployee,
} from '../services/profile';
import {
  createAddressChangeRequest, subscribeMyAddressRequests,
} from '../services/addressRequests';
import { createMessage } from '../services/messages';
import {
  createBooking,
  applyRosterChanges,
  assignCabToBooking,
  assignCabToBookings,
  setBookingStatus,
  markBookingNoShow,
  requestCancelBooking,
  resolveCancelRequest,
  subscribeMyBookings,
  subscribeAllBookings,
  subscribeCabBookings,
  ridesSharingCab,
  conflictingRide,
  syncEmployeeAddress,
} from '../services/bookings';
import { addFeedbackDoc, addRatingDoc } from '../services/feedback';
import { updateMyLocation, clearMyLocation } from '../services/tracking';
import {
  subscribeCabs, addCab, updateCab, removeCabSafely, seedDefaultCabs, cabCapacity,
} from '../services/cabs';
import { subscribeTimings, saveTimings as saveTimingsSvc, DEFAULT_TIMINGS } from '../services/settings';
import { firestore } from '../services/firebase';
import { toDateTime, isBookingPast, canRequestCancel, todayKey } from '../utils/datetime';

const AppContext = createContext(null);

// Turn any thrown error into the { ok, message } shape every screen expects.
// Firestore permission failures are the common case and their raw text is
// unhelpful, so they get a plain-English message.
function failure(e, fallback) {
  const raw = e?.message || '';
  if (e?.code === 'permission-denied' || /insufficient permissions/i.test(raw)) {
    return { ok: false, message: fallback || "You don't have permission to do that." };
  }
  return { ok: false, message: raw || fallback || 'Something went wrong. Please try again.' };
}

export function AppProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase auth user
  const [profile, setProfile] = useState(null); // employee profile from Firestore
  const [authReady, setAuthReady] = useState(false); // false until first auth check
  // True when someone is signed in but has NO profile document — an account that
  // was never provisioned, or one an admin removed. They get a locked-out screen
  // instead of a silently-recreated employee profile.
  const [profileMissing, setProfileMissing] = useState(false);
  const [bookings, setBookings] = useState([]); // filled live from Firestore
  const [fleetCabs, setFleetCabs] = useState([]); // live fleet from Firestore
  const [timings, setTimings] = useState(DEFAULT_TIMINGS); // Weekly Schedule pickup/drop options
  const [myAddressRequests, setMyAddressRequests] = useState([]); // employee's own address-change requests (live)
  // Set when a live subscription fails (usually permissions or a dropped
  // connection). Screens would otherwise render a perfectly empty list and look
  // like "you have no rides", so the shell shows this as a banner.
  const [dataError, setDataError] = useState('');
  // Use the managed fleet once it has cabs; until then fall back to the starter
  // list so the app still works before the admin seeds/adds cabs.
  const cabs = fleetCabs.length ? fleetCabs : initialCabs;

  const onSubError = useCallback((what) => (e) => {
    console.warn(`[${what}] subscription error:`, e?.message);
    setDataError(
      e?.code === 'permission-denied'
        ? `Some ${what} could not be loaded — your account may not have access.`
        : `Live updates for ${what} were interrupted. Check your connection.`
    );
  }, []);

  // --- Auth ---------------------------------------------------------------
  // Watch Firebase login state and load the profile when signed in.
  useEffect(() => {
    const unsub = watchAuth(async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const p = await getOrCreateProfile(user);
          setProfile(p || null);
          setProfileMissing(!p);
        } catch (e) {
          console.warn('[profile] could not load profile:', e?.message);
          setProfile(null);
          setProfileMissing(true);
        }
      } else {
        setProfile(null);
        setProfileMissing(false);
        setDataError('');
      }
      setAuthReady(true); // first auth check is done — safe to render
    });
    return unsub;
  }, []);

  // Keep the signed-in user's profile live: if the admin edits this employee's
  // shift roster / working days, their app reflects it without a re-login. If the
  // document disappears (admin removed them) the session locks out immediately.
  useEffect(() => {
    if (!firebaseUser || !firestore) return;
    return subscribeProfile(
      firebaseUser.uid,
      (p) => {
        setProfile((prev) => ({ ...(prev || {}), ...p }));
        setProfileMissing(false);
      },
      (e) => console.warn('[profile] subscription error:', e.message),
      () => {
        setProfile(null);
        setProfileMissing(true);
      }
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

  // Create a new DRIVER account. `form` = { name, email, password, confirm,
  // phone? }. On success the auth listener loads the new profile and the app
  // unlocks automatically.
  //
  // Only drivers can self-register. Employees are provisioned by the transport
  // desk, and admin access is granted in the Firebase console — the security
  // rules enforce both, so there is no client-side "admin code" to leak.
  async function signup(form) {
    const role = form.role || 'driver';
    const name = (form.name || '').trim();
    const email = (form.email || '').trim();

    if (role === 'admin') {
      return {
        ok: false,
        message:
          'Admin accounts are created by your Firebase administrator, not from the app.',
      };
    }
    if (role !== 'driver') {
      return {
        ok: false,
        message: 'Employee accounts are created by your transport admin. Ask them to add you.',
      };
    }

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

    // A driver starts with NO cab — the admin links one afterward (cabId: null).
    const profileData = {
      role: 'driver',
      name,
      phone: (form.phone || '').trim(),
      cabId: null,
      empId: '',
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
    stopSharingLocation();
    await signOutUser();
  }

  // Send a password-reset email to the given address. Returns { ok, message }.
  async function resetPassword(email) {
    const addr = (email || '').trim();
    if (!addr) return { ok: false, message: 'Enter your email first.' };
    try {
      await sendPasswordReset(addr);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
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
    const onErr = onSubError('bookings');
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
    return subscribeCabs(setFleetCabs, onSubError('cabs'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // --- Address change requests (employee's own, live) ---------------------
  // So the employee can see whether each request is Pending / Approved /
  // Rejected (and the reason, if rejected) without a re-login.
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'employee' || !firestore) {
      setMyAddressRequests([]);
      return;
    }
    return subscribeMyAddressRequests(
      currentUser.uid,
      setMyAddressRequests,
      onSubError('address requests')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // --- Timings config (admin-editable pickup/drop options, live) ----------
  // Global config, so we subscribe once Firebase is configured. Falls back to
  // DEFAULT_TIMINGS until the admin saves anything.
  useEffect(() => {
    // Firestore rules require sign-in to read config/timings, so only subscribe
    // once a user is authenticated. Logged out, fall back to DEFAULT_TIMINGS
    // (avoids a guaranteed "Missing or insufficient permissions" on the login
    // screen).
    if (!firestore || !currentUser) {
      setTimings(DEFAULT_TIMINGS);
      return;
    }
    return subscribeTimings(setTimings, onSubError('timings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // --- Live location sharing (driver) -------------------------------------
  // Lifted here (out of the Share Location screen) so it KEEPS RUNNING while the
  // driver navigates the app — the dashboard can then show a truthful "Sharing"
  // indicator. Uses the phone's GPS on native and the browser's location on web.
  //
  // The feed is keyed by the DRIVER'S UID (see services/tracking.js): the
  // database rules only let a driver write their own node, so no one can spoof
  // another cab's position.
  //
  // NOTE: this is foreground sharing (while the app is open). True background
  // sharing (phone locked) needs expo-task-manager + a custom dev build.
  const [sharingLocation, setSharingLocation] = useState(false);
  const [sharingCoords, setSharingCoords] = useState(null);
  const [sharingError, setSharingError] = useState('');
  const locationWatcher = useRef(null);
  const sharingUid = useRef(null);

  function stopSharingLocation() {
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
    // Clear the published position too. Leaving the last fix behind made a
    // parked cab look live to every employee watching it.
    if (sharingUid.current) {
      clearMyLocation(sharingUid.current).catch((e) =>
        console.warn('[tracking] could not clear location:', e?.message)
      );
      sharingUid.current = null;
    }
    setSharingLocation(false);
    setSharingCoords(null);
  }

  // Start streaming this device's location for the driver's cab. Returns
  // { ok, denied?, message? } so the caller can show the right feedback.
  async function startSharingLocation() {
    setSharingError('');
    const uid = currentUser?.uid;
    if (!currentUser?.cabId) {
      const message = 'No cab is linked to your account. Ask the transport desk to link one.';
      setSharingError(message);
      return { ok: false, message };
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setSharingError('Location permission denied.');
      return { ok: false, denied: true };
    }
    try {
      if (locationWatcher.current) locationWatcher.current.remove();
      sharingUid.current = uid;
      locationWatcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
        (loc) => {
          const { latitude, longitude } = loc.coords;
          setSharingCoords({ latitude, longitude });
          updateMyLocation(uid, { latitude, longitude }).catch((e) => {
            // A rejected write means the rules refused it — tell the driver
            // rather than silently pretending to broadcast.
            console.warn('[tracking] location write failed:', e?.message);
            setSharingError('Could not publish your location. Check your connection.');
          });
        }
      );
      setSharingLocation(true);
      return { ok: true };
    } catch (e) {
      sharingUid.current = null;
      const message = e.message || 'Could not start location updates.';
      setSharingError(message);
      return { ok: false, message };
    }
  }

  // Stop sharing automatically if the user logs out or is no longer a driver
  // with a cab — never keep broadcasting for someone who shouldn't be.
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'driver' || !currentUser.cabId) {
      stopSharingLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, currentUser?.cabId]);

  // The fields every new booking needs; `data` fills in the rest.
  // We copy the employee's home address onto the booking ("denormalize") so the
  // driver can navigate to the pickup: Firestore rules let a driver read the
  // booking, but NOT the employee's profile. (When the address later changes,
  // syncEmployeeAddress rewrites these copies on upcoming rides.) We deliberately
  // DO NOT copy the employee's personal phone here — drivers get a central
  // helpline instead, so a rider's private mobile is never exposed in
  // driver-readable data.
  function newBookingPayload(data) {
    // Absolute departure instant, so the backend (Firestore rules) can compare
    // it to server time and block past/too-soon bookings and expired cab
    // assignments — the stored `date`/`shift` strings can't be compared there.
    const departAt = toDateTime(data.date, data.shift); // Date → Firestore Timestamp
    return {
      employeeId: currentUser.uid,
      employeeName: currentUser.name,
      employeeHome: currentUser.home || null, // { latitude, longitude, displayName, ... }
      employeeAddress: currentUser.address || null,
      status: STATUS.BOOKED,
      assignedCabId: null,
      departAt: departAt || null,
      ...data,
    };
  }

  // An active (not cancelled) booking this employee already has for the same
  // date + direction, or null. Stops one ride being requested twice — the
  // duplicate would get its own cab seat.
  function duplicateBooking(date, direction) {
    return (
      myBookings().find(
        (b) => b.date === date && b.direction === direction && b.status !== STATUS.CANCELLED
      ) || null
    );
  }

  // Employee creates a single booking (Ad-hoc page). Saved to Firestore;
  // the live subscription then shows it. Returns { ok, message? }.
  async function addBooking(data) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const clash = duplicateBooking(data.date, data.direction);
    if (clash) {
      return {
        ok: false,
        message: `You already have a ${clash.direction} ride on ${clash.date} (${clash.shift}). Cancel it first if you need a different time.`,
      };
    }
    try {
      await createBooking(newBookingPayload(data));
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not raise the request. Please try again.');
    }
  }

  // Save a whole week of Weekly Schedule edits: `cancelIds` are rides being
  // dropped or replaced, `entries` are the new ones. Both halves go in ONE
  // atomic batch, so a replaced ride can never end up cancelled-but-not-rebooked.
  // Returns { ok, message? }.
  async function saveRosterChanges({ cancelIds = [], entries = [] }) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    try {
      await applyRosterChanges({
        cancelIds,
        create: entries.map((e) => newBookingPayload(e)),
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save your schedule. Please try again.');
    }
  }

  // --- Cab assignment guards ----------------------------------------------

  // Can `cabId` take `newRides` more riders at that date+shift, and is it free?
  // Returns null when fine, or a message explaining why not.
  function cabAssignmentProblem(cabId, rides) {
    const cab = getCabById(cabId);
    if (!cab) return 'That cab is no longer in the fleet.';
    const ids = rides.map((r) => r.id);

    for (const ride of rides) {
      const clash = conflictingRide(
        bookings, cabId, ride.date, ride.shift, ride.direction, ids
      );
      if (clash) {
        return `${cab.cabNumber} is already doing a ${clash.direction} trip at ${ride.shift} on ${ride.date}.`;
      }
    }

    // Group the rides being assigned by date+shift and check each slot's load.
    const slots = {};
    rides.forEach((r) => {
      const key = `${r.date}|${r.shift}`;
      slots[key] = (slots[key] || 0) + 1;
    });
    const seats = cabCapacity(cab);
    for (const key of Object.keys(slots)) {
      const [date, shift] = key.split('|');
      const already = ridesSharingCab(bookings, cabId, date, shift, ids).length;
      const total = already + slots[key];
      if (total > seats) {
        return `${cab.cabNumber} seats ${seats}. That slot (${shift} on ${date}) would have ${total} riders.`;
      }
    }
    return null;
  }

  // Admin assigns a cab → booking moves to "Cab assigned".
  // Guards: the ride must not be in the past, the cab must have a free seat, and
  // it must not already be doing a different trip at that time. These run even
  // if the UI is bypassed, since every assign goes through here.
  async function assignCab(bookingId, cabId) {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return { ok: false, message: 'That booking no longer exists.' };
    if (isBookingPast(b)) {
      return { ok: false, message: 'This ride is in the past — assignment is closed.' };
    }
    const problem = cabAssignmentProblem(cabId, [b]);
    if (problem) return { ok: false, message: problem };
    try {
      await assignCabToBooking(bookingId, cabId);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not assign the cab.');
    }
  }

  // Admin assigns one cab to several bookings (carpool grouping). Rejects the
  // whole batch if ANY selected ride is already in the past, or if the cab
  // doesn't have room for everyone.
  async function assignCabToGroup(bookingIds, cabId) {
    const rides = bookingIds.map((id) => bookings.find((x) => x.id === id)).filter(Boolean);
    if (rides.length !== bookingIds.length) {
      return { ok: false, message: 'Some selected bookings no longer exist. Refresh and retry.' };
    }
    const pastCount = rides.filter(isBookingPast).length;
    if (pastCount > 0) {
      return {
        ok: false,
        message: `${pastCount} selected ride${pastCount > 1 ? 's are' : ' is'} in the past — assignment is closed.`,
      };
    }
    const problem = cabAssignmentProblem(cabId, rides);
    if (problem) return { ok: false, message: problem };
    try {
      await assignCabToBookings(bookingIds, cabId);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not assign the cab.');
    }
  }

  // Employee drops a ride straight from the Weekly Schedule. Only allowed while
  // the ride is outside the cancellation window and no cab has been sent — once
  // either is true it must go through requestCancel() so the transport desk can
  // approve it (a cab is already committed to the trip).
  // Returns { ok, message? }.
  async function cancelBooking(bookingId) {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return { ok: false, message: 'That booking no longer exists.' };
    const problem = dropRideProblem(b);
    if (problem) return { ok: false, message: problem };
    try {
      await setBookingStatus(bookingId, STATUS.CANCELLED);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not cancel that ride.');
    }
  }

  // Why this ride can't just be dropped, or null if it can be.
  function dropRideProblem(b) {
    if (b.status === STATUS.CANCELLED) return null; // already gone — no-op
    if (b.assignedCabId) {
      return 'A cab has already been assigned to this ride. Use Trip Cancel to request a cancellation.';
    }
    if (!canRequestCancel(b.date, b.shift, CANCEL_CUTOFF_HOURS)) {
      return `Rides can only be changed here up to ${CANCEL_CUTOFF_HOURS} hours before pickup. Use Trip Cancel to request a cancellation.`;
    }
    return null;
  }

  // Employee raises a cancellation request (subject to the 4-hour cutoff, which
  // the Trip Cancel screen enforces). The ride stays active until the admin acts.
  async function requestCancel(bookingId, reason) {
    const b = bookings.find((x) => x.id === bookingId);
    if (b && !canRequestCancel(b.date, b.shift, CANCEL_CUTOFF_HOURS)) {
      return {
        ok: false,
        message: `Cancellation closed — requests must be raised at least ${CANCEL_CUTOFF_HOURS} hours before pickup. Please call the transport desk.`,
      };
    }
    try {
      await requestCancelBooking(bookingId, reason);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not send your cancellation request.');
    }
  }

  // Admin accepts a cancellation request → the ride is Cancelled.
  async function approveCancel(bookingId) {
    try {
      await resolveCancelRequest(bookingId, true);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not approve the cancellation.');
    }
  }

  // Admin declines a cancellation request → the ride stays on.
  async function rejectCancel(bookingId) {
    try {
      await resolveCancelRequest(bookingId, false);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not reject the cancellation.');
    }
  }

  // Pending cancellation requests (admin view).
  function pendingCancelRequests() {
    return bookings.filter((b) => b.cancelStatus === CANCEL_STATUS.REQUESTED);
  }

  // Driver advances a trip's status (On the way → Arrived → Completed).
  async function updateBookingStatus(bookingId, status) {
    try {
      await setBookingStatus(bookingId, status);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not update the trip.');
    }
  }

  // Driver flags a no-show: reached the pickup but the employee wasn't there.
  // Shows up flagged on the admin's Bookings screen.
  async function markNoShow(bookingId) {
    try {
      await markBookingNoShow(bookingId);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not flag the no-show.');
    }
  }

  // Employee feedback → Firestore. Returns { ok, message? }.
  async function addFeedback({ category, message }) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    try {
      await addFeedbackDoc({
        employeeId: currentUser.uid,
        employeeName: currentUser.name,
        category,
        message,
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not send your feedback.');
    }
  }

  // Employee rating (1–5 stars + optional comment) → Firestore.
  async function addRating({ stars, comment }) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    try {
      await addRatingDoc({
        employeeId: currentUser.uid,
        employeeName: currentUser.name,
        stars: Number(stars),
        comment,
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not send your rating.');
    }
  }

  // My bookings that are still active (not cancelled) — for View Roster & Trip Cancel.
  function myActiveBookings() {
    return myBookings().filter((b) => b.status !== STATUS.CANCELLED);
  }

  // The ride an employee should currently be tracking: a cab is on its way, or
  // has arrived, or the trip is under way. Deliberately excludes finished and
  // long-past rides — otherwise an employee could keep watching a cab's live
  // GPS for weeks after their trip ended. Soonest departure first.
  function trackableBooking() {
    const live = [STATUS.ASSIGNED, STATUS.ON_THE_WAY, STATUS.ARRIVED];
    const today = todayKey();
    return (
      myActiveBookings()
        .filter(
          (b) =>
            b.assignedCabId &&
            live.includes(b.status) &&
            // An assigned ride whose time has fully passed is over in practice.
            (String(b.date || '') >= today || b.status !== STATUS.ASSIGNED)
        )
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null
    );
  }

  // --- Cabs (admin fleet management) --------------------------------------
  async function createCab(data) {
    try {
      await addCab(data);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not add the cab.');
    }
  }
  async function editCab(id, data) {
    try {
      await updateCab(id, data);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the cab.');
    }
  }
  // Removes the cab AND everything pointing at it. Refuses while the cab still
  // has upcoming rides. Returns { ok, message? }.
  async function deleteCab(id) {
    try {
      return await removeCabSafely(id, todayKey());
    } catch (e) {
      return failure(e, 'Could not remove the cab.');
    }
  }
  async function loadDefaultCabs() {
    try {
      await seedDefaultCabs();
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not load the starter fleet.');
    }
  }

  // A readable home address for the signed-in user: prefer the admin-managed
  // `address` string, then a saved map pin's readable name / structured parts.
  function homeAddressOf(u) {
    if (!u) return '';
    if (u.address) return u.address;
    const h = u.home;
    if (!h) return '';
    if (h.displayName) return h.displayName;
    return [h.line1, h.area, h.city, h.pincode].filter(Boolean).join(', ');
  }

  // Employee raises an address-change request (they can't edit the address
  // directly — the admin approves it). Returns { ok, message }.
  async function requestAddressChange({ requestedAddress, landmark, reason }) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const requested = (requestedAddress || '').trim();
    if (!requested) return { ok: false, message: 'Please enter your new address.' };
    if (!(reason || '').trim()) {
      return { ok: false, message: 'Please give a reason for the change.' };
    }
    if (myAddressRequests.some((r) => r.status === 'Pending')) {
      return {
        ok: false,
        message: 'You already have an address change waiting for approval.',
      };
    }
    try {
      await createAddressChangeRequest({
        employeeId: currentUser.uid,
        employeeName: currentUser.name,
        currentAddress: homeAddressOf(currentUser),
        requestedAddress: requested,
        landmark: (landmark || '').trim(),
        reason: reason.trim(),
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not submit your request.');
    }
  }

  // Employee texts the transport desk (Contact Us). Returns { ok, message }.
  async function sendMessage(text) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const msg = (text || '').trim();
    if (!msg) return { ok: false, message: 'Please type a message.' };
    try {
      await createMessage({
        employeeId: currentUser.uid,
        employeeName: currentUser.name,
        message: msg,
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not send your message.');
    }
  }

  // Admin edits another employee's profile (Employee Management screen).
  // If the home address changed, the copies on that employee's upcoming rides
  // are rewritten too, so drivers navigate to the new house.
  // Returns { ok, message }.
  async function adminSaveEmployee(uid, fields) {
    if (!uid) return { ok: false, message: 'Missing employee.' };
    try {
      await adminUpdateEmployee(uid, fields);
      if (typeof fields.address === 'string') {
        await syncEmployeeAddress(uid, fields.address);
      }
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the profile.');
    }
  }

  // Admin creates a brand-new employee or driver (login account + profile)
  // without losing their own session. Returns { ok, message }.
  async function adminCreateEmployee(form) {
    const email = (form.email || '').trim();
    const password = form.password || '';
    const role = form.role || 'employee';
    if (!email) return { ok: false, message: 'Email is required.' };
    if (password.length < 6) {
      return { ok: false, message: 'Temporary password must be at least 6 characters.' };
    }
    if (role === 'employee' && !(form.empId || '').trim()) {
      return { ok: false, message: 'Employee ID is required.' };
    }
    try {
      await adminCreateAccount({
        email,
        password,
        role,
        profile: {
          empId: (form.empId || '').trim(),
          name: (form.name || '').trim() || email,
          phone: (form.phone || '').trim(),
          department: (form.department || '').trim(),
          address: (form.address || '').trim(),
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Admin removes an employee's profile (they left the organisation).
  // Returns { ok, message }.
  async function adminRemoveEmployee(uid) {
    if (!uid) return { ok: false, message: 'Missing employee.' };
    try {
      await adminDeleteEmployee(uid);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not remove the employee.');
    }
  }

  // Admin saves the edited Weekly Schedule timings. `pickupTimes` / `dropTimes`
  // are arrays of "hh:mm AM/PM" strings (no "NA"). The live subscription above
  // then pushes the new lists to every screen. Returns { ok, message }.
  async function saveTimings(next) {
    try {
      await saveTimingsSvc(next);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the timings.');
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
    profileMissing,
    dataError,
    dismissDataError: () => setDataError(''),
    login,
    signup,
    logout,
    changePassword,
    resetPassword,
    bookings,
    cabs,
    cabCapacity,
    pickupTimes: timings.pickupTimes,
    dropTimes: timings.dropTimes,
    routes: timings.routes,
    saveTimings,
    addBooking,
    saveRosterChanges,
    duplicateBooking,
    assignCab,
    assignCabToGroup,
    cancelBooking,
    dropRideProblem,
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
    homeAddressOf,
    myAddressRequests,
    requestAddressChange,
    sendMessage,
    adminSaveEmployee,
    adminCreateEmployee,
    adminRemoveEmployee,
    getCabById,
    myBookings,
    myActiveBookings,
    trackableBooking,
    addFeedback,
    addRating,
    // Live location sharing (driver)
    sharingLocation,
    sharingCoords,
    sharingError,
    startSharingLocation,
    stopSharingLocation,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Small hook so screens can do:  const { login } = useApp();
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
