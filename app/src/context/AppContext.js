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
import {
  STATUS, CANCEL_STATUS, CANCEL_CUTOFF_HOURS, CAB_ROUTES,
} from '../data/mockData';
import {
  watchAuth, signIn, signUp, signOutUser, friendlyAuthError,
  changePassword as changePasswordSvc, sendPasswordReset,
  signInWithMicrosoftPopup, signInWithMicrosoftCredential,
  linkMicrosoftPopup, linkMicrosoftCredential, unlinkMicrosoft as unlinkMicrosoftSvc,
  isMicrosoftLinked,
} from '../services/auth';
import {
  getOrCreateProfile, setPendingProfile, subscribeProfile, adminUpdateEmployee,
  adminCreateAccount, adminInviteEmployees, adminDeleteEmployee, subscribeEmployees,
  updateEmployeeRoute,
} from '../services/profile';
import {
  createAddressChangeRequest, subscribeMyAddressRequests,
  subscribeAllAddressRequests, REQUEST_STATUS as ADDRESS_STATUS,
} from '../services/addressRequests';
import { createMessage } from '../services/messages';
import {
  createBooking,
  createAssignedBookings,
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
  stampBookingEmpIds,
} from '../services/bookings';
import { addFeedbackDoc, addRatingDoc } from '../services/feedback';
import { updateMyLocation, clearMyLocation } from '../services/tracking';
import {
  subscribeCabs, removeCabSafely, unlinkCabDriver, linkCabDriver, cabCapacity,
  addCab, updateCab,
} from '../services/cabs';
import { subscribeTimings, saveTimings as saveTimingsSvc, DEFAULT_TIMINGS } from '../services/settings';
import { subscribeShiftPolicy, saveShiftPolicy } from '../services/shifts';
import { DEFAULT_SHIFT_POLICY } from '../data/shifts';
import {
  subscribeMonthRosters, subscribeMyRosters, subscribeImportHistory,
  importRoster as importRosterSvc, setRosterDay, deleteImportHistoryEntry,
  addSingleEmployeeRoster as addSingleEmployeeRosterSvc,
} from '../services/roster';
import { ridesForDate, bookingFromRide, excuseResolvedRequests } from '../services/rides';
import {
  createChangeRequest, subscribeMyChangeRequests, subscribeAllChangeRequests,
  resolveCancelDay, resolveCancelRide, resolveRecode, resolveNoop,
  rejectRequest, findOpenRequest, pendingFor,
} from '../services/changeRequests';
import {
  notify, notifyMany, subscribeMyNotifications, markRead, markAllRead,
  NOTIFY, cabAssignedMessage, rideCancelledMessage, requestResolvedMessage,
} from '../services/notifications';
import {
  REQUEST_STATUS, EFFECT, requestMeta,
} from '../data/changeRequests';
import { firestore } from '../services/firebase';
import {
  toDateTime, isBookingPast, canRequestCancel, todayKey, shiftDateKey,
} from '../utils/datetime';

const AppContext = createContext(null);

// Turn any thrown error into the { ok, message } shape every screen expects.
// Firestore permission failures are the common case and their raw text is
// unhelpful, so they get a plain-English message.
function failure(e, fallback) {
  const raw = e?.message || '';
  // The friendly message below deliberately hides the Firestore code, which makes
  // "you don't have permission" indistinguishable from every other cause when
  // something needs diagnosing. Keep the real one in the console.
  console.warn('[action failed]', e?.code || 'no-code', raw);
  if (e?.code === 'permission-denied' || /insufficient permissions/i.test(raw)) {
    return { ok: false, message: fallback || "You don't have permission to do that." };
  }
  return { ok: false, message: raw || fallback || 'Something went wrong. Please try again.' };
}

// The two "desk" roles. HR/Admin owns the roster and policy; the coordinator runs
// the day. Both see the same operational data, so most screens ask this rather
// than testing for one role.
export function isDeskRole(role) {
  return role === 'admin' || role === 'coordinator';
}

// Turn a failed Firestore read into something a person can act on. The CORS case
// is worth calling out by name: it means a proxy or browser extension is
// rewriting Google's response, and no amount of retrying inside the app fixes it.
function connectionMessage(e) {
  const raw = `${e?.code || ''} ${e?.message || ''}`.toLowerCase();
  if (raw.includes('permission-denied') || raw.includes('insufficient permissions')) {
    return "The database refused the request. The security rules may not be deployed yet.";
  }
  if (raw.includes('unavailable') || raw.includes('offline') || raw.includes('network')) {
    return "Couldn't reach the database. Check your connection — and if you're on a company network, a proxy or browser extension may be blocking Google's servers.";
  }
  return e?.message || 'Something went wrong talking to the database.';
}

