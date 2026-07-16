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

export async function assignCabToBooking(bookingId, cabId) {
  return updateDoc(doc(firestore, COL, bookingId), {
    assignedCabId: cabId,
    status: 'Cab assigned',
  });
}

export async function setBookingStatus(bookingId, status) {
  return updateDoc(doc(firestore, COL, bookingId), { status });
}
