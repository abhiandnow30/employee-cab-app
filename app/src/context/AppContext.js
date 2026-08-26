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

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  STATUS, CANCEL_STATUS, CANCEL_CUTOFF_HOURS, DESK_CANCEL_CUTOFF_HOURS, CAB_ROUTES,
} from '../data/mockData';
import {
  watchAuth, signIn, signOutUser, friendlyAuthError,
  signInWithDriverCode, signInWithCoordinatorCode,
  changePassword as changePasswordSvc, sendPasswordReset,
  signInWithMicrosoftPopup, signInWithMicrosoftCredential,
  linkMicrosoftPopup, linkMicrosoftCredential, unlinkMicrosoft as unlinkMicrosoftSvc,
  isMicrosoftLinked, microsoftCredentialFromResult, deleteCurrentUser,
  linkMicrosoftOAuthCredential, microsoftCredentialFromError,
} from '../services/auth';
import {
  getOrCreateProfile, subscribeProfile, adminUpdateEmployee,
  adminDeleteEmployee, subscribeEmployees,
  updateEmployeeRoute, adminCreateInvite, adminRevokeInvite, adminCreateDriver,
  rotateDriverLoginCode, adminCreateCoordinator, rotateCoordinatorPasscode,
} from '../services/profile';
import {
  driverLoginCode, driverPhone, isDriverLoginCode, cabCodePart, unassignedLoginCode,
} from '../utils/driverLogin';
import { coordinatorPhone, isPasscode, PASSCODE_LENGTH } from '../utils/coordinatorLogin';
import { directoryEmail, isGuestDirectoryEmail } from '../utils/directoryEmail';
import {
  createAddressChangeRequest, subscribeMyAddressRequests,
  subscribeAllAddressRequests, REQUEST_STATUS as ADDRESS_STATUS,
} from '../services/addressRequests';
import {
  createCabServiceRequest, subscribeMyCabServiceRequests,
  subscribeCabServiceRequests, approveCabServiceRequest, rejectCabServiceRequest,
  proposeRoute as proposeCabRequestRouteSvc, needsCabServiceSetup, pendingRequest,
  CAB_REQUEST_STATUS,
} from '../services/cabServiceRequests';
import { createMessage } from '../services/messages';
import {
  createBooking,
  createAssignedBookings,
  applyRosterChanges,
  assignCabToBooking,
  assignCabToBookings,
  setBookingStatus,
  setBookingStatuses,
  startRideWithOtp as startRideWithOtpSvc,
  markBookingNoShow,
  requestCancelBooking,
  resolveCancelRequest,
  cancelAssignedBooking,
  deskCancelBooking,
  createDeskCancelledBooking,
  restoreDeskCancelledBooking,
  subscribeMyBookings,
  subscribeAllBookings,
  subscribeCabBookings,
  ridesSharingCab,
  conflictingRide,
  syncEmployeeAddress,
  stampBookingEmpIds,
} from '../services/bookings';
import { addFeedbackDoc, addRatingDoc } from '../services/feedback';
import {
  updateMyLocation, clearMyLocation, claimLocationNode, releaseLocationNode,
  LIVE_WINDOW_MS,
} from '../services/tracking';
// NATIVE ONLY. expo-task-manager has no web build, and importing it in a browser
// bundle throws at module load — so the background task is required lazily, inside
// the native branches below, and web keeps the foreground watcher it always had.
// eslint-disable-next-line global-require
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
  addRiderForDay, canonicalRoute, routeKey,
} from '../services/roster';
import { ridesForDate, bookingFromRide, excuseResolvedRequests } from '../services/rides';
import { groupRuns, activeRun, idsToMarkOnTheWay } from '../services/driverRun';
import {
  createChangeRequest, subscribeMyChangeRequests, subscribeAllChangeRequests,
  resolveCancelDay, resolveCancelRide, resolveRecode, resolveNoop,
  rejectRequest, findOpenRequest, pendingForDesk,
} from '../services/changeRequests';
import {
  notify, notifyMany, subscribeMyNotifications, markRead, markAllRead,
  NOTIFY, cabAssignedMessage, rideCancelledMessage, rideRestoredMessage,
  requestResolvedMessage,
  noShowMessage,
} from '../services/notifications';
import { queueCabAssignedEmails } from '../services/mail';
import {
  REQUEST_STATUS, EFFECT, requestMeta,
} from '../data/changeRequests';
import { firestore } from '../services/firebase';
import { SUPPORT_HELPLINE } from '../branding';
import {
  toDateTime, canRequestCancel, todayKey, shiftDateKey,
  cancelDeadline,
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
  // Set right after a FRESH Microsoft sign-in turns out to match nobody by
  // uid — { email, credential } while we wait for them to type their existing
  // password so we can link Microsoft onto that account instead. See
  // loginWithMicrosoftPopup/loginWithMicrosoftCredential and
  // confirmMicrosoftLink below, and the "Confirm your Microsoft sign-in"
  // screen in App.js that renders while this is set.
  const [microsoftConfirm, setMicrosoftConfirm] = useState(null);
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
  // "Please set me up for cab service" — raised by anyone who signed in from the
  // company directory without HR having entered them, so they have no address or
  // pickup route yet. See services/cabServiceRequests.js.
  const [myCabServiceRequests, setMyCabServiceRequests] = useState([]);
  const [cabServiceRequests, setCabServiceRequests] = useState([]);
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
          // (A fresh Microsoft sign-in with no profile is handled BEFORE this
          // listener even sees a stable user — see loginWithMicrosoftPopup /
          // loginWithMicrosoftCredential below, which delete the throwaway
          // account and set microsoftConfirm instead, when that happens.)
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

  // --- Microsoft (Entra ID) sign-in ----------------------------------------
  // Added alongside email/password, never instead of it. A brand-new
  // employee's account is always created by the admin first (Employee
  // Management, with their real email on file).
  //
  // DIRECT sign-in (no prior "link from Profile" trip) works like this: a
  // fresh Microsoft identity always gets a brand-new Firebase uid, which
  // getOrCreateProfile (in the auth listener above) won't find a profile for.
  // Rather than leave that as "Account not set up" forever, we check RIGHT
  // HERE, immediately after the sign-in call — before the throwaway account
  // is worth anything: if no profile exists for it, we delete that throwaway
  // account (the client can always delete ITS OWN current user — no Admin
  // SDK needed) and ask for their existing password instead. Confirming that
  // signs into their REAL account and links the SAME Microsoft credential we
  // already obtained onto it — same uid as always, no data ever moves. See
  // confirmMicrosoftLink below for the second half.
  //
  // This is deliberately NOT a Cloud Function: reassigning an employees/{uid}
  // doc (and everything that references it) to a different uid needs
  // Admin-SDK privileges, and Cloud Functions require the paid Blaze plan
  // just to deploy at all — this project stays on the free Spark plan.
  async function handlePostMicrosoftSignIn(result) {
    const user = result.user;
    const p = await getOrCreateProfile(user);
    if (p) return { ok: true }; // already matched — either linked before, or somehow already has a doc
    const email = user.email;
    const credential = microsoftCredentialFromResult(result);
    try {
      await deleteCurrentUser(); // best-effort cleanup of the throwaway account; also signs out
    } catch (delErr) {
      console.warn('[auth] could not delete throwaway Microsoft account:', delErr?.message);
    }
    setMicrosoftConfirm({ email, credential });
    return { ok: true }; // not an error — App.js shows the confirm screen next, not UnprovisionedScreen
  }

  // Firebase's "one account per email address" setting (the default on every
  // project) refuses to even create the throwaway account when the Microsoft
  // email matches an existing password account — it throws this error out of
  // signInWithPopup/signInWithCredential instead of returning a result, so
  // handlePostMicrosoftSignIn never runs. Firebase still attaches the OAuth
  // credential the person just proved ownership of to the error itself,
  // which is exactly enough to reuse the same "Confirm your Microsoft
  // sign-in" password screen as the no-profile-found case above — there's no
  // throwaway account to delete here because one was never created.
  function handleMicrosoftAccountExists(e) {
    const email = e?.customData?.email;
    const credential = microsoftCredentialFromError(e);
    if (!email || !credential) return { ok: false, message: friendlyAuthError(e) };
    setMicrosoftConfirm({ email, credential });
    return { ok: true };
  }

  async function loginWithMicrosoftPopup() {
    try {
      const result = await signInWithMicrosoftPopup();
      return await handlePostMicrosoftSignIn(result);
    } catch (e) {
      if (e?.code === 'auth/account-exists-with-different-credential') {
        return handleMicrosoftAccountExists(e);
      }
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

  // `idToken`/`rawNonce` come from useMicrosoftAuthRequest's promptMicrosoftSignIn()
  // — see that hook for why both travel together.
  async function loginWithMicrosoftCredential(idToken, rawNonce) {
    try {
      const result = await signInWithMicrosoftCredential(idToken, rawNonce);
      return await handlePostMicrosoftSignIn(result);
    } catch (e) {
      if (e?.code === 'auth/account-exists-with-different-credential') {
        return handleMicrosoftAccountExists(e);
      }
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // The second half of direct sign-in: the employee just typed the password
  // for their REAL (old) account. Signing in with it makes that account the
  // current user, and THEN we link the Microsoft credential captured earlier
  // onto it — same order as the existing manual link-from-Profile flow, just
  // triggered inline instead of requiring a trip to Profile.
  async function confirmMicrosoftLink(password) {
    if (!microsoftConfirm) return { ok: false, message: 'Nothing to confirm.' };
    try {
      await signIn(microsoftConfirm.email, password);
      await linkMicrosoftOAuthCredential(microsoftConfirm.credential);
      setMicrosoftConfirm(null);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Give up on confirming — back to a plain signed-out state, same as if they
  // just closed the Microsoft popup.
  function cancelMicrosoftConfirm() {
    setMicrosoftConfirm(null);
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

  // Sign a DRIVER in with their login code — the last 4 digits of their cab
  // number followed by their phone, and nothing else. No email, no password, no
  // account for them to create: the desk creates the account and the code is
  // issued by linking them to a cab (see services/cabs.js).
  //
  // The login screen collects the two halves as separate fields and joins them, so
  // the length check here is a backstop rather than the message anyone normally
  // reads. It matters anyway: a short code must never reach Firebase, because a
  // 10-digit one is what an unassigned driver's account actually holds.
  //
  // On success the auth listener above loads the profile and App.js opens My
  // Trips, exactly as an email/password sign-in does.
  async function loginDriver(code) {
    const digits = String(code || '').replace(/[^0-9]/g, '');
    if (!digits) {
      return { ok: false, message: 'Enter your cab digits and your phone number.' };
    }
    if (!isDriverLoginCode(digits)) {
      return {
        ok: false,
        message:
          'Check both boxes: the last 4 digits of your cab number, and your 10-digit phone number.',
      };
    }
    try {
      await signInWithDriverCode(digits);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e, { driver: true }) };
    }
  }

  // Sign a COORDINATOR in with their phone and the 4-digit passcode the desk
  // issued them. No email and no Microsoft account: their Auth address is
  // synthesized from the phone, so the two fields they type are the whole
  // credential — see utils/coordinatorLogin.js.
  //
  // Both lengths are checked here as well as on the screen. A short passcode must
  // never reach Firebase: a generic "wrong password" back from the server reads,
  // to whoever typed it, as "the desk gave me a bad code".
  async function loginCoordinator(phone, passcode) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    const code = String(passcode || '').replace(/[^0-9]/g, '');
    if (!coordinatorPhone(digits)) {
      return { ok: false, message: 'Enter your full 10-digit phone number.' };
    }
    if (!isPasscode(code)) {
      return { ok: false, message: `Your passcode is the ${PASSCODE_LENGTH} digits the desk gave you.` };
    }
    try {
      await signInWithCoordinatorCode(digits, code);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Add a coordinator: a name and a phone, and that is the whole form.
  //
  // Unlike an employee this creates a REAL ACCOUNT immediately rather than an
  // invite, so they can be used the moment HR saves. The passcode comes back for
  // the screen to show — it is generated inside the service and this is the one
  // moment it can be presented as new.
  async function addCoordinatorAccount({ name, phone }) {
    if (currentUser?.role !== 'admin') {
      return { ok: false, message: 'Only HR can add a coordinator.' };
    }
    const cleanName = (name || '').trim();
    const digits = coordinatorPhone(phone);
    if (!cleanName) return { ok: false, message: "Enter the coordinator's name." };
    if (!digits) {
      return { ok: false, message: 'Enter a 10-digit phone number — it is half of their login.' };
    }
    try {
      const { passcode } = await adminCreateCoordinator({ name: cleanName, phone: digits });
      return { ok: true, passcode };
    } catch (e) {
      // One phone is one account, because the phone derives the Firebase address.
      // Say that rather than leaking a synthesized address at whoever is reading.
      const code = e?.code || '';
      if (code === 'auth/email-already-in-use') {
        return {
          ok: false,
          message:
            'A coordinator already uses that phone number. Removing one deletes their profile but not their login, so a number that was used before still counts as taken.',
        };
      }
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // Issue a fresh passcode for a coordinator who has lost theirs. Returns the new
  // one to read out. There is no self-service reset: their address is on an
  // unroutable domain, so nothing can be emailed to them.
  async function regenerateCoordinatorPasscode(coordinator) {
    if (currentUser?.role !== 'admin') {
      return { ok: false, message: 'Only HR can re-issue a passcode.' };
    }
    const uid = coordinator?.uid;
    if (!uid) return { ok: false, message: 'Missing coordinator.' };
    try {
      const passcode = await rotateCoordinatorPasscode(uid, {
        phone: coordinator?.phone,
        currentCode: coordinator?.loginCode,
      });
      return { ok: true, passcode };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  async function logout() {
    // AWAITED, deliberately. stopSharingLocation now also stops the OS task and
    // deletes driverLocations/<uid>, and that delete needs the auth token — signing
    // out first would have the rules refuse it and leave the last fix published for
    // a driver who is no longer signed in. onDisconnect would eventually clear it,
    // but "eventually" is a minute of a phantom cab on the desk's map.
    await stopSharingLocation();
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
  //
  // REFUSED FOR DRIVERS AND COORDINATORS, and not as a matter of tidiness. Their
  // Firebase password IS the code the desk issued them; replacing it with
  // something they chose would succeed, and then their login screen could never
  // accept it again — a driver's takes a 14-digit code and nothing else, a
  // coordinator's takes a phone plus the 4-digit passcode.
  //
  // A driver's code can at least be recomputed from cab + phone (see
  // rotateDriverLoginCode). A coordinator's passcode is RANDOM and mirrored only
  // on their profile, so a password changed out from under that mirror could not
  // be recovered by anyone — rotateCoordinatorPasscode signs in with the stored
  // code, which would no longer work. The account would be scrap.
  //
  // The drawer already hides the action for both; this is the backstop that makes
  // a future screen, or a stale bundle, unable to reopen the hole.
  async function changePassword(currentPassword, newPassword) {
    if (currentUser?.role === 'driver') {
      return {
        ok: false,
        message:
          'Drivers sign in with the code from the transport desk, so there is no password to change. Your code changes when your cab changes.',
      };
    }
    if (currentUser?.role === 'coordinator') {
      return {
        ok: false,
        message:
          'You sign in with your phone number and the passcode HR gave you, so there is no password to change. Ask HR to issue a new passcode if you have lost it.',
      };
    }
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
      // Drivers see trips assigned to their cab, and only for the current run's
      // window — the query is date-bounded (DRIVER_WINDOW_DAYS in services/bookings)
      // rather than streaming every trip the cab has ever been given.
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

  // --- Cab service requests (employee's own, live) ------------------------
  // Someone who signed in from the directory without an invite has no address
  // and no route, so no cab can be sent for them. This is how they see whether
  // the desk has dealt with their request yet.
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'employee' || !firestore) {
      setMyCabServiceRequests([]);
      return;
    }
    return subscribeMyCabServiceRequests(
      currentUser.uid,
      setMyCabServiceRequests,
      onSubError('cab service requests')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  // --- Cab service requests (the desk's queue, live) ----------------------
  // BOTH desk roles, unlike address requests: the coordinator is the one who
  // knows which pickup route an address sits on, so they triage the route and
  // the admin approves. The rules allow either to read.
  useEffect(() => {
    if (!firestore || !isDeskRole(currentUser?.role)) {
      setCabServiceRequests([]);
      return;
    }
    return subscribeCabServiceRequests(
      setCabServiceRequests,
      onSubError('cab service requests')
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
  // TWO PATHS, ONE FEED.
  //
  //   NATIVE — Location.startLocationUpdatesAsync drives a TaskManager task (see
  //     services/locationTask.js). Tracking survives the phone locking, a call, and
  //     the driver switching to Google Maps via Navigate. Requires a development or
  //     production build: background location does NOT work in Expo Go.
  //   WEB — the original watchPositionAsync watcher. The browser has no background
  //     location at all: updates stop when the tab is hidden or the laptop sleeps.
  //     Kept because the desk and employees use the web app, and it is honest about
  //     what it is — `trackingBackground` below tells the UI which path is running.
  //
  // The published data is identical either way: updateMyLocation() writing
  // driverLocations/<uid> with a server timestamp.
  const [sharingLocation, setSharingLocation] = useState(false);
  const [sharingCoords, setSharingCoords] = useState(null);
  const [sharingError, setSharingError] = useState('');
  // When the last fix was actually WRITTEN, not when the switch was flipped.
  // "The switch is on" and "GPS is reaching the database" are different facts, and
  // the OTP gate needs the second one — see trackingFresh below.
  const [sharingSince, setSharingSince] = useState(null);
  // Whether the OS task is running (survives backgrounding) or only the foreground
  // watcher is. The driver is told which, because the difference is the whole point.
  const [sharingBackground, setSharingBackground] = useState(false);
  const [lastFixAt, setLastFixAt] = useState(null);
  const locationWatcher = useRef(null);
  const sharingUid = useRef(null);

  // Every published fix funnels through here, on both paths, so freshness is
  // measured in one place.
  const notePublishedFix = useCallback((coords) => {
    setSharingCoords(coords);
    setLastFixAt(Date.now());
  }, []);

  async function stopSharingLocation() {
    // Foreground watcher (web, and the first fix on native).
    if (locationWatcher.current) {
      locationWatcher.current.remove();
      locationWatcher.current = null;
    }
    // The OS-driven task. Stopped before the node is cleared, or a fix already in
    // flight could re-create what we just deleted.
    if (Platform.OS !== 'web') {
      try {
        const task = require('../services/locationTask');
        await task.forgetSharingDriver();
        await task.stopBackgroundUpdates();
      } catch (e) {
        console.warn('[tracking] could not stop background updates:', e?.message);
      }
    }
    // Clear the published position too. Leaving the last fix behind made a parked
    // cab look live to every employee watching it.
    if (sharingUid.current) {
      const uid = sharingUid.current;
      // TWO INDEPENDENT CALLS, NOT A CHAIN. Clearing the node was chained behind
      // the onDisconnect cancel with .finally() — so if that acknowledgement never
      // came back, the position was never deleted and the cab stayed on the desk's
      // map after the driver switched sharing off. The delete is the part that
      // matters, so nothing is allowed to gate it.
      clearMyLocation(uid).catch((e) =>
        console.warn('[tracking] could not clear location:', e?.message)
      );
      // Cancel the standing server-side delete too: this is a deliberate stop, and a
      // queued onDisconnect could otherwise fire against a node the driver
      // legitimately starts publishing to again later in the same session.
      releaseLocationNode(uid).catch((e) =>
        console.warn('[tracking] could not cancel onDisconnect:', e?.message)
      );
      sharingUid.current = null;
    }
    setSharingLocation(false);
    setSharingBackground(false);
    setSharingCoords(null);
    setSharingSince(null);
    setLastFixAt(null);
    // Riders are NOT reverted — a cab that stopped broadcasting has not turned
    // around, and "On the way → Cab assigned" isn't a transition the rules even
    // allow a driver to make. Clearing the claim set only means a later restart
    // is free to re-attempt anything the first flip failed to write.
    markedOnTheWay.current.clear();
  }

  // Start streaming this device's location for the driver's cab. Returns
  // { ok, denied?, message? } so the caller can show the right feedback.
  // The foreground watcher. On WEB it is the whole implementation; on NATIVE it
  // runs alongside the task purely to get a first fix on screen immediately — the
  // OS task's first delivery can be several seconds out, and a driver watching
  // "Waiting for GPS" while nothing happens turns sharing off again.
  async function startForegroundWatcher(uid) {
    if (locationWatcher.current) locationWatcher.current.remove();
    locationWatcher.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
      (loc) => {
        const { latitude, longitude } = loc.coords;
        notePublishedFix({ latitude, longitude });
        updateMyLocation(uid, { latitude, longitude }).catch((e) => {
          // A rejected write means the rules refused it, or we're offline — say so
          // rather than silently pretending to broadcast.
          console.warn('[tracking] location write failed:', e?.message);
          setSharingError('Could not publish your location. Check your connection.');
        });
      }
    );
  }

  // Start publishing this driver's location. Returns { ok, denied?, message? } so
  // the caller can show the right feedback.
  //
  // `resumed` is set by the restart path below: it suppresses the background
  // permission PROMPT, because a driver reopening the app has not asked for
  // anything and should not be interrogated by a system dialog on launch. If the
  // grant is already there the task starts silently; if it isn't, sharing comes
  // back as foreground-only and says so.
  async function startSharingLocation({ resumed = false } = {}) {
    setSharingError('');
    const uid = currentUser?.uid;
    if (!currentUser?.cabId) {
      const message = 'No cab is linked to your account. Ask the transport desk to link one.';
      setSharingError(message);
      return { ok: false, message };
    }

    // FOREGROUND FIRST, ALWAYS. expo-location refuses background permission unless
    // foreground is already granted, so the order here is a requirement of the API
    // and not a preference.
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      setSharingError('Location permission denied.');
      return { ok: false, denied: true };
    }

    let background = false;
    if (Platform.OS !== 'web') {
      try {
        // "Allow all the time" on Android / "Always" on iOS. A refusal is NOT a
        // failure: the driver still gets foreground tracking, which is what the app
        // had before, and the UI is told which one is running.
        const bg = resumed
          ? await Location.getBackgroundPermissionsAsync()
          : await Location.requestBackgroundPermissionsAsync();
        background = bg.status === 'granted';
      } catch (e) {
        console.warn('[tracking] background permission check failed:', e?.message);
      }
    }

    try {
      sharingUid.current = uid;
      // NOT AWAITED. This is a server-side safety net, and it was blocking the thing
      // it protects: `.remove()` only resolves once RTDB acknowledges it, so on a
      // slow or proxied connection the driver could never turn sharing on. Tracking
      // starts now; the cleanup registers as soon as the socket allows, and until it
      // does, LIVE_WINDOW_MS is what stops a stale fix reading as live.
      claimLocationNode(uid).catch((e) =>
        console.warn('[tracking] onDisconnect arming failed:', e?.message)
      );

      if (background) {
        const task = require('../services/locationTask');
        // Persist the intent + uid first: the task reads both, and on Android it can
        // start delivering the instant startBackgroundUpdates resolves.
        await task.rememberSharingDriver(uid);
        await task.startBackgroundUpdates();
      }
      // Always run the foreground watcher too — see the note on it above.
      await startForegroundWatcher(uid);

      setSharingLocation(true);
      setSharingBackground(background);
      setSharingSince(Date.now());
      if (!background && Platform.OS !== 'web') {
        setSharingError(
          'Tracking only while the app is open. Allow location "all the time" in ' +
            'settings so the cab stays visible when your screen is off.'
        );
      }
      return { ok: true, background };
    } catch (e) {
      sharingUid.current = null;
      const message = e.message || 'Could not start location updates.';
      setSharingError(message);
      return { ok: false, message };
    }
  }

  // Stop sharing automatically if the user logs out or is no longer a driver
  // with a cab — never keep broadcasting for someone who shouldn't be. This also
  // clears the persisted intent, so a driver whose cab was unlinked doesn't have
  // tracking silently resume the next time they open the app.
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'driver' || !currentUser.cabId) {
      stopSharingLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role, currentUser?.cabId]);

  // SHARING IS THE IGNITION.
  //
  // Turning the switch on is what puts a cab's riders at "On the way" — no
  // driver tap sets that status any more. Before this the two were unrelated, so
  // a driver could tap "Start Trip" while broadcasting nothing and the rider sat
  // watching a map with no cab on it. They are one fact now, and it is the fact
  // the driver was going to perform anyway.
  //
  // AN EFFECT, NOT A LINE INSIDE startSharingLocation(), for three reasons that
  // are each a bug on their own:
  //   • the resume-after-restart path starts sharing before `bookings` has come
  //     back from Firestore, so an inline write would mark nobody at all;
  //   • nothing here may sit in the path of the GPS starting — if this write is
  //     refused, sharing must be unaffected and the trip still runs;
  //   • a rider the desk adds to the cab mid-run would never be marked, because
  //     the switch was flipped before they existed. Reacting to `bookings` picks
  //     them up.
  //
  // SCOPED TO TODAY'S ACTIVE RUN, NOT THE CAB. A driver holds their pickup and
  // their drop at the same time — both are in `bookings` all day. Marking the
  // whole cab at 8 PM would tell the 10 PM riders their cab was on its way, and
  // would quietly close their cancellation window, because rideCancelState()
  // treats "On the way" as the point of no return. The day filter also stops a
  // run left half-finished yesterday being mistaken for tonight's work.
  const markedOnTheWay = useRef(new Set());

  useEffect(() => {
    if (!sharingLocation) return;
    if (currentUser?.role !== 'driver' || !currentUser?.cabId) return;

    const today = todayKey();
    const mine = bookings.filter(
      (b) => b.assignedCabId === currentUser.cabId && b.status !== STATUS.CANCELLED
    );
    const run = activeRun(groupRuns(mine), today);
    if (!run) return;

    // Only riders still at "Cab assigned" — see the note on idsToMarkOnTheWay.
    // firestore.rules would accept "On the way" written over "On board", so this
    // filter is what stops a re-flip of the switch walking a run backwards.
    const ids = idsToMarkOnTheWay(run.riders).filter((id) => !markedOnTheWay.current.has(id));
    if (!ids.length) return;

    // Claimed BEFORE the write, because this write itself changes `bookings` and
    // re-runs this effect — without the claim a second identical batch would go
    // out while the first was still in flight.
    ids.forEach((id) => markedOnTheWay.current.add(id));
    setBookingStatuses(ids, STATUS.ON_THE_WAY).catch((e) => {
      console.warn('[trip] could not mark the run on its way:', e?.message);
      // Released after a pause rather than retried in a loop: the next snapshot
      // or the next flip of the switch will try again, while a write that is
      // being refused outright cannot hammer Firestore.
      setTimeout(() => ids.forEach((id) => markedOnTheWay.current.delete(id)), 15000);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharingLocation, bookings, currentUser?.uid, currentUser?.role, currentUser?.cabId]);

  // RESUME AFTER A RESTART.
  //
  // The switch used to be plain React state initialised to false, so any reload,
  // crash or OS process kill left sharing off with nothing saying so — the driver
  // had to notice and turn it back on. The intent now lives in AsyncStorage, and
  // this is what honours it.
  //
  // THREE RULES, ALL OF THEM ABOUT NOT LYING:
  //   • Only resume if the driver had it ON. A deliberate OFF stays off — this
  //     never re-enables tracking behind their back.
  //   • Only resume if the permission is still granted. It can be revoked from
  //     system settings between runs, and `resumed: true` means we CHECK the
  //     background grant rather than prompting on launch.
  //   • If it can't resume, leave the switch OFF and put the reason in
  //     sharingError. Showing "ON" while nothing is publishing is the one outcome
  //     worth going out of the way to prevent.
  useEffect(() => {
    if (Platform.OS === 'web') return; // no background task, nothing to resume
    if (currentUser?.role !== 'driver' || !currentUser?.cabId) return;
    let cancelled = false;

    (async () => {
      try {
        const task = require('../services/locationTask');
        const { wanted, uid } = await task.readSharingIntent();
        if (cancelled || !wanted) return;
        // Belt and braces: the stored uid must be THIS driver. A shared device that
        // switched accounts must not resume publishing under the previous one.
        if (uid && uid !== currentUser.uid) {
          await task.forgetSharingDriver();
          await task.stopBackgroundUpdates();
          return;
        }
        const fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
          await task.forgetSharingDriver();
          await task.stopBackgroundUpdates();
          if (!cancelled) {
            setSharingError(
              'Location sharing was on, but permission is no longer granted. Turn it back on to share your cab.'
            );
          }
          return;
        }
        // The OS may still be running the task from before the restart. Either way
        // startSharingLocation is idempotent — startBackgroundUpdates checks
        // hasStartedLocationUpdatesAsync first.
        if (!cancelled) await startSharingLocation({ resumed: true });
      } catch (e) {
        console.warn('[tracking] could not resume sharing:', e?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
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
    // Absolute departure instant, so the backend (Firestore rules) can compare it
    // to server time and block an EMPLOYEE booking a past or too-soon ride — the
    // stored `date`/`shift` strings can't be compared there. It no longer gates the
    // desk's cab assignment: that check was removed so a late ride can still be
    // covered (see assignCab below and `validDeskBooking` in firestore.rules).
    const departAt = toDateTime(data.date, data.shift); // Date → Firestore Timestamp
    return {
      employeeId: currentUser.uid,
      employeeName: currentUser.name,
      // Both are carried for the driver's trip list, which shows the name and falls
      // back to the ID — a driver cannot read employee profiles to look up either.
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
  // Guards: the cab must have a free seat, and it must not already be doing a
  // different trip at that time. These run even if the UI is bypassed, since
  // every assign goes through here.
  //
  // THERE IS NO TIME LIMIT. A ride whose shift time has already passed used to be
  // refused here with "assignment is closed", which got the priority backwards —
  // the late ride is the one the desk is chasing. A cab arranged at 8:20 PM for
  // an 8:00 PM pickup is a rider who got to work; refusing the write is a rider
  // left at the gate with the app insisting no cab was ever sent. The matching
  // rule in `firestore.rules` was dropped with it, so the write actually lands.
  async function assignCab(bookingId, cabId) {
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return { ok: false, message: 'That booking no longer exists.' };
    const problem = cabAssignmentProblem(cabId, [b]);
    if (problem) return { ok: false, message: problem };
    try {
      await assignCabToBooking(bookingId, cabId);
      // Email the rider. Queued, not awaited — the assignment is already done
      // and a mail problem must never surface as a failed assignment.
      queueCabAssignedEmails([{ bookingId, employeeId: b.employeeId }]);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not assign the cab.');
    }
  }

  // Admin assigns one cab to several bookings (carpool grouping). Rejects the
  // whole batch only if the cab doesn't have room for everyone — a ride whose
  // time has passed is assignable, same as the single case above.
  async function assignCabToGroup(bookingIds, cabId) {
    const rides = bookingIds.map((id) => bookings.find((x) => x.id === id)).filter(Boolean);
    if (rides.length !== bookingIds.length) {
      return { ok: false, message: 'Some selected bookings no longer exist. Refresh and retry.' };
    }
    const problem = cabAssignmentProblem(cabId, rides);
    if (problem) return { ok: false, message: problem };
    try {
      await assignCabToBookings(bookingIds, cabId);
      // One email each — a carpool is many riders sharing one cab.
      queueCabAssignedEmails(
        rides.map((r) => ({ bookingId: r.id, employeeId: r.employeeId }))
      );
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

  // --- Employee cancels a ride they no longer need ---------------------------

  // Everything the UI and the write path both need to know about cancelling one
  // ride, worked out in ONE place: whether it can still be cancelled, when the
  // door closes, and — when it can't — the sentence to show instead.
  //
  // Both callers read this same function deliberately. A button that greys
  // itself out on one rule while the submit path enforces another is how a ride
  // ends up cancellable-looking but un-cancellable, or worse the reverse. The
  // cutoff itself is canRequestCancel + CANCEL_CUTOFF_HOURS — the app's existing
  // policy, not a second copy of it — and the deadline shown to the employee is
  // derived from the same parse of date + shift.
  // `cutoffHours` defaults to the EMPLOYEE's window, so every existing caller keeps
  // its behaviour untouched. The desk passes its own — see deskCancelState below.
  // Parameterised rather than duplicated: one definition of "already under way",
  // "already cancelled" and "deadline passed", with only the number differing.
  function rideCancelState(booking, cutoffHours = CANCEL_CUTOFF_HOURS) {
    const deadline = booking ? cancelDeadline(booking.date, booking.shift, cutoffHours) : null;
    const base = { canCancel: false, deadline, reason: '' };
    if (!booking) return { ...base, reason: 'That ride no longer exists.' };
    if (booking.status === STATUS.CANCELLED) {
      return { ...base, reason: 'This ride is already cancelled.' };
    }
    // Once the trip is under way or over, cancelling is meaningless — the cab
    // has been sent, or the journey happened.
    if ([
      STATUS.ON_THE_WAY, STATUS.ARRIVED, STATUS.ON_BOARD, STATUS.COMPLETED, STATUS.NO_SHOW,
    ].includes(booking.status)) {
      return { ...base, reason: 'This ride is already under way, so it can no longer be cancelled.' };
    }
    if (!canRequestCancel(booking.date, booking.shift, cutoffHours)) {
      return {
        ...base,
        reason: 'Cancellation is no longer available. The cancellation deadline has passed.',
      };
    }
    return { canCancel: true, deadline, reason: '' };
  }

  // The DESK's window on the same ride: 30 minutes instead of the rider's 4 hours.
  // A thin wrapper on purpose — the screens and the submit guard must both ask the
  // same question, and there is no second copy of the logic to fall out of step.
  function deskCancelState(booking) {
    return rideCancelState(booking, DESK_CANCEL_CUTOFF_HOURS);
  }

  // The employee drops a ride outright, giving a reason. Unlike requestCancel()
  // this does not wait on the desk: the seat is freed immediately and the
  // coordinator is told what happened rather than asked to approve it.
  //
  // The cutoff is re-checked HERE, at submit time, and not merely when the
  // button was drawn — a dialog can sit open across the deadline, and a stale
  // screen must not be able to post a cancellation that is no longer allowed.
  // `firestore.rules` then checks it a third time against the server's own
  // clock, which is the only check a wound-back device can't talk its way past.
  async function cancelAssignedRide(bookingId, reason) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const b = bookings.find((x) => x.id === bookingId);
    if (!b) return { ok: false, message: 'That ride no longer exists.' };
    if (b.employeeId !== currentUser.id) {
      return { ok: false, message: 'You can only cancel your own rides.' };
    }
    const text = String(reason || '').trim();
    if (!text) {
      return { ok: false, message: 'Please give a reason for cancelling.' };
    }
    const state = rideCancelState(b);
    if (!state.canCancel) return { ok: false, message: state.reason };
    try {
      await cancelAssignedBooking(bookingId, { reason: text, uid: currentUser.id });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not cancel that ride.');
    }
  }

  // Rides the RIDER cancelled themselves on a given date — the coordinator's
  // view of "who dropped out, and why". Told apart from a desk-side cancellation
  // by `cancelledBy` matching the rider, which only this path writes.
  function employeeCancellationsOn(date) {
    return bookings.filter(
      (b) =>
        b.date === date &&
        b.status === STATUS.CANCELLED &&
        b.cancelledBy &&
        b.cancelledBy === b.employeeId
    );
  }

  // THE DESK CANCELS A RIDE FOR AN EMPLOYEE WHO ASKED OFF-APP.
  //
  // Teams, WhatsApp, a phone call at 8 PM — the rider tells the desk they no longer
  // need the cab and never opens the app. Neither existing path covers that:
  // approveCancel() needs a request that was never raised, and cancelAssignedRide()
  // is the rider's own button, gated by the 4-hour cutoff they are almost certainly
  // now inside.
  //
  // THE CUTOFF APPLIES TO THE DESK TOO. (Reversed at explicit request — this
  // originally exempted the desk, on the reasoning that an emergency reported at
  // 7:50 PM for an 8:00 PM pickup is exactly what the desk has to be able to act on.
  // The decision now is that one deadline governs everyone.)
  //
  // THE DESK'S WINDOW IS ITS OWN: DESK_CANCEL_CUTOFF_HOURS (30 minutes), against the
  // employee's 4 hours. The desk is who gets phoned at 9:40 PM about a 10 PM drop, and
  // holding them to the rider's deadline would have closed every ride on the evening
  // board by 6 PM — see the note on the constant.
  //
  // The last 30 minutes stay closed to everyone, deliberately: by then the driver is
  // at or near the pickup, and the honest record is a no-show, not a cancellation.
  //
  // ALSO CHECKED: the role, and the ride's state. A finished ride has nothing left to
  // cancel, and cancelling an already-cancelled one would overwrite the record of who
  // did it first.
  //
  // Takes `ride` (a derived ride from the day board) OR a booking — the board's
  // unassigned rides have no document yet, so this handles both: update if there is
  // one, create it already-cancelled if there is not.
  async function deskCancelRide(rideOrBooking, reason) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can cancel a ride.' };
    }
    // OPTIONAL, at explicit request. The dialog no longer asks for one, so this is
    // normally empty and the record says who/when/which role but not why. Still
    // accepted and still bounded, so re-adding the picker is a UI change only.
    const text = String(reason || '').trim().slice(0, 500);

    const target = rideOrBooking?.booking || rideOrBooking;
    if (!target) return { ok: false, message: 'That ride no longer exists.' };

    const status = target.status || rideOrBooking?.status;
    // Mirrors the rules, and mirrors what the button offers — a screen left open can
    // outlive the state it was drawn for.
    if (status === STATUS.CANCELLED) {
      return { ok: false, message: 'That ride is already cancelled.' };
    }
    if (status === STATUS.COMPLETED || status === STATUS.NO_SHOW) {
      return { ok: false, message: 'That trip has already finished — nothing to cancel.' };
    }
    // Re-checked HERE, at submit time, not merely when the button was drawn: a dialog
    // can sit open across the deadline. firestore.rules checks it again against the
    // SERVER's clock, which is the only check a wound-back device can't get past.
    // `target` is a booking when one exists and the derived ride when it doesn't —
    // both carry `date` and `shift`, which is all the deadline needs.
    if (!canRequestCancel(target.date, target.shift, DESK_CANCEL_CUTOFF_HOURS)) {
      return {
        ok: false,
        message:
          'Too close to the pickup time to cancel — the cab may already be on its way. ' +
          'If nobody travels, the driver marks it as a no-show.',
      };
    }

    const audit = { reason: text, uid: currentUser.uid, role: currentUser.role };
    try {
      if (target.id) {
        await deskCancelBooking(target.id, audit);
      } else {
        // No booking document — a rostered ride nobody has assigned a cab to yet.
        // bookingFromRide gives it the same shape the assign path would have, so the
        // record is a normal booking that happens to start life cancelled.
        const ride = rideOrBooking;
        if (!ride?.employeeId || !ride?.date) {
          return { ok: false, message: 'Could not identify that ride.' };
        }
        // Same departAt as the assign path uses (line ~2344), so a desk-cancelled
        // ride carries the same absolute timestamp the rules and reports read.
        await createDeskCancelledBooking(
          bookingFromRide(ride, toDateTime(ride.date, ride.shift)),
          audit
        );
      }
    } catch (e) {
      return failure(e, 'Could not cancel that ride.');
    }

    // The rider asked for this off-app, but they still get the confirmation in the
    // app — and so does anyone the desk cancelled without being asked. Uses the
    // EXISTING notification mechanism (NOTIFY.RIDE_CANCELLED + rideCancelledMessage
    // were already defined and unused); nothing new was introduced for this.
    // Best-effort: a failed notice must not undo a cancellation that has committed.
    const employeeId = target.employeeId || rideOrBooking?.employeeId;
    if (employeeId) {
      const msg = rideCancelledMessage(
        {
          date: target.date || rideOrBooking?.date,
          direction: target.direction || rideOrBooking?.direction,
        },
        // No trailing dash when there is no reason — which is now the normal case.
        text
          ? `Cancelled by the transport desk — ${text}`
          : 'Cancelled by the transport desk.'
      );
      notify({
        employeeId,
        type: NOTIFY.RIDE_CANCELLED,
        title: msg.title,
        body: msg.body,
        payload: { bookingId: target.id || null, date: target.date || rideOrBooking?.date },
      }).catch((e) => console.warn('[notify] desk cancellation notice failed:', e?.message));
    }

    return { ok: true };
  }

  // Rides the DESK stood down on a given date — the coordinator's view of "what did
  // HR cancel while I was working the board?".
  //
  // WHY THIS EXISTS AT ALL. A cancelled ride is filtered out of ridesOn(), so it
  // simply disappears from the day board. That is right — the coordinator must not be
  // able to assign a cab to it — but a row vanishing with no explanation is its own
  // problem: the coordinator is the one who assigns cabs, and "did that rider drop
  // out, or did I mis-read the board?" is not a question they should have to ask.
  //
  // Kept SEPARATE from employeeCancellationsOn() rather than merged into it. Those
  // two are different events with different consequences — a rider cancelling is
  // news about the rider; the desk cancelling is news about a decision someone at
  // the desk already made — and merging them would also put desk cancellations into
  // the rider drop-out count, which is exactly what that function exists to keep out.
  // UNDOING A DESK CANCELLATION. Only the desk's own cancellations, and only
  // while they are still cancelled — a rider's cancellation is theirs, and the
  // outcome of a change request is undone by reopening the request, not here.
  async function restoreDeskCancelledRide(booking) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can restore a ride.' };
    }
    if (!booking?.id) return { ok: false, message: 'That ride no longer exists.' };
    if (booking.status !== STATUS.CANCELLED) {
      return { ok: false, message: 'That ride is not cancelled — there is nothing to restore.' };
    }
    if (booking.cancellationSource !== 'desk') {
      return {
        ok: false,
        message:
          'Only a cancellation made by the transport desk can be reversed here. ' +
          'This one came from the rider.',
      };
    }

    // THE ONE WAY THIS SILENTLY DOES NOTHING. ridesOn() runs the restored ride
    // back through excuseResolvedRequests(), which drops any ride already excused
    // by a resolved Leave or Cancel-one-ride. Put the booking back and the row
    // would leave this banner and still not appear on the board — so say so
    // instead, and name the thing that has to be reopened first.
    const excused = (changeRequests || []).some(
      (r) =>
        r.status === REQUEST_STATUS.RESOLVED &&
        r.employeeId === booking.employeeId &&
        ((r.effect === EFFECT.CANCEL_DAY && r.date === booking.shiftDate) ||
          (r.effect === EFFECT.CANCEL_RIDE && !!r.rideKey && r.rideKey === booking.rideKey))
    );
    if (excused) {
      return {
        ok: false,
        message:
          `${booking.employeeName || 'This rider'} also has an approved request off this ` +
          'ride, so it would stay off the board. Reopen that request first.',
      };
    }

    try {
      await restoreDeskCancelledBooking(booking.id, {
        uid: currentUser.uid,
        role: currentUser.role,
      });
    } catch (e) {
      return failure(e, 'Could not restore that ride.');
    }

    // Best-effort, exactly as the cancellation notice is: the restore has already
    // committed and a failed notice must not read as a failed restore.
    if (booking.employeeId) {
      const msg = rideRestoredMessage(booking);
      notify({
        employeeId: booking.employeeId,
        type: NOTIFY.RIDE_RESTORED,
        title: msg.title,
        body: msg.body,
        payload: { bookingId: booking.id, date: booking.date },
      }).catch((e) => console.warn('[notify] ride restored notice failed:', e?.message));
    }

    return { ok: true };
  }

  function deskCancellationsOn(date) {
    return bookings.filter(
      (b) => b.date === date && b.status === STATUS.CANCELLED && b.cancellationSource === 'desk'
    );
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

  // The run-level version: one status onto a whole cab, in one commit. Used by
  // the driver's cab-level buttons — "At the office", "Trip complete" — and by
  // the location-sharing hook below.
  //
  // Callers pass ids ALREADY narrowed by current status (the selectors in
  // services/driverRun.js do that). This is not belt-and-braces: a batch is
  // atomic, so one rider the rules would refuse takes the whole cab down with
  // them.
  //
  // WHICH IS WHY THERE IS A FALLBACK. If the batch is refused anyway — a rider
  // moved to another cab a second ago, a status that changed between render and
  // tap — retrying each booking on its own means one stale trip cannot strand a
  // driver at the office with a button that will never work. It reports what
  // actually landed rather than claiming success.
  async function updateBookingStatuses(bookingIds, status) {
    const ids = [...new Set((bookingIds || []).filter(Boolean))];
    if (!ids.length) return { ok: true, count: 0 };
    try {
      await setBookingStatuses(ids, status);
      return { ok: true, count: ids.length };
    } catch (e) {
      const settled = await Promise.allSettled(ids.map((id) => setBookingStatus(id, status)));
      const count = settled.filter((r) => r.status === 'fulfilled').length;
      if (count === ids.length) return { ok: true, count };
      console.warn('[trip] batch status write fell back;', count, 'of', ids.length, 'landed');
      return {
        ok: false,
        count,
        message: count
          ? `Updated ${count} of ${ids.length} trips. Refresh and try the rest.`
          : failure(e, 'Could not update the trips.').message,
      };
    }
  }

  // The driver types in the six digits the rider reads off their own screen, and
  // the trip becomes "On board". This is the ONLY way into that status: the check
  // is in firestore.rules against a document the driver cannot read, so a wrong
  // code comes back as a permission error rather than a polite refusal we chose
  // to honour. The message says what to do next, because a driver standing at a
  // gate at 8 PM needs an instruction, not a diagnosis.
  async function startRideWithOtp(bookingId, code) {
    try {
      await startRideWithOtpSvc(bookingId, code);
      return { ok: true };
    } catch (e) {
      if (e?.code === 'permission-denied') {
        return {
          ok: false,
          message: "That code didn't match. Ask the employee to read it out again from their app.",
        };
      }
      return failure(e, 'Could not start the ride.');
    }
  }

  // Driver flags a no-show: reached the pickup but the employee wasn't there.
  //
  // WHO FINDS OUT, AND HOW. A no-show is a claim about a person made by someone
  // else, and until this it was silent — it appeared on the desk's No-Shows
  // screen and nowhere else, so the rider only learned of it if somebody
  // happened to mention it. Now:
  //
  //   • THE RIDER gets an in-app notification, because they are the only one who
  //     can say the claim is wrong and they can only do that if they are told
  //     while they still remember the evening.
  //   • THE DESK (admin and coordinator) get a live count on their No-Shows menu
  //     row — the same badge mechanism Address Requests and New Cab Requests
  //     already use. They have no notification inbox of their own, and the
  //     driver's app cannot address one to them anyway: the rules deliberately
  //     stop a driver reading employee profiles, so it cannot discover who the
  //     admins are. See `menuCounts`.
  //
  // BEST-EFFORT, AND DELIBERATELY AFTER THE FACT. The flag is already saved by
  // the time this runs; a failed notification must never read as a failed
  // no-show, or a driver stands at a kerb tapping a button that has in fact
  // already worked.
  async function markNoShow(bookingId) {
    try {
      await markBookingNoShow(bookingId);
      const booking = bookings.find((b) => b.id === bookingId);
      if (booking?.employeeId) {
        const msg = noShowMessage(booking, SUPPORT_HELPLINE);
        notify({
          employeeId: booking.employeeId,
          type: NOTIFY.NO_SHOW,
          title: msg.title,
          body: msg.body,
          // The rule that lets a driver write this reads the booking back to
          // check the rider is really on their cab, so the id is not optional
          // decoration — without it the write is refused.
          payload: { bookingId },
        }).catch((e) => console.warn('[notify] no-show notice failed:', e?.message));
      }
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
    const live = [STATUS.ASSIGNED, STATUS.ON_THE_WAY, STATUS.ARRIVED, STATUS.ON_BOARD];
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
  // Add a driver: a name and a phone number, and that is the whole form.
  //
  // A driver is still a LOGIN — they sign in to see their trips and to broadcast
  // the cab's position — but not an email/password one. The phone IS the account
  // (it derives the address Firebase keys them by, see utils/driverLogin.js), and
  // the code they actually type is issued when the desk links them to a cab. Until
  // then they hold an unguessable placeholder and cannot sign in at all, which is
  // deliberate: a driver with no cab has no trips and no cab to broadcast for.
  async function addDriverAccount({ name, phone }) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can add a driver.' };
    }
    const cleanName = (name || '').trim();
    const digits = driverPhone(phone);
    if (!cleanName) return { ok: false, message: "Enter the driver's name." };
    if (!digits) {
      return {
        ok: false,
        message: 'Enter a 10-digit phone number — it is half of their login code.',
      };
    }
    try {
      await adminCreateDriver({ name: cleanName, phone: digits });
      return { ok: true };
    } catch (e) {
      // One phone is one account, because the phone derives the Firebase address.
      // Say that, rather than leaking a synthesized email address at the person
      // reading the message.
      //
      // The second half matters: removing a driver deletes their PROFILE but not
      // their Firebase login (only the Admin SDK can do that), so re-adding
      // someone who was removed lands here even though no driver by that number
      // appears in the list. Point at where the leftover actually is.
      if (e?.code === 'auth/email-already-in-use') {
        return {
          ok: false,
          message: `${digits} already has a driver login. If no driver with that number is in the list, it was left behind by one you removed — delete that user under Authentication in the Firebase console, or use a different number.`,
        };
      }
      return failure(e, 'Could not create that driver account.');
    }
  }

  // Force a driver's login code back into step with their cab link. The desk's
  // repair for the one state nothing else can fix: a rotation that stopped halfway,
  // leaving the code stored on the profile disagreeing with the password Firebase
  // actually holds.
  //
  // It repairs BOTH directions, which is why it isn't simply "regenerate":
  //   • on a cab → set the code that cab implies, so the desk can hand it out;
  //   • on no cab → set the unassigned value, WITHDRAWING a code that outlived the
  //     assignment it came from. Refusing this case (as this used to) left the only
  //     failed revocation in the system with no way to complete it.
  //
  // Safe to press at any time: it recomputes what the link already implies, so a
  // driver who was fine ends up exactly as they were.
  //
  // Takes the whole driver record rather than a uid: the Drivers screen already
  // has it live from subscribeDrivers(), and drivers are deliberately absent from
  // this context's `employees` subscription (which is riders only).
  async function regenerateDriverCode(driver) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can do that.' };
    }
    const uid = driver?.uid;
    if (!uid) return { ok: false, message: 'Missing driver.' };
    const phone = driver?.phone ?? '';
    if (!driverPhone(phone)) {
      return { ok: false, message: 'That driver has no valid 10-digit phone number on file.' };
    }
    const cab = fleetCabs.find((c) => c.driverUid === uid) || null;
    const nextCode = cab
      ? driverLoginCode(cab.cabNumber, phone)
      : unassignedLoginCode(phone);
    if (!nextCode) {
      return {
        ok: false,
        message: `${cab.cabNumber} has fewer than 4 digits in its number, so no code can be built from it.`,
      };
    }
    try {
      await rotateDriverLoginCode(uid, {
        phone,
        currentCode: driver?.loginCode,
        nextCode,
      });
      // `code` only when there is one to hand over — with no cab this was a
      // withdrawal, and reporting the unassigned value as a "code" would invite
      // someone to pass a driver's own phone number off as a login.
      return { ok: true, code: cab ? nextCode : '' };
    } catch (e) {
      return failure(
        e,
        'Could not fix that code. If it keeps failing, remove the driver and add them again.'
      );
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

  // Edit a vehicle's details. Returns { ok, message?, codeWarning? }.
  //
  // `codeWarning` is set when the cab saved but its driver's login code could not
  // be re-issued to match the new number — the save worked, and their OLD code is
  // still the one that works. Never swallow it: the desk would otherwise read out
  // a code that doesn't sign in.
  async function editCab(id, fields) {
    const problem = cabDetailsProblem(fields);
    if (problem) return { ok: false, message: problem };
    try {
      const { codeWarning } = await updateCab(id, fields);
      return { ok: true, codeWarning };
    } catch (e) {
      return failure(e, 'Could not save the cab.');
    }
  }

  // Point a cab at a driver account — this is what switches on that cab's live
  // tracking AND issues the driver's login code. Pass null to detach, which
  // revokes it. Returns { ok, message?, codeWarning? }.
  async function assignDriverToCab(cabId, driverUid) {
    try {
      const { codeWarning } = await linkCabDriver(cabId, driverUid || null);
      return { ok: true, codeWarning };
    } catch (e) {
      return failure(e, 'Could not link that driver.');
    }
  }

  // Detach a driver from a cab without deleting the vehicle.
  async function unlinkDriverFromCab(cabId) {
    try {
      const { codeWarning } = await unlinkCabDriver(cabId);
      return { ok: true, codeWarning };
    } catch (e) {
      return failure(e, 'Could not detach that driver.');
    }
  }

  // Shared validation for the cab form, matching what the security rules accept.
  // Vehicle fields only — the driver's name and phone come from their account.
  function cabDetailsProblem({ cabNumber, capacity }) {
    if (!(cabNumber || '').trim()) return 'Enter the cab number.';
    if ((cabNumber || '').trim().length > 32) return 'That cab number is too long.';
    // The last 4 digits of the number are half of the driver's login code, so a
    // number with fewer than 4 digits leaves whoever drives it unable to sign in.
    if (!cabCodePart(cabNumber)) {
      return 'A cab number needs at least 4 digits — the last 4 are half of the driver’s login code.';
    }
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

  // --- Cab service requests ------------------------------------------------

  // Employee asks to be set up for cab service. This is the only route into the
  // app for someone the directory let in but HR never entered: they have no
  // address and no pickup route, so nothing can be sent for them until the desk
  // fills those in. Returns { ok, message }.
  async function requestCabService({ name, empId, phone, address, landmark, note }) {
    if (!currentUser) return { ok: false, message: 'Not signed in.' };
    const cleanName = (name || '').trim();
    const cleanAddress = (address || '').trim();
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    if (!cleanName) return { ok: false, message: 'Please enter your name.' };
    if (!(empId || '').trim()) return { ok: false, message: 'Please enter your employee ID.' };
    if (!cleanAddress) {
      return { ok: false, message: 'Please enter your home address — the cab has nowhere to go without it.' };
    }
    if (cleanPhone && cleanPhone.length !== 10) {
      return { ok: false, message: 'Phone must be a 10-digit number.' };
    }
    if (pendingRequest(myCabServiceRequests)) {
      return { ok: false, message: 'Your request is already with the transport desk.' };
    }
    try {
      await createCabServiceRequest({
        employeeId: currentUser.uid,
        email: currentUser.email,
        name: cleanName,
        empId: (empId || '').trim(),
        phone: cleanPhone,
        address: cleanAddress,
        landmark: (landmark || '').trim(),
        note: (note || '').trim(),
      });
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not submit your request.');
    }
  }

  // Coordinator names the pickup route for a request's address — the one field
  // they may write here, so the admin approves with it already filled in.
  // The desk TYPES this route now rather than picking it off a list, so it goes
  // through the same snapping every other hand-entered route does — otherwise
  // "jntu cab" becomes a second pickup area alongside the "JNTU Cab" everyone
  // else is already on. The stored spelling is returned so the field can show
  // what actually landed.
  async function proposeCabRequestRoute(requestId, route) {
    const snapped = snapRoute(route);
    try {
      await proposeCabRequestRouteSvc(requestId, snapped);
      return { ok: true, route: snapped || '' };
    } catch (e) {
      return failure(e, 'Could not save the route.');
    }
  }

  // Admin approves: the details land on the employee's profile, with a route, and
  // they become a fully routed rider. Returns { ok, message }.
  async function approveCabService(request, edits) {
    try {
      // Snapped for the same reason as above. The `|| ''` matters: snapRoute
      // gives null for a blank box, and null would fall through to the
      // request's proposedRoute inside the service — so clearing the field
      // would approve the old route instead of asking for one.
      const route = snapRoute(edits?.route) || '';
      const res = await approveCabServiceRequest(request, currentUser?.name, {
        ...edits,
        route,
      });
      return { ok: true, ...res };
    } catch (e) {
      return failure(e, 'Could not approve the request.');
    }
  }

  async function rejectCabService(request, reason) {
    try {
      await rejectCabServiceRequest(request, currentUser?.name, reason);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not reject the request.');
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
        // Snapped, because this is now a free-text field: someone typing
        // "jntu cab" must land on the "JNTU Cab" their neighbours are grouped
        // under, not create a second one-person carpool.
        await updateEmployeeRoute(uid, snapRoute(route));
      }
      if (typeof fields.address === 'string') {
        await syncEmployeeAddress(uid, fields.address);
      }
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not save the profile.');
    }
  }

  // Admin provisions a brand-new person, without losing their own session.
  // Returns { ok, message }.
  //
  // TWO MECHANISMS, BY ROLE — see the invite section of services/profile.js:
  //   • Employees and coordinators are in the company Microsoft directory, so
  //     they get an INVITE and no password at all. They sign in with Microsoft
  //     and their profile is created under their own uid on the spot. Nobody
  //     invents, transmits or confirms a password.
  //   • Drivers are not in the directory — there is no Microsoft account for
  //     them to use — so they get a phone-derived account and sign in with the
  //     numeric code the cab link issues. No email and no password either way:
  //     this is the same thing the Drivers tab does, reachable from here too.
  async function adminCreateEmployee(form) {
    const email = (form.email || '').trim();
    const role = form.role || 'employee';
    // A driver has no email to be required — their phone is their identity.
    if (role === 'driver') {
      return addDriverAccount({ name: form.name, phone: form.phone });
    }
    if (!email) return { ok: false, message: 'Email is required.' };
    if (role === 'employee' && !(form.empId || '').trim()) {
      return { ok: false, message: 'Employee ID is required.' };
    }
    const profile = {
      empId: (form.empId || '').trim(),
      name: (form.name || '').trim() || email,
      phone: (form.phone || '').trim(),
      department: (form.department || '').trim(),
      address: (form.address || '').trim(),
      // Route them at creation. Skipping it here is how people ended up
      // unrouted in the first place: the only place to set a route was a
      // separate screen nobody went back to, so every new hire arrived on the
      // coordinator's board under "No route set".
      ...(snapRoute(form.route) ? { roster: { route: snapRoute(form.route) } } : {}),
    };
    // AN INVITE FOR SOMEBODY WHO ALREADY HAS AN ACCOUNT IS UNCLAIMABLE.
    // getOrCreateProfile returns on the existing employees/<uid> before it ever
    // looks for an invite, so this would write a document that sits in the queue
    // for ever, showing them as "yet to do their first login" when they have
    // already signed in. The roster import refuses the same thing; this is the
    // other door into adminCreateInvite.
    // directoryEmail() on both sides: a guest's profile stores the mangled
    // #EXT# sign-in name, so comparing raw strings would miss them and file the
    // unclaimable invite this check exists to prevent.
    const already = (employees || []).find(
      (e) => directoryEmail(e.email) === directoryEmail(email)
    );
    if (already) {
      return {
        ok: false,
        message:
          `${already.name || email} already has an account. Open their card in ` +
          'Employees to change their details instead of inviting them again.',
      };
    }

    try {
      await adminCreateInvite({
        email,
        role,
        // adminCreateInvite takes `route` flat; the nested roster map above is
        // the shape a real profile stores.
        profile: { ...profile, route: snapRoute(form.route) || '' },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: friendlyAuthError(e) };
    }
  }

  // AN INVITE FOR SOMEBODY WHO HAS ALREADY SIGNED IN — the repair, not the guard.
  //
  // adminCreateEmployee (above) and importRoster both refuse to file one. But an
  // invite can go STALE after it was filed, and nothing ever cleared it:
  // getOrCreateProfile returns on the existing employees/<uid> before it ever
  // looks for an invite, so the claim that would have deleted it never runs. It
  // happens whenever the profile came first — someone who self-provisioned off
  // the directory before HR uploaded the sheet, or whose Microsoft address
  // differs from the one the invite was keyed on.
  //
  // The cost is not a stale row on a list. The invite is holding their empId,
  // phone, ADDRESS and ROUTE, and needsCabServiceSetup() keys on exactly those
  // last two — so the person is held at the cab-service form being asked to type
  // in details the desk already has, and lands under "No route set" on the
  // coordinator's board every day until somebody notices. This is what moves
  // them across.
  //
  // FILL-ONLY, NEVER OVERWRITE. A blank field on the profile takes the invite's
  // value; a field that already has one keeps it. Whenever HR has edited the
  // card since, the profile is the newer of the two, and an invite is not
  // evidence about anything that was filled in after it was written.
  async function adminApplyInvite(invite) {
    const key = String(invite?.email || '').trim().toLowerCase();
    if (!key) return { ok: false, message: 'Missing invite.' };

    // directoryEmail() on BOTH sides, because a guest signs in under a mangled
    // address and their profile stores that — so a straight comparison against
    // the invite's real address is exactly the miss that stranded them in the
    // first place. See utils/directoryEmail.js.
    const matches = (employees || []).filter((e) => directoryEmail(e.email) === key);
    // Two profiles on one address is the duplicate-account bug itself. Picking
    // one of them at random is how a month of rides ends up on the account
    // nobody actually signs in to — so refuse, and say which problem to fix.
    if (matches.length > 1) {
      return {
        ok: false,
        message:
          `${key} has two employee profiles. Keep the one they sign in with, ` +
          'delete the other, then apply this.',
      };
    }
    const emp = matches[0];
    if (!emp) {
      return {
        ok: false,
        message: 'Nobody with that address has signed in yet — this invite is still waiting.',
      };
    }

    const blank = (v) => !String(v || '').trim();
    const fields = {};
    if (blank(emp.empId) && !blank(invite.empId)) fields.empId = invite.empId.trim();
    if (blank(emp.phone) && !blank(invite.phone)) fields.phone = invite.phone.trim();
    if (blank(emp.address) && !blank(invite.address)) fields.address = invite.address.trim();
    // adminSaveEmployee takes `route` flat and snaps it onto the configured list
    // on the way in — so a sheet's "jntu cab" lands on the same "JNTU Cab" their
    // neighbours are grouped under rather than creating a one-person carpool.
    if (blank(emp.roster?.route) && !blank(invite.roster?.route)) {
      fields.route = invite.roster.route.trim();
    }
    // A self-provisioned profile falls back to the email address as a name when
    // Microsoft asserted no display name, which is not a name. HR's spelling
    // beats that — and nothing else.
    const name = String(emp.name || '').trim();
    if ((!name || name.toLowerCase() === key) && !blank(invite.name)) {
      fields.name = invite.name.trim();
    }
    // A GUEST'S STORED ADDRESS IS WORTH CORRECTING, AND THIS IS THE ONLY MOMENT
    // WE MAY. The profile was born carrying the mangled #EXT# sign-in name
    // because the rules pin a self-provisioned document's email to the token —
    // but an admin update has no such pin, and the invite is HR's own record of
    // what the real address is. Writing it costs one field and fixes three
    // things at once: importRoster matches the sheet directly instead of
    // falling back to employee id, the cab-assigned email goes somewhere that
    // accepts mail (nothing delivers to an #EXT# address), and the desk stops
    // reading a 60-character sign-in name where a colleague's address belongs.
    //
    // Only ever mangled → real. An address that is already a real one is left
    // exactly as it is; the token stays the security boundary either way, since
    // firestore.rules reads myEmail() off the token and never off this field.
    if (isGuestDirectoryEmail(emp.email) && directoryEmail(emp.email) === key) {
      fields.email = key;
    }

    try {
      if (Object.keys(fields).length) {
        const res = await adminSaveEmployee(emp.uid, {
          ...fields,
          // They arrived off the directory unvetted; an invite HR filed for this
          // exact address IS the desk's record of having checked them — the same
          // thing approving a cab-service request clears.
          selfProvisioned: false,
        });
        if (!res?.ok) return res;
      }
      // Consumed either way. An invite with nothing left to give is still an
      // invite showing somebody who signed in weeks ago as "yet to arrive".
      await adminRevokeInvite(key);
      return { ok: true, name: emp.name || key, filled: Object.keys(fields) };
    } catch (e) {
      return failure(e, 'Could not apply those details.');
    }
  }

  // HR clears an invite by hand: the wrong address, someone who never joined, or
  // a stale one whose details are already on the profile. Deleting it is enough —
  // there is no account behind an unclaimed invite to disable.
  async function adminDismissInvite(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return { ok: false, message: 'Missing invite.' };
    try {
      await adminRevokeInvite(key);
      return { ok: true };
    } catch (e) {
      return failure(e, 'Could not remove that invite.');
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

  // Put a rider on ONE day's board — the coordinator's answer to "this person
  // needs a cab tonight and isn't on the roster". Writes that single day's shift
  // code, which is what the rides for the day are derived from, so they appear in
  // their route group immediately and can be assigned like anyone else.
  //
  // This is one day only, on purpose. Rostering someone for a stretch is HR's
  // job (Roster Upload → "Add a single employee"), and the rules enforce the same
  // split rather than trusting this screen.
  // Returns { ok, message?, created } — `created` is true when this was their
  // first roster row for the month.
  async function addRiderToDay(employeeId, dateKey, code) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can add a rider.' };
    }
    const emp = employees.find((e) => e.uid === employeeId);
    if (!emp) return { ok: false, message: 'That employee no longer exists.' };
    if (!code) return { ok: false, message: 'Pick a shift.' };
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!match) return { ok: false, message: 'Pick a valid date.' };
    const [, year, month, day] = match;
    try {
      const res = await addRiderForDay(
        { month: `${year}-${month}`, employee: emp, day, code },
        { addedBy: currentUser.uid, addedByName: currentUser.name || '' }
      );
      return { ok: true, created: res?.created };
    } catch (e) {
      return failure(e, 'Could not add that rider to the day.');
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

  // THE ROUTE LIST IS DERIVED FROM WHAT IS IN USE, not maintained by hand.
  //
  // There was a Routes & Timings screen for this once. It is gone: the monthly
  // sheet carries a Route column, so a new pickup area arrives with the roster
  // and having to add it in a second place first was a step that only ever got
  // skipped — leaving the rider unrouted and the coordinator grouping them by
  // hand every day of the month.
  //
  // So the vocabulary is: the built-in starter list, plus any list an older
  // install saved to config/timings.routes, plus every route currently on an
  // employee profile. Deduped by routeKey so a spelling variant already in the
  // data can't add a second entry, and the first spelling seen wins — which is
  // why the built-in names are added first.
  //
  // This list is not a whitelist any more. canonicalRoute() snaps onto it and
  // ACCEPTS what it doesn't recognise (see services/roster.js); this exists so
  // that snapping has something to snap to, and so the pickers can suggest.
  const routeOptions = useMemo(() => {
    const seen = new Map(); // routeKey → the spelling to show
    const add = (value) => {
      const text = String(value ?? '').trim();
      if (!text) return;
      const key = routeKey(text);
      if (!seen.has(key)) seen.set(key, text);
    };
    (timings.routes?.length ? timings.routes : CAB_ROUTES).forEach(add);
    (employees || []).forEach((e) => add(e.roster?.route));
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [timings.routes, employees]);

  // One spelling, whoever typed it. A route saved by hand goes through the same
  // snapping the roster import uses, so "jntu cab" typed on a profile becomes
  // the "JNTU Cab" everyone else is already on rather than a second group.
  function snapRoute(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    return canonicalRoute(text, routeOptions) || text;
  }

  async function setEmployeeRoute(uid, route) {
    if (!isDeskRole(currentUser?.role)) {
      return { ok: false, message: 'Only the transport desk can set a route.' };
    }
    try {
      await updateEmployeeRoute(uid, snapRoute(route));
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

    // ROUTE AND HOME ADDRESS COME FROM THE PROFILE, NOT THE ROSTER SNAPSHOT.
    //
    // importRoster() copies each employee's route and address into their roster
    // document so the coordinator and driver don't have to read profiles. That
    // copy is right on the day of the import and wrong after it: routing someone
    // (or moving them to another route) left every already-imported day of that
    // month grouped under "No route set", and there was nothing HR could do about
    // it short of re-uploading the whole sheet.
    //
    // THE ADDRESS HAD THE SAME BUG, one step further along and worse, because a
    // ride's address doesn't just get displayed — it is copied onto the booking
    // when a cab is assigned (see assignCabToRides → bookingFromRide), and the
    // driver navigates by it. Two ways the snapshot went stale:
    //
    //   • An admin edit or an approved address request. syncEmployeeAddress()
    //     rewrites the copy on bookings that ALREADY EXIST, but a rostered day
    //     with no booking yet still carried the old value — so assigning a cab
    //     minted a fresh booking pointing at the old house.
    //   • The import itself. The roster document's address is written from the
    //     PRE-import profile while the profile is overwritten from the sheet in
    //     the same batch, so a sheet that introduces addresses leaves the
    //     snapshot one upload behind (roster.js, `address:` in validateRoster).
    //
    // The profile is the source of truth for both, so the live value wins here
    // and the snapshot is only a fallback — which still covers a rostered person
    // whose profile hasn't loaded yet. homeAddressOf() is reused so a saved map
    // pin reads the same way it does everywhere else.
    if (!employees.length) return rides;
    const profileOf = new Map(employees.map((e) => [e.uid, e]));
    return rides.map((r) => {
      const emp = profileOf.get(r.employeeId);
      if (!emp) return r;
      return {
        ...r,
        route: emp.roster?.route || r.route || null,
        employeeAddress: homeAddressOf(emp) || r.employeeAddress || '',
      };
    });
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

      // And email them. `created` holds the new booking ids in the same order as
      // `fresh`, so every ride on this cab — pre-existing booking or one just
      // materialised — gets exactly one job. Best-effort, same as above.
      queueCabAssignedEmails([
        ...existing.map((r) => ({ bookingId: r.bookingId, employeeId: r.employeeId })),
        ...fresh.map((r, i) => ({ bookingId: created[i], employeeId: r.employeeId })),
      ]);

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

  // The open queue, shared by BOTH desk roles.
  //
  // It used to be pendingFor(changeRequests, currentUser.role) — an exact match
  // on routedTo, which is 'coordinator' on every request there is. Correct while
  // the coordinator was the only one looking; it returned an empty list the
  // moment HR was given the screen. See pendingForDesk().
  function myQueue() {
    if (!isDeskRole(currentUser?.role)) return [];
    return pendingForDesk(changeRequests);
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
        Requests: pendingForDesk(changeRequests).length,
        // Somebody is signed in and cannot be sent a cab until this is dealt
        // with, so it badges for both desk roles.
        CabRequests: cabServiceRequests.filter(
          (r) => r.status === CAB_REQUEST_STATUS.PENDING
        ).length,
        // HOW THE DESK IS TOLD ABOUT A NO-SHOW. A driver marking someone absent
        // used to be silent to everyone; this is the desk's half of fixing that
        // (the rider's half is a notification — see markNoShow).
        //
        // A BADGE RATHER THAN A NOTIFICATION, for a reason that is not laziness:
        // neither desk role has a notification inbox, and the driver's app could
        // not address one to them if they did — the rules deliberately stop a
        // driver reading employee profiles, so it cannot find out who the admins
        // are. The desk already reads every booking, so the count is derivable
        // on their own device with no write and no rules change at all.
        //
        // TODAY ONLY, and that is what makes it usable. The other counts here
        // clear when the item is actioned; a no-show is never "actioned", so an
        // all-time count would be a number that only ever grows and stops being
        // read. Scoped to today it means "tonight's runs have lost this many
        // people", and it empties itself at midnight.
        NoShows: bookings.filter(
          (b) => b.status === STATUS.NO_SHOW && String(b.date || '') === todayKey()
        ).length,
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
    microsoftConfirm,
    confirmMicrosoftLink,
    cancelMicrosoftConfirm,
    // Drivers sign in with a code instead of email/password, and cannot create
    // their own account at all — there is deliberately no `signup` any more.
    loginDriver,
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
    addRiderToDay,
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
    // Employee-driven cancellation of a ride they no longer need (with reason).
    rideCancelState,
    cancelAssignedRide,
    deskCancelRide,
    employeeCancellationsOn,
    deskCancellationsOn,
    restoreDeskCancelledRide,
    deskCancelState,
    approveCancel,
    rejectCancel,
    pendingCancelRequests,
    updateBookingStatus,
    updateBookingStatuses,
    startRideWithOtp,
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
    regenerateDriverCode,
    // Coordinators — phone + a 4-digit passcode, no email, no invite.
    loginCoordinator,
    addCoordinatorAccount,
    regenerateCoordinatorPasscode,
    homeAddressOf,
    myAddressRequests,
    addressRequests,
    // Cab service requests (the "I'm not on the roster, please set me up" flow).
    myCabServiceRequests,
    cabServiceRequests,
    requestCabService,
    proposeCabRequestRoute,
    approveCabService,
    rejectCabService,
    // Whether the SIGNED-IN employee still has no address or route, so the app
    // can hold them at the setup form instead of a dashboard that shows nothing.
    needsCabSetup: needsCabServiceSetup(currentUser),
    myPendingCabRequest: pendingRequest(myCabServiceRequests),
    menuCounts,
    requestAddressChange,
    sendMessage,
    adminSaveEmployee,
    adminCreateEmployee,
    adminApplyInvite,
    adminDismissInvite,
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
    sharingBackground,
    sharingSince,
    lastFixAt,
    // IS GPS ACTUALLY REACHING THE DATABASE? `sharingLocation` only says the switch
    // is on and a watcher was created; this says a fix was published inside the
    // same freshness window employees judge the cab by, so the driver's screen and
    // the rider's screen can never disagree about whether the cab is live.
    //
    // Null until the first fix — deliberately three states, not two: "on but no fix
    // yet" is normal for the first few seconds and must not read as a failure.
    trackingFresh:
      sharingLocation && lastFixAt ? Date.now() - lastFixAt < LIVE_WINDOW_MS : null,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// Small hook so screens can do:  const { login } = useApp();
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
