// ---------------------------------------------------------------------------
// BOOKINGS SERVICE
// All reads/writes for the Firestore "bookings" collection.
//   • createBooking / createBookings — add new bookings
//   • subscribeMyBookings           — live list for one employee
//   • subscribeAllBookings          — live list for the admin
//   • assignCabToBooking            — admin assigns a cab
//   • setBookingStatus              — e.g. cancel a trip
// "Live" means the screen updates automatically when the data changes,
// even from another device.
// ---------------------------------------------------------------------------

import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from './firebase';

const COL = 'bookings';

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

export async function createBookings(list) {
  return Promise.all(list.map((d) => createBooking(d)));
}

// Live list of one employee's bookings. Returns an unsubscribe function.
export function subscribeMyBookings(uid, cb, onError) {
  const q = query(collection(firestore, COL), where('employeeId', '==', uid));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

// Live list of ALL bookings (admin). Returns an unsubscribe function.
export function subscribeAllBookings(cb, onError) {
  return onSnapshot(collection(firestore, COL), (snap) => cb(toList(snap)), onError);
}

// Live list of bookings assigned to one cab (driver). Returns an unsubscribe fn.
export function subscribeCabBookings(cabId, cb, onError) {
  const q = query(collection(firestore, COL), where('assignedCabId', '==', cabId));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

export async function assignCabToBooking(bookingId, cabId) {
  return updateDoc(doc(firestore, COL, bookingId), {
    assignedCabId: cabId,
    status: 'Cab assigned',
  });
}

// Assign ONE cab to MANY bookings at once (carpool grouping). All the selected
// employees then share that cab. Done as a single atomic batch.
export async function assignCabToBookings(bookingIds, cabId) {
  const batch = writeBatch(firestore);
  bookingIds.forEach((id) =>
    batch.update(doc(firestore, COL, id), { assignedCabId: cabId, status: 'Cab assigned' })
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
    status: 'No show',
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
    ? { status: 'Cancelled', cancelStatus: 'Approved', cancelResolvedAt: serverTimestamp() }
    : { cancelStatus: 'Rejected', cancelResolvedAt: serverTimestamp() };
  return updateDoc(doc(firestore, COL, bookingId), fields);
}