export function AppProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null); // raw Firebase auth user
  const [profile, setProfile] = useState(null); // employee profile from Firestore
  const [authReady, setAuthReady] = useState(false); // false until first auth check
  // True when someone is signed in but has NO profile document — an account that
  // was never provisioned, or one an admin removed. They get a locked-out screen
  // instead of a silently-recreated employee profile.
  const [profileMissing, setProfileMissing] = useState(false);
  // Set when we couldn't even ASK whether the profile exists — the database was
  // unreachable. This is a very different thing from "you have no profile", and
  // conflating the two told users their account didn't exist when in fact the
  // network was blocked. Drives the "Can't reach the server" screen.
  const [profileError, setProfileError] = useState('');
  // Bumping this re-runs the profile load — the Retry button.
  const [authAttempt, setAuthAttempt] = useState(0);
  const [bookings, setBookings] = useState([]); // filled live from Firestore
  const [fleetCabs, setFleetCabs] = useState([]); // live fleet from Firestore
  const [timings, setTimings] = useState(DEFAULT_TIMINGS); // config/timings — cab routes
  const [shiftPolicy, setShiftPolicy] = useState(DEFAULT_SHIFT_POLICY); // config/shifts
  const [myRosters, setMyRosters] = useState([]); // an employee's own months
  // The employee directory, for the desk only. Held here rather than fetched per
  // screen because it's what makes an employee's PICKUP ROUTE live: the roster
  // document only carries the route as it stood at import time.
  const [employees, setEmployees] = useState([]);
  // The roster month the coordinator is working in, and its rows.
  const [rosterMonth, setRosterMonth] = useState(() => todayKey().slice(0, 7));
  const [monthRosters, setMonthRosters] = useState([]);
  // The month right before rosterMonth. ridesForDate() reads TWO roster days for
  // any given travel date (today + yesterday, to catch an overnight shift's
  // outbound leg landing on the next calendar day) — so viewing the 1st of a
  // month needs the LAST day of the previous month's roster too, not just the
  // month currently being viewed. Kept as its own subscription rather than
  // widening the main query, since the two months rarely overlap in practice.
  const [prevMonthRosters, setPrevMonthRosters] = useState([]);
  const [myAddressRequests, setMyAddressRequests] = useState([]); // employee's own address-change requests (live)
  // Every address request, for HR. Held here rather than only on its screen so the
  // menu can show a pending count — a request nobody opens is a request nobody
  // actions, and this queue had no way of announcing itself.
  const [addressRequests, setAddressRequests] = useState([]);
  const [myChangeRequests, setMyChangeRequests] = useState([]); // employee's own exception requests
  const [changeRequests, setChangeRequests] = useState([]); // the desk's whole queue
  const [notifications, setNotifications] = useState([]); // employee's in-app feed
  // Set when a live subscription fails (usually permissions or a dropped
  // connection). Screens would otherwise render a perfectly empty list and look
  // like "you have no rides", so the shell shows this as a banner.
  const [dataError, setDataError] = useState('');
  // The real fleet, straight from Firestore. There is no demo-data fallback: a
  // fallback list meant screens could show cab numbers that don't exist, which is
  // how a driver ended up reading "No cab assigned" while their trips displayed.
  const cabs = fleetCabs;

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
          // A successful read that found nothing = genuinely not provisioned.
          setProfileMissing(!p);
          setProfileError('');
        } catch (e) {
          // The read FAILED, so we don't know whether a profile exists. Never
          // claim the account isn't set up on the strength of a failed request.
          console.warn('[profile] could not load profile:', e?.code, e?.message);
          setProfile(null);
          setProfileMissing(false);
          setProfileError(connectionMessage(e));
        }
      } else {
        setProfile(null);
        setProfileMissing(false);
        setProfileError('');
        setDataError('');
      }
      setAuthReady(true); // first auth check is done — safe to render
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authAttempt]);

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

  // Whether THIS session's Firebase user already has a Microsoft credential
  // linked — read straight off the auth user, not stored anywhere ourselves.
  const microsoftLinked = isMicrosoftLinked(firebaseUser);

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

  // --- Microsoft (Entra ID) sign-in — web ----------------------------------
  // Added alongside email/password, never instead of it. A brand-new
  // employee's account is always created by the admin first (Employee
  // Management); Microsoft only becomes usable for THEM after they log in
  // once normally and link it from Profile — see linkWithMicrosoftPopup.
  async function loginWithMicrosoftPopup() {
    try {
      await signInWithMicrosoftPopup();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  async function linkWithMicrosoftPopup() {
    try {
      await linkMicrosoftPopup();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // --- Microsoft (Entra ID) sign-in — native (phone) -----------------------
  // `idToken`/`rawNonce` come from useMicrosoftAuthRequest's promptMicrosoftSignIn()
  // — see that hook for why both travel together.
  async function loginWithMicrosoftCredential(idToken, rawNonce) {
    try {
      await signInWithMicrosoftCredential(idToken, rawNonce);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  async function linkWithMicrosoftCredential(idToken, rawNonce) {
    try {
      await linkMicrosoftCredential(idToken, rawNonce);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  async function unlinkMicrosoft() {
    try {
      await unlinkMicrosoftSvc();
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
    if (currentUser.role === 'admin' || currentUser.role === 'coordinator') {
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

  // --- Repair: employee IDs on upcoming bookings --------------------------
  //
  // The driver's trip list names riders by EMPLOYEE ID, which therefore has to be
  // stored on the booking — a driver may not read employee profiles. Bookings
  // written before that was true have no `empId` and would read "not on record"
  // for ever, so the desk stamps them from the directory it can already see.
  //
  // Runs once per desk session, only for upcoming still-live rides, and only for
  // riders it can actually resolve. Past rides are left as they were recorded.
  const empIdRepairDone = useRef(false);
  useEffect(() => {
    if (!firestore || !isDeskRole(currentUser?.role) || empIdRepairDone.current) return;
    if (!bookings.length || !employees.length) return;

    const idOf = new Map(employees.map((e) => [e.uid, (e.empId || '').trim()]));
    const today = todayKey();
    const pairs = bookings
      .filter(
        (b) =>
          !b.empId &&
          String(b.date || '') >= today &&
          b.status !== STATUS.CANCELLED &&
          b.status !== STATUS.COMPLETED &&
          b.status !== STATUS.NO_SHOW &&
          idOf.get(b.employeeId)
      )
      .map((b) => ({ id: b.id, empId: idOf.get(b.employeeId) }));
    if (!pairs.length) return;

    // Set before awaiting: the live subscription fires again as the writes land,
    // and without this the effect would re-enter and repeat the batch.
    empIdRepairDone.current = true;
    stampBookingEmpIds(pairs)
      .then((n) => console.log(`[bookings] stamped employee id on ${n} upcoming ride(s)`))
      .catch((e) => {
        empIdRepairDone.current = false; // let a later render retry
        console.warn('[bookings] could not stamp employee ids:', e?.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role, bookings.length, employees.length]);

  // --- Address change requests (HR's queue, live) -------------------------
  // Admin only: the rules restrict reading all of them to an admin, so a
  // coordinator would just get a permissions error.
  useEffect(() => {
    if (!firestore || currentUser?.role !== 'admin') {
      setAddressRequests([]);
      return;
    }
    return subscribeAllAddressRequests(setAddressRequests, onSubError('address requests'));
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

  // --- Shift policy (config/shifts, live) ---------------------------------
  // Which shift codes exist and when each runs. Everything downstream — pickup
  // times, which codes generate rides, the calendar legend — reads this.
  useEffect(() => {
    if (!firestore || !currentUser) {
      setShiftPolicy(DEFAULT_SHIFT_POLICY);
      return;
    }
    return subscribeShiftPolicy(setShiftPolicy, onSubError('shift policy'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  // --- My roster months (employee, live) ----------------------------------
  // An employee's own shift calendar. One document per month, so this is a tiny
  // read even for someone with a year of history.
  useEffect(() => {
    if (!firestore || currentUser?.role !== 'employee') {
      setMyRosters([]);
      return;
    }
    return subscribeMyRosters(currentUser.uid, setMyRosters, onSubError('your shift calendar'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // --- The employee directory (desk, live) --------------------------------
  // Who exists, and — the part today's ride list depends on — which pickup route
  // each of them is on right now.
  useEffect(() => {
    if (!firestore || !isDeskRole(currentUser?.role)) {
      setEmployees([]);
      return;
    }
    return subscribeEmployees(setEmployees, onSubError('the employee list'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // --- The working month's rosters (desk, live) ---------------------------
  // ~250 documents for a 250-person month. This is what today's ride list is
  // derived from, so the coordinator's dashboard updates the moment HR imports.
  useEffect(() => {
    if (!firestore || !isDeskRole(currentUser?.role)) {
      setMonthRosters([]);
      return;
    }
    return subscribeMonthRosters(rosterMonth, setMonthRosters, onSubError('the shift roster'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, rosterMonth]);

  useEffect(() => {
    if (!firestore || !isDeskRole(currentUser?.role)) {
      setPrevMonthRosters([]);
      return;
    }
    const prevMonth = shiftDateKey(`${rosterMonth}-01`, -1).slice(0, 7);
    return subscribeMonthRosters(
      prevMonth,
      setPrevMonthRosters,
      onSubError('the shift roster')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, rosterMonth]);

  // --- Change requests -----------------------------------------------------
  // Employees see their own; the desk sees the queue and filters by who it's
  // routed to (see pendingFor).
  useEffect(() => {
    if (!firestore || !currentUser) {
      setMyChangeRequests([]);
      setChangeRequests([]);
      return;
    }
    if (isDeskRole(currentUser.role)) {
      return subscribeAllChangeRequests(setChangeRequests, onSubError('change requests'));
    }
    return subscribeMyChangeRequests(
      currentUser.uid,
      setMyChangeRequests,
      onSubError('your requests')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // --- Notifications (employee) -------------------------------------------
  useEffect(() => {
    if (!firestore || !currentUser || isDeskRole(currentUser.role)) {
      setNotifications([]);
      return;
    }
    return subscribeMyNotifications(
      currentUser.uid,
      setNotifications,
      onSubError('notifications')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

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
      // Carried so the driver's trip list can identify the rider by ID.
      empId: currentUser.empId || '',
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

    // A CAB WITH NO DRIVER ACCOUNT IS NOT A CAB ANYONE CAN DRIVE.
    // The driver's trip list is scoped by the two-sided link
    // (cabs/<id>.driverUid ←→ employees/<uid>.cabId), so assigning a cab that
    // nothing points at produced a ride NO driver account could see — while the
    // rider was told "cab assigned, track it live" and got a notification naming
    // "A cab · Your driver". A typed-in `driverName` is not enough: it grants
    // nobody access and shows nobody the trip.
    if (!cab.driverUid) {
      return `${cab.cabNumber} has no driver linked, so no driver would see this trip. Link one on the Fleet screen first.`;
    }

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

  // --- The driver's own cab (read-only) -----------------------------------
  // Which vehicle this driver is currently on. Found by OWNERSHIP (the cab that
  // points at them) rather than by their profile's stored cabId, so the two can
  // never appear to disagree. The coordinator sets the link; the driver only
  // reads it.
  const myCab = currentUser?.role === 'driver'
    ? fleetCabs.find((c) => c.driverUid === currentUser.uid) || null
    : null;

  // --- Fleet (coordinator) ------------------------------------------------
  // Removes the cab AND everything pointing at it. Refuses while the cab still
  // has upcoming rides. Returns { ok, message? }.
  async function deleteCab(id) {
    try {
      return await removeCabSafely(id, todayKey());
    } catch (e) {
      return failure(e, 'Could not remove the cab.');
    }
  }

  // Add a vehicle to the fleet. Returns { ok, id?, message? }.
  async function createCab(fields) {
    const problem = cabDetailsProblem(fields);
    if (problem) return { ok: false, message: problem };
    try {
      const id = await addCab(fields);
      return { ok: true, id };
    } catch (e) {
      return failure(e, 'Could not add the cab.');
    }
  }

  // --- Drivers (desk) ------------------------------------------------------
  // Add a driver. A driver is a LOGIN, not just a name on a cab: they sign in to
  // see their trips and to broadcast the cab's position, which is why this
  // creates an account rather than a text field somewhere.
  //
  // No password is invented or shared — the account is created with a throwaway
  // one and Firebase emails them a link to set their own.
  async function addDriverAccount({ name, email, phone }) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can add a driver.' };
    }
    const person = {
      name: (name || '').trim(),
      email: (email || '').trim().toLowerCase(),
      phone: (phone || '').trim(),
    };
    if (!person.name) return { ok: false, message: "Enter the driver's name." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(person.email)) {
      return { ok: false, message: 'Enter a valid email address — it is their login.' };
    }
    if (person.phone && person.phone.replace(/[^0-9]/g, '').length !== 10) {
      return { ok: false, message: 'Phone must be a 10-digit number.' };
    }
    try {
      const res = await adminInviteEmployees([person], { role: 'driver' });
      if (res.failedCount) {
        return { ok: false, message: res.failed[0]?.reason || 'Could not create that account.' };
      }
      // The account exists either way; say so when the set-password email didn't
      // send, rather than reporting a failure that didn't happen.
      return { ok: true, emailed: res.notInvited.length === 0 };
    } catch (e) {
      return failure(e, 'Could not create that driver account.');
    }
  }

  // Remove a driver who has left. Deletes their PROFILE (which locks the account
  // out of the app — see UnprovisionedScreen) and detaches their cab.
  //
  // Refused while their cab still has upcoming rides, for the same reason removing
  // a cab is: the driver's account is the only one that can see those trips, so
  // deleting them would leave riders with a cab that nobody is driving. The desk
  // links a replacement first — one tap on the Fleet screen.
  //
  // The Firebase Auth login survives; only the Admin SDK can delete that. It is
  // harmless (no profile = locked out), but it must be removed in the console for
  // sign-in to be revoked outright.
  async function removeDriver(uid) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can remove a driver.' };
    }
    if (!uid) return { ok: false, message: 'Missing driver.' };

    const cab = fleetCabs.find((c) => c.driverUid === uid) || null;
    if (cab) {
      const today = todayKey();
      const stranded = bookings.filter(
        (b) =>
          b.assignedCabId === cab.id &&
          b.status !== STATUS.CANCELLED &&
          b.status !== STATUS.COMPLETED &&
          b.status !== STATUS.NO_SHOW &&
          String(b.date || '') >= today
      ).length;
      if (stranded) {
        return {
          ok: false,
          message: `${cab.cabNumber} has ${stranded} upcoming ride${
            stranded === 1 ? '' : 's'
          } on this driver. Link another driver to ${cab.cabNumber}, or re-assign those rides, then remove them.`,
        };
      }
    }

    try {
      await adminDeleteEmployee(uid);
      return { ok: true, unlinkedCab: cab?.cabNumber || null };
    } catch (e) {
      return failure(e, 'Could not remove that driver.');
    }
  }

  // Edit a vehicle's details. Returns { ok, message? }.
  async function editCab(id, fields) {
    const problem = cabDetailsProblem(fields);
    if (problem) return { ok: false, message: problem };
    try {
      await updateCab(id, fields);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the cab.');
    }
  }

  // Point a cab at a driver account — this is what switches on that cab's live
  // tracking. Pass null to detach. Returns { ok, message? }.
  async function assignDriverToCab(cabId, driverUid) {
    try {
      await linkCabDriver(cabId, driverUid || null);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not link that driver.');
    }
  }

  // Detach a driver from a cab without deleting the vehicle.
  async function unlinkDriverFromCab(cabId) {
    try {
      await unlinkCabDriver(cabId);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not detach that driver.');
    }
  }

  // Shared validation for the cab form, matching what the security rules accept.
  // Vehicle fields only — the driver's name and phone come from their account.
  function cabDetailsProblem({ cabNumber, capacity }) {
    if (!(cabNumber || '').trim()) return 'Enter the cab number.';
    if ((cabNumber || '').trim().length > 32) return 'That cab number is too long.';
    const seats = Number(capacity);
    if (!Number.isInteger(seats) || seats < 1 || seats > 30) {
      return 'Seats must be a whole number between 1 and 30.';
    }
    return null;
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
    // `route` is not a profile field — it lives inside `roster`, alongside data
    // this write must not touch. Split it out and write it through the one helper
    // that knows that, so the caller can keep treating it as part of the form.
    const { route, ...profile } = fields || {};
    try {
      await adminUpdateEmployee(uid, profile);
      if ('route' in (fields || {})) {
        await updateEmployeeRoute(uid, route);
      }
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
          // Route them at creation. Skipping it here is how people ended up
          // unrouted in the first place: the only place to set a route was a
          // separate screen nobody went back to, so every new hire arrived on the
          // coordinator's board under "No route set".
          ...(form.route ? { roster: { route: String(form.route).trim() } } : {}),
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

  // Admin saves the edited cab routes. `routes` is an array of route names.
  // The live subscription above then pushes the new list to every screen.
  // Returns { ok, message }.
  async function saveTimings(next) {
    try {
      await saveTimingsSvc(next);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the timings.');
    }
  }

  // --- Shift policy (admin) -----------------------------------------------
  async function saveShifts(next) {
    try {
      await saveShiftPolicy(next);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the shift policy.');
    }
  }

  // --- Monthly roster import (admin) --------------------------------------
  // `report` is the validated result from validateRoster(). Only the clean rows
  // are written; the rejects come back to HR to fix and re-upload.
  async function importRoster(report, { onProgress } = {}) {
    if (currentUser?.role !== 'admin') {
      return { ok: false, message: 'Only HR/Admin can import a roster.' };
    }
    try {
      const res = await importRosterSvc(report, {
        uploadedBy: currentUser.uid,
        uploadedByName: currentUser.name || currentUser.email,
        onProgress,
      });
      // Jump the desk to the month that was just imported.
      setRosterMonth(report.month);
      return { ok: true, ...res };
    } catch (e) {
      return failure(e, 'Could not import the roster.');
    }
  }

  // Add one employee's roster for a day range, without a spreadsheet — the
  // walk-in case. Admin-only: the security rules only let admin CREATE a
  // rosters/<month>_<uid> doc (a coordinator may only edit `days` on one that
  // already exists), so this mirrors importRoster's gate exactly.
  async function addSingleEmployeeRoster(input) {
    if (currentUser?.role !== 'admin') {
      return { ok: false, message: 'Only HR/Admin can add a roster row.' };
    }
    try {
      const res = await addSingleEmployeeRosterSvc(input, {
        uploadedBy: currentUser.uid,
        uploadedByName: currentUser.name || currentUser.email,
      });
      setRosterMonth(input.month);
      return { ok: true, ...res };
    } catch (e) {
      return failure(e, 'Could not add that roster row.');
    }
  }

  // Remove one row from Import history. Admin-only, same as importRoster —
  // it's the log of an upload, not the roster data itself (see roster.js).
  async function deleteImportHistory(importId) {
    if (currentUser?.role !== 'admin') {
      return { ok: false, message: 'Only HR/Admin can remove an import record.' };
    }
    try {
      await deleteImportHistoryEntry(importId);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not remove that record.');
    }
  }

  // Correct one day's code — how an approved leave or shift change is written
  // back onto the roster. Admin, or a coordinator actioning a request.
  async function updateRosterDay(month, employeeId, day, code) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can change a roster day.' };
    }
    try {
      await setRosterDay(month, employeeId, day, code);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not update that roster day.');
    }
  }

  // --- Pickup routes (desk) ------------------------------------------------
  //
  // A route is the pickup area an employee belongs to, and it is the unit the
  // coordinator assigns cabs in: one route ≈ one cabful of neighbours. Grouping
  // the day by route is what turns 200 individual rides into ~15 decisions, so an
  // unrouted employee is real friction, not a cosmetic gap.
  //
  // WHERE A ROUTE GETS SET. There is no dedicated routing screen — a route is one
  // field of an employee's record, so it is set wherever that record is already in
  // front of someone:
  //   • Employee Management — on the create dialog and on each employee's card
  //   • the roster upload   — a "Route" column writes it onto profiles at import
  //   • the coordinator's board — for a rider who turns up unrouted at 9 PM
  // The rules let HR write it, and let a coordinator write THIS FIELD ONLY.
  // See firestore.rules > employees.

  // The route list HR maintains in Routes & Timings, with the built-in list as a
  // fallback for a company that hasn't customised it yet.
  const routeOptions = timings.routes?.length ? timings.routes : CAB_ROUTES;

  async function setEmployeeRoute(uid, route) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can set a route.' };
    }
    try {
      await updateEmployeeRoute(uid, route);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save that route.');
    }
  }

  // --- Derived rides (coordinator) ----------------------------------------
  // Today's (or any day's) rides, computed from the roster + policy and married
  // up with any bookings that already exist. Nothing is written until a cab is
  // assigned — see services/rides.js for why.
  function ridesOn(dateKey) {
    // Purely roster-driven. There is no "extra ride" path any more: the company
    // runs the two scheduled rides and nothing else, so nothing an employee can
    // request adds a ride to this list — requests only remove or re-code them.
    // Concatenated with the previous month's rosters so a date on or near a
    // month boundary can still find yesterday's roster row for an overnight
    // shift's outbound leg (see prevMonthRosters above). ridesForDate() already
    // filters each roster doc by its own `month` field, so passing in rosters
    // outside what a given date needs is harmless.
    const rides = excuseResolvedRequests(
      ridesForDate(
        dateKey,
        [...monthRosters, ...prevMonthRosters],
        shiftPolicy,
        bookings
      ),
      changeRequests
    );

    // ROUTE COMES FROM THE PROFILE, NOT THE ROSTER SNAPSHOT.
    //
    // importRoster() copies each employee's route into their roster document so
    // the coordinator and driver don't have to read profiles. That copy is right
    // on the day of the import and wrong after it: routing someone (or moving
    // them to another route) left every already-imported day of that month
    // grouped under "No route set", and there was nothing HR could do about it
    // short of re-uploading the whole sheet.
    //
    // The profile is the source of truth, so the live value wins here and the
    // snapshot is only a fallback — which still covers a rostered person whose
    // profile hasn't loaded yet.
    if (!employees.length) return rides;
    const routeOf = new Map(
      employees.map((e) => [e.uid, e.roster?.route || null])
    );
    return rides.map((r) =>
      routeOf.has(r.employeeId)
        ? { ...r, route: routeOf.get(r.employeeId) || r.route || null }
        : r
    );
  }

  // Assign a cab to DERIVED rides. Any ride that has no booking document yet is
  // created here, in the same batch as the assignment, so the seat is committed
  // and released atomically. Returns { ok, message?, created }.
  async function assignCabToRides(rides, cabId) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can assign a cab.' };
    }
    if (!rides?.length) return { ok: false, message: 'Select at least one ride.' };

    // Reuse the same capacity + double-booking guard the manual flow uses.
    const problem = cabAssignmentProblem(cabId, rides);
    if (problem) return { ok: false, message: problem };

    try {
      const existing = rides.filter((r) => r.bookingId);
      const fresh = rides.filter((r) => !r.bookingId);

      // ONE atomic batch for the whole carpool. Creating them one at a time meant
      // a failure partway through left some riders assigned and the rest not, with
      // the cab's seat count already spent on the ones that landed.
      const created = await createAssignedBookings(
        fresh.map((ride) => ({
          ...bookingFromRide(ride, toDateTime(ride.date, ride.shift)),
          assignedCabId: cabId,
          status: STATUS.ASSIGNED,
        })),
        existing.map((r) => r.bookingId),
        cabId
      );

      // Tell every rider on this cab. Best-effort — a failed notification
      // must not undo a completed assignment, so it's logged, not thrown.
      const cab = getCabById(cabId);
      notifyMany(
        rides.map((ride) => {
          const msg = cabAssignedMessage(ride, cab);
          return {
            employeeId: ride.employeeId,
            type: NOTIFY.CAB_ASSIGNED,
            title: msg.title,
            body: msg.body,
            payload: { date: ride.date, rideKey: ride.key, cabId },
          };
        })
      ).catch((e) => console.warn('[notify] assignment notice failed:', e?.message));

      return { ok: true, created: fresh.length };
    } catch (e) {
      return failure(e, 'Could not assign the cab.');
    }
  }

  // --- Change requests (Steps 7 & 8) --------------------------------------

  // Employee raises an exception. Routing is decided by policy inside the
  // service, not here and not by the client. Returns { ok, message? }.
  async function raiseChangeRequest(data) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const meta = requestMeta(data.type);
    if (!meta) return { ok: false, message: 'Pick a request type.' };
    if (!data.date) return { ok: false, message: 'Pick the date it applies to.' };
    if (!(data.reason || '').trim()) return { ok: false, message: 'Choose a reason.' };
    if (meta.form.includes('shiftCode') && !data.requestedShiftCode) {
      return { ok: false, message: 'Pick the shift you are actually working.' };
    }
    if (meta.form.includes('ride') && !data.rideKey) {
      return { ok: false, message: 'Pick which ride this is about.' };
    }
    try {
      const already = await findOpenRequest(currentUser.uid, data.date, data.type);
      if (already) {
        return {
          ok: false,
          message: 'You already have a ' + meta.label.toLowerCase() +
            ' request pending for ' + data.date + '.',
        };
      }
      await createChangeRequest(currentUser, data);
      return { ok: true, routedTo: meta.routeTo };
    } catch (e) {
      return failure(e, 'Could not send your request.');
    }
  }

  // The queue for whichever desk the signed-in user is.
  function myQueue() {
    if (!isDeskRole(currentUser?.role)) return [];
    return pendingFor(changeRequests, currentUser.role);
  }

  // Resolve a request: carry out its effect AND stamp it, in one batch. Tells the
  // employee afterwards. Returns { ok, message? }.
  async function resolveChangeRequest(req, opts = {}) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can resolve a request.' };
    }
    const { note, code } = opts;
    const actor = { uid: currentUser.uid, name: currentUser.name, email: currentUser.email };
    const meta = requestMeta(req.type);
    try {
      // Three effects, all of which either stop a ride or move the day to another
      // shift code. Nothing here can create a ride.
      const outcome = 'Resolved';
      if (meta?.effect === EFFECT.CANCEL_DAY) {
        await resolveCancelDay(req, { actor, note, recode: meta.recodeTo });
      } else if (meta?.effect === EFFECT.CANCEL_RIDE) {
        await resolveCancelRide(req, { actor, note });
      } else if (meta?.effect === EFFECT.RECODE) {
        await resolveRecode(req, {
          actor,
          note,
          code: code || req.requestedShiftCode,
        });
      } else {
        // An unrecognised type — most likely a request raised by an older build,
        // for something the company no longer offers. Close it rather than leaving
        // it in the queue for ever.
        await resolveNoop(req, { actor, note, status: REQUEST_STATUS.RESOLVED });
      }

      const msg = requestResolvedMessage(req, outcome, note);
      notify({
        employeeId: req.employeeId,
        type: NOTIFY.REQUEST_RESOLVED,
        title: msg.title,
        body: msg.body,
        payload: { requestId: req.id, date: req.date },
      }).catch((e) => console.warn('[notify] resolution notice failed:', e?.message));

      return { ok: true, outcome };
    } catch (e) {
      return failure(e, 'Could not resolve that request.');
    }
  }

  async function declineChangeRequest(req, note) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can reject a request.' };
    }
    try {
      await rejectRequest(req, {
        actor: { uid: currentUser.uid, name: currentUser.name, email: currentUser.email },
        note,
      });
      const msg = requestResolvedMessage(req, 'Rejected', note);
      notify({
        employeeId: req.employeeId,
        type: NOTIFY.REQUEST_RESOLVED,
        title: msg.title,
        body: msg.body,
        payload: { requestId: req.id, date: req.date },
      }).catch(() => {});
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not reject that request.');
    }
  }

  // --- Menu counts (desk) -------------------------------------------------
  // What is waiting on the signed-in desk user, keyed by SCREEN NAME so the drawer
  // can badge the right row. Both of these queues were previously invisible until
  // somebody thought to open them.
  const menuCounts = isDeskRole(currentUser?.role)
    ? {
        AddressRequests: addressRequests.filter((r) => r.status === ADDRESS_STATUS.PENDING)
          .length,
        Requests: pendingFor(changeRequests, currentUser.role).length,
      }
    : {};

  // --- Notifications ------------------------------------------------------
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  async function openNotification(id) {
    try {
      await markRead(id);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not mark that as read.');
    }
  }
  async function clearNotifications() {
    if (!currentUser) return { ok: false };
    try {
      await markAllRead(currentUser.uid);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not clear your notifications.');
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
    // Raw Firebase auth user — for the rare screen that needs auth identity
    // when there's no employee profile yet (e.g. UnprovisionedScreen telling
    // a Microsoft-only sign-in apart from a genuinely unprovisioned account).
    firebaseUser,
    authReady,
    profileMissing,
    profileError,
    retryProfile: () => {
      setProfileError('');
      setAuthReady(false);
      setAuthAttempt((n) => n + 1);
    },
    dataError,
    dismissDataError: () => setDataError(''),
    subscribeImportHistory,
    login,
    loginWithMicrosoftPopup,
    loginWithMicrosoftCredential,
    linkWithMicrosoftPopup,
    linkWithMicrosoftCredential,
    unlinkMicrosoft,
    microsoftLinked,
    signup,
    logout,
    changePassword,
    resetPassword,
    bookings,
    cabs,
    cabCapacity,
    routes: timings.routes,
    saveTimings,
    // Shift policy + monthly roster
    shiftPolicy,
    saveShifts,
    myRosters,
    rosterMonth,
    setRosterMonth,
    monthRosters,
    importRoster,
    addSingleEmployeeRoster,
    deleteImportHistory,
    updateRosterDay,
    // Pickup routes — what the coordinator groups the day by
    employees,
    routeOptions,
    setEmployeeRoute,
    // Derived rides (roster-driven workflow)
    ridesOn,
    assignCabToRides,
    // Change requests (the exception workflow)
    myChangeRequests,
    changeRequests,
    myQueue,
    raiseChangeRequest,
    resolveChangeRequest,
    declineChangeRequest,
    // Notifications
    notifications,
    unreadCount,
    openNotification,
    clearNotifications,
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
    // The driver's own cab (read-only)
    myCab,
    // Fleet (coordinator)
    createCab,
    editCab,
    deleteCab,
    assignDriverToCab,
    unlinkDriverFromCab,
    // Drivers (desk)
    addDriverAccount,
    removeDriver,
    homeAddressOf,
    myAddressRequests,
    addressRequests,
    menuCounts,
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
