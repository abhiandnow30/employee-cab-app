// ---------------------------------------------------------------------------
// BOOKINGS SERVICE
// All reads/writes for the Firestore "bookings" collection.
//   • createBooking                 — add one new booking
//   • applyRosterChanges            — cancel + create in ONE atomic batch
//   • subscribeMyBookings           — live list for one employee
//   • subscribeAllBookings          — live list for the admin (bounded window)
//   • assignCabToBooking(s)         — admin assigns a cab
//   • setBookingStatus              — e.g. cancel a trip
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
} from 'firebase/firestore';
import { firestore } from './firebase';
import { STATUS } from '../data/mockData';
import { todayKey, shiftDateKey } from '../utils/datetime';

const COL = 'bookings';

// How far back the admin's live list reaches. Without a bound this subscription
// streams (and re-streams) every booking the company has ever made, which grows
// without limit; the desk only ever works with recent + upcoming rides.
export const ADMIN_HISTORY_DAYS = 180;
// Hard ceiling on the admin list, so one very busy period can't blow up memory.
export const ADMIN_MAX_BOOKINGS = 2000;

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
// Returns the ids of the newly created bookings, in the order given, so the caller
// can link each one back to whatever it fulfilled.
export async function createAssignedBookings(newBookings, existingIds, cabId) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  const ids = [];
  (newBookings || []).forEach((b) => {
    const ref = doc(collection(firestore, COL));
    ids.push(ref.id);
    batch.set(ref, { ...b, createdAt: serverTimestamp() });
  });
  (existingIds || []).forEach((id) => {
    batch.update(doc(firestore, COL, id), {
      assignedCabId: cabId,
      status: STATUS.ASSIGNED,
    });
  });
  await batch.commit();
  return ids;
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

// Live list of bookings assigned to one cab (driver). Returns an unsubscribe fn.
export function subscribeCabBookings(cabId, cb, onError) {
  const q = query(collection(firestore, COL), where('assignedCabId', '==', cabId));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

export async function assignCabToBooking(bookingId, cabId) {
  return updateDoc(doc(firestore, COL, bookingId), {
    assignedCabId: cabId,
    status: STATUS.ASSIGNED,
  });
}

// Assign ONE cab to MANY bookings at once (carpool grouping). All the selected
// employees then share that cab. Done as a single atomic batch.
export async function assignCabToBookings(bookingIds, cabId) {
  const batch = writeBatch(firestore);
  bookingIds.forEach((id) =>
    batch.update(doc(firestore, COL, id), { assignedCabId: cabId, status: STATUS.ASSIGNED })
  );
  return batch.commit();
}

export async function setBookingStatus(bookingId, status) {
  return updateDoc(doc(firestore, COL, bookingId), { status });
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
