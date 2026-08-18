// ---------------------------------------------------------------------------
// BOOKINGS SERVICE
// All reads/writes for the Firestore "bookings" collection.
//   • createBooking                 — add one new booking
//   • applyRosterChanges            — cancel + create in ONE atomic batch
//   • subscribeMyBookings           — live list for one employee
//   • subscribeAllBookings          — live list for the admin (bounded window)
//   • assignCabToBooking(s)         — admin assigns a cab (and issues its OTP)
//   • setBookingStatus              — e.g. cancel a trip
//   • startRideWithOtp              — driver types in the rider's code
//   • syncEmployeeAddress           — push an approved address change onto the
//                                     employee's future rides
// "Live" means the screen updates automatically when the data changes,
// even from another device.
// ---------------------------------------------------------------------------

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { STATUS } from '../data/mockData';
import { issueRideOtp } from './rideOtp';
import { todayKey, shiftDateKey } from '../utils/datetime';

const COL = 'bookings';

// How far back the admin's live list reaches. Without a bound this subscription
// streams (and re-streams) every booking the company has ever made, which grows
// without limit; the desk only ever works with recent + upcoming rides.
export const ADMIN_HISTORY_DAYS = 180;
// Hard ceiling on the admin list, so one very busy period can't blow up memory.
export const ADMIN_MAX_BOOKINGS = 2000;

// How far back a DRIVER's trip list reaches. One day, not zero: the night run is a
// 10 PM drop, so a driver still finishing it at 00:10 would otherwise watch their
// in-progress trips vanish at midnight. The screen narrows this further — see
// DriverHomeScreen — but the subscription has to fetch yesterday for it to be able
// to.
export const DRIVER_WINDOW_DAYS = 1;
// Backstop only. Two days of one cab is a couple of dozen trips at most; this is
// here so a data problem can't stream thousands of documents onto a phone.
export const DRIVER_MAX_TRIPS = 200;

// Newest first. Pending local writes have no server timestamp yet, so treat
// those as newest so a just-created booking jumps to the top immediately.
function byNewest(a, b) {
  const ta = a.createdAt?.seconds ?? Infinity;
  const tb = b.createdAt?.seconds ?? Infinity;
  return tb - ta;
}

function toList(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest);
}

export async function createBooking(data) {
  return addDoc(collection(firestore, COL), { ...data, createdAt: serverTimestamp() });
}

// Create several already-assigned bookings AND re-assign existing ones, as one
// atomic commit — the desk putting a whole carpool into one cab. Doing these as
// separate writes meant a failure halfway through left some riders assigned and
// the rest not, with the cab's seats already counted against the ones that landed.
//
// A NEW booking is keyed by its `rideKey` (deterministic, one per employee +
// shift-day + leg) rather than a random id, and the whole thing runs as a
// TRANSACTION that checks each ride is still unbooked before creating it. Two
// coordinators racing to assign the same still-unassigned ride would otherwise
// both succeed — one random-id doc each — leaving the same employee double-booked
// into two different cabs with neither coordinator any the wiser. Keying on
// `rideKey` plus this existence check means the second commit fails loudly
// ("already assigned by someone else") instead of silently duplicating the ride.
//
// Returns the ids of the newly created bookings, in the order given, so the caller
// can link each one back to whatever it fulfilled.
export async function createAssignedBookings(newBookings, existingIds, cabId) {
  if (!firestore) throw new Error('Backend not configured.');
  const fresh = (newBookings || []).map((b) => ({
    ref: doc(firestore, COL, b.rideKey),
    data: b,
  }));

  await runTransaction(firestore, async (tx) => {
    // All reads before any writes — Firestore transactions require that order.
    const snaps = await Promise.all(fresh.map(({ ref }) => tx.get(ref)));
    const taken = fresh.filter((_, i) => snaps[i].exists());
    if (taken.length) {
      const names = taken.map((t) => t.data.employeeName || t.data.employeeId).join(', ');
      throw new Error(
        `Already assigned by someone else: ${names}. Refresh and try again.`
      );
    }
    fresh.forEach(({ ref, data }) => {
      tx.set(ref, { ...data, createdAt: serverTimestamp() });
      // Same commit as the assignment, so a ride never carries a cab without the
      // code its rider will be asked for. See services/rideOtp.js.
      issueRideOtp(tx, ref.id);
    });
    (existingIds || []).forEach((id) => {
      tx.update(doc(firestore, COL, id), {
        assignedCabId: cabId,
        status: STATUS.ASSIGNED,
      });
      // Re-assigning to another cab re-issues the code, killing off whatever the
      // previous driver may have overheard.
      issueRideOtp(tx, id);
    });
  });

  return fresh.map(({ ref }) => ref.id);
}

// Fresh, uncached read of one employee's live (not cancelled/completed) bookings
// on a given date — used when resolving a change request, so the desk always acts
// on what's actually in Firestore right now rather than a coordinator's possibly
// stale local snapshot (which might be missing a booking another coordinator just
// created a moment ago).
export async function getLiveBookingsForDate(employeeId, date) {
  if (!firestore || !employeeId) return [];
  // Equality-only query (no composite index needed); date/status narrowing
  // happens here, same pattern as syncEmployeeAddress below.
  const q = query(collection(firestore, COL), where('employeeId', '==', employeeId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter(
      (b) => b.date === date && b.status !== STATUS.CANCELLED && b.status !== STATUS.COMPLETED
    );
}

// The Weekly Schedule can, in one save, drop some rides and create others (a
// changed pickup time is a cancel + a create). Doing that as ONE batch means the
// employee can never end up with the old ride cancelled and the new one missing.
export async function applyRosterChanges({ cancelIds = [], create = [] }) {
  if (!cancelIds.length && !create.length) return;
  const batch = writeBatch(firestore);
  cancelIds.forEach((id) => {
    batch.update(doc(firestore, COL, id), { status: STATUS.CANCELLED });
  });
  create.forEach((d) => {
    batch.set(doc(collection(firestore, COL)), { ...d, createdAt: serverTimestamp() });
  });
  return batch.commit();
}

// Live list of one employee's bookings. Returns an unsubscribe function.
export function subscribeMyBookings(uid, cb, onError) {
  const q = query(collection(firestore, COL), where('employeeId', '==', uid));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

// Live list of bookings for the admin, bounded to a recent window (see
// ADMIN_HISTORY_DAYS) plus everything in the future. `date` is an ISO
// "YYYY-MM-DD" string, so a string range query orders correctly and needs only
// the automatic single-field index. Returns an unsubscribe function.
export function subscribeAllBookings(cb, onError, { sinceDays = ADMIN_HISTORY_DAYS } = {}) {
  const since = shiftDateKey(todayKey(), -sinceDays);
  const q = query(
    collection(firestore, COL),
    where('date', '>=', since),
    orderBy('date', 'desc'),
    limit(ADMIN_MAX_BOOKINGS)
  );
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

// Live list of bookings assigned to one cab (driver), bounded to the current run's
// window. Returns an unsubscribe fn.
//
// THIS USED TO BE UNBOUNDED — `where('assignedCabId', '==', cabId)` and nothing
// else — so it streamed every trip the cab had ever been given. Two problems, one
// visible and one not: the driver's screen showed last week's finished trips next
// to tonight's, and the payload grew forever (~700 documents after a year of two
// trips a day, re-fetched on every load, to render tonight's two).
//
// `date` is an ISO "YYYY-MM-DD" string, so a string range orders correctly. But an
// equality on one field plus a range on another needs a COMPOSITE INDEX
// (assignedCabId ASC, date ASC) — it is in firestore.indexes.json and must be
// deployed:  firebase deploy --only firestore:indexes
//
// Until that index exists Firestore rejects the query with `failed-precondition`,
// which would leave every driver looking at an empty list. So that one error falls
// back to the old unbounded query with the same filter applied client-side: the
// driver sees the correct trips either way, and the console says which path ran.
// Remove the fallback once the index is deployed everywhere, if you'd rather the
// misconfiguration be loud.
export function subscribeCabBookings(cabId, cb, onError, { sinceDays = DRIVER_WINDOW_DAYS } = {}) {
  const from = shiftDateKey(todayKey(), -sinceDays);
  const inWindow = (list) => list.filter((b) => String(b.date || '') >= from);
  let active = null;
  let stopped = false;

  function openUnbounded(reason) {
    console.warn(
      '[bookings] cab trip query needs a composite index (assignedCabId, date) — ' +
        'falling back to an unbounded read. Deploy firestore.indexes.json. ' +
        reason
    );
    if (stopped) return;
    const q = query(collection(firestore, COL), where('assignedCabId', '==', cabId));
    active = onSnapshot(q, (snap) => cb(inWindow(toList(snap))), onError);
  }

  const q = query(
    collection(firestore, COL),
    where('assignedCabId', '==', cabId),
    where('date', '>=', from),
    limit(DRIVER_MAX_TRIPS)
  );
  active = onSnapshot(
    q,
    (snap) => cb(toList(snap)),
    (err) => {
      if (stopped) return;
      // A missing index is a deployment state, not a failure the driver can act
      // on. Anything else (permission denied, offline) is a real error and goes
      // to the caller as before.
      if (err?.code === 'failed-precondition') {
        openUnbounded(err?.message || '');
        return;
      }
      onError?.(err);
    }
  );
  // Reads `active` at call time, so it stops whichever listener is the live one.
  return () => {
    stopped = true;
    if (active) active();
  };
}

// A batch rather than a plain update: the cab and the rider's start OTP have to
// land together, or the ride arrives at the kerb with nothing for the driver to
// check against.
export async function assignCabToBooking(bookingId, cabId) {
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, COL, bookingId), {
    assignedCabId: cabId,
    status: STATUS.ASSIGNED,
  });
  issueRideOtp(batch, bookingId);
  return batch.commit();
}

// Assign ONE cab to MANY bookings at once (carpool grouping). All the selected
// employees then share that cab. Done as a single atomic batch.
export async function assignCabToBookings(bookingIds, cabId) {
  const batch = writeBatch(firestore);
  bookingIds.forEach((id) => {
    batch.update(doc(firestore, COL, id), { assignedCabId: cabId, status: STATUS.ASSIGNED });
    // One code per RIDER, not per cab — a carpool of four is four separate
    // boardings, each verified as that person gets in.
    issueRideOtp(batch, id);
  });
  return batch.commit();
}

export async function setBookingStatus(bookingId, status) {
  return updateDoc(doc(firestore, COL, bookingId), { status });
}

// The driver typed in the rider's code. The attempt is written onto the booking
// because firestore.rules can only inspect `request.resource.data` — it cannot
// see a value that isn't part of the write. If the code is wrong the whole update
// is rejected and nothing is stored, so a failed guess leaves no trace on the
// document; if it's right, what lands is a code that has just been spent.
//
// Deliberately NOT routed through setBookingStatus: reaching "On board" is the
// one transition the driver cannot make on their own, and giving it its own
// function keeps that visible at every call site.
export async function startRideWithOtp(bookingId, code) {
  return updateDoc(doc(firestore, COL, bookingId), {
    status: STATUS.ON_BOARD,
    startOtpAttempt: String(code || '').trim(),
    boardedAt: serverTimestamp(),
  });
}

// Driver flags that the employee wasn't at the pickup. Records the time so the
// admin can see when it happened.
export async function markBookingNoShow(bookingId) {
  return updateDoc(doc(firestore, COL, bookingId), {
    status: STATUS.NO_SHOW,
    noShowAt: serverTimestamp(),
  });
}

// Employee raises a cancellation request. The ride stays active (status
// unchanged) until the admin approves — we only mark the request.
export async function requestCancelBooking(bookingId, reason = '') {
  return updateDoc(doc(firestore, COL, bookingId), {
    cancelStatus: 'Requested',
    cancelReason: reason,
    cancelRequestedAt: serverTimestamp(),
    cancelResolvedAt: null,
  });
}

// The employee cancels a ride outright — the "I'm on leave, I don't need the
// cab" case — rather than asking the desk to. Allowed up to the same 4-hour
// cutoff every other cancellation path uses; the caller checks it before getting
// here and `firestore.rules` checks it again against the server clock, because a
// disabled button is not a permission.
//
// The ride's cab is deliberately LEFT on the document. The seat frees itself the
// moment the status is Cancelled — every consumer that counts a cab's load
// already skips cancelled rides (ridesSharingCab here, the driver's trip list,
// ridesOn for the coordinator's board) — while keeping `assignedCabId` is what
// lets the desk still see WHICH cab was freed and by whom. Nulling it would free
// the same seat and lose that.
//
// Two sets of fields are written for one event, on purpose:
//   • cancelledAt / cancelledBy / cancellationReason — this feature's record of
//     who cancelled and why.
//   • cancelStatus / cancelReason / cancelResolvedAt — what the desk's existing
//     screens (Cancelled Rides, All Bookings) already read. Writing them means
//     an employee cancellation shows up there with its reason without those
//     screens having to learn a second field name. 'Approved' is the same value
//     changeRequests.js stamps for a cancellation that has actually happened.
export async function cancelAssignedBooking(bookingId, { reason, uid }) {
  const text = String(reason || '').trim();
  return updateDoc(doc(firestore, COL, bookingId), {
    status: STATUS.CANCELLED,
    cancelledAt: serverTimestamp(),
    cancelledBy: uid || null,
    cancellationReason: text,
    cancelStatus: 'Approved',
    cancelReason: text,
    cancelResolvedAt: serverTimestamp(),
  });
}

// Admin approves or rejects a pending cancellation request.
//   approve → the booking is Cancelled and the request marked Approved
//   reject  → the request is marked Rejected; the booking stays active
export async function resolveCancelRequest(bookingId, approve) {
  const fields = approve
    ? { status: STATUS.CANCELLED, cancelStatus: 'Approved', cancelResolvedAt: serverTimestamp() }
    : { cancelStatus: 'Rejected', cancelResolvedAt: serverTimestamp() };
  return updateDoc(doc(firestore, COL, bookingId), fields);
}

// --- Cab load (capacity + double-booking checks) ----------------------------

// The rides already riding in `cabId` on the same date + time as `booking`.
// Used to stop the desk overfilling a cab, or sending one cab in two directions
// at the same moment. `exclude` skips the bookings being assigned right now.
export function ridesSharingCab(bookings, cabId, date, shift, exclude = []) {
  return bookings.filter(
    (b) =>
      b.assignedCabId === cabId &&
      b.date === date &&
      b.shift === shift &&
      b.status !== STATUS.CANCELLED &&
      !exclude.includes(b.id)
  );
}

// A cab can't be in two places at once: an existing trip in the OPPOSITE
// direction at the same date+time is a conflict, not a carpool. Returns the
// clashing booking, or null.
export function conflictingRide(bookings, cabId, date, shift, direction, exclude = []) {
  return (
    ridesSharingCab(bookings, cabId, date, shift, exclude).find(
      (b) => b.direction && direction && b.direction !== direction
    ) || null
  );
}

// --- Keeping the rider's address on their future rides fresh ----------------

// Each booking carries a COPY of the employee's address (the driver is allowed
// to read the booking but not the employee's profile). When the address changes
// — an approved address request, or an admin edit — those copies go stale and
// the driver navigates to the old house. This rewrites the copy on every ride
// that hasn't happened yet.
//
// `batch` is optional: pass one to make the address change and this sync a
// single atomic commit. Returns the number of bookings updated.
export async function syncEmployeeAddress(employeeId, address, batch = null) {
  if (!firestore || !employeeId) return 0;
  // Equality-only query (no composite index needed); the date/status narrowing
  // happens here — one employee never has enough rides for that to matter.
  const q = query(collection(firestore, COL), where('employeeId', '==', employeeId));
  const snap = await getDocs(q);
  const today = todayKey();
  const stale = snap.docs.filter((d) => {
    const b = d.data();
    return (
      String(b.date || '') >= today &&
      b.status !== STATUS.CANCELLED &&
      b.status !== STATUS.COMPLETED
    );
  });
  if (!stale.length) return 0;

  const own = !batch;
  const b = batch || writeBatch(firestore);
  stale.forEach((d) => b.update(d.ref, { employeeAddress: address }));
  if (own) await b.commit();
  return stale.length;
}

// --- Repair: employee IDs on existing bookings -------------------------------
//
// The driver's trip list identifies riders by EMPLOYEE ID, and a driver may not
// read employee profiles (the rules see to that), so the id has to travel on the
// booking. Bookings written before `empId` was carried have none, and would read
// "Employee ID not on record" for ever.
//
// So the desk repairs them: it can read both the bookings and the employee
// directory, and it is allowed to update a booking. Only UPCOMING, still-live
// rides are touched — history is left exactly as it was recorded.
//
// `pairs` = [{ id, empId }]. Returns how many were stamped.
export async function stampBookingEmpIds(pairs) {
  if (!firestore || !pairs?.length) return 0;
  const CHUNK = 400; // under Firestore's 500-write batch limit
  let written = 0;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const batch = writeBatch(firestore);
    pairs.slice(i, i + CHUNK).forEach(({ id, empId }) => {
      batch.update(doc(firestore, COL, id), { empId });
    });
    await batch.commit();
    written += Math.min(CHUNK, pairs.length - i);
  }
  return written;
}
