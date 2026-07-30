// ---------------------------------------------------------------------------
// ADDRESS CHANGE REQUEST SERVICE
// Employees can't edit their own home address (the admin owns profile data).
// Instead they raise a request here; the admin approves or rejects it on the
// "Address Change Requests" screen. Requests live in Firestore at
// addressChangeRequests/<id>.
//
//   • Employee → createAddressChangeRequest() (status starts "Pending")
//   • Admin    → approveAddressRequest()  (writes the new address onto the
//                employee's profile AND marks the request "Approved", atomically)
//              → rejectAddressRequest()   (keeps the address, marks "Rejected"
//                with an optional reason)
// Firestore security rules enforce that an employee can only create/read their
// OWN requests, and only an admin can approve/reject.
// ---------------------------------------------------------------------------

import {
  collection, addDoc, doc, updateDoc, onSnapshot, query, where,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { syncEmployeeAddress } from './bookings';
import { notify, NOTIFY, addressDecisionMessage } from './notifications';

export const REQUEST_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// Employee raises a new address-change request. Always starts "Pending".
export async function createAddressChangeRequest(data) {
  if (!firestore) throw new Error('Backend not configured.');
  return addDoc(collection(firestore, 'addressChangeRequests'), {
    employeeId: data.employeeId,
    employeeName: data.employeeName || '',
    currentAddress: data.currentAddress || '',
    requestedAddress: data.requestedAddress,
    landmark: data.landmark || '',
    reason: data.reason || '',
    status: REQUEST_STATUS.PENDING,
    rejectionReason: '',
    reviewedBy: '',
    reviewedAt: null,
    requestedAt: serverTimestamp(),
  });
}

// Newest first. Pending local writes have no server timestamp yet, so treat
// those as newest (mirrors the feedback/bookings services).
function byNewest(a, b) {
  const ta = a.requestedAt?.seconds ?? Infinity;
  const tb = b.requestedAt?.seconds ?? Infinity;
  return tb - ta;
}

function toList(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest);
}

// Admin: live list of ALL requests (admin only — enforced by rules).
export function subscribeAllAddressRequests(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(collection(firestore, 'addressChangeRequests'), (snap) => cb(toList(snap)), onError);
}

// Employee: live list of only MY requests (so I can see their status).
export function subscribeMyAddressRequests(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(firestore, 'addressChangeRequests'),
    where('employeeId', '==', employeeId)
  );
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

// Admin approves. Four things move together, in ONE atomic batch:
//
//   1. the employee's profile address
//   2. their PICKUP ROUTE, when the admin changed it — a move is very often a
//      route change, and leaving it alone was a real hole: the driver navigated to
//      the new house while the rider stayed grouped with their old neighbours, so
//      a cab from the wrong side of the city collected them every day until
//      somebody noticed
//   3. the address COPY carried on their upcoming rides (a driver may read the
//      booking but not the profile, so without this the driver keeps going to the
//      old house for rides already in the system)
//   4. the request itself, marked Approved
//
// `edits.address` is what the admin actually approved — they may have tidied the
// wording — so it, not the raw request text, is what gets written everywhere.
//
// Returns { syncedRides, address, route }.
export async function approveAddressRequest(request, adminName, edits = {}) {
  if (!firestore) throw new Error('Backend not configured.');

  const address = (edits.address ?? request.requestedAddress ?? '').trim();
  if (!address) throw new Error('The approved address cannot be empty.');
  // undefined = "leave the route alone"; a string = set it.
  const route = typeof edits.route === 'string' ? edits.route.trim() : undefined;

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'employees', request.employeeId), {
    address,
    ...(route !== undefined ? { 'roster.route': route || null } : {}),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, 'addressChangeRequests', request.id), {
    status: REQUEST_STATUS.APPROVED,
    // What was approved, which can differ from what was asked for.
    approvedAddress: address,
    ...(route !== undefined ? { approvedRoute: route || null } : {}),
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
    rejectionReason: '',
  });
  const syncedRides = await syncEmployeeAddress(request.employeeId, address, batch);
  await batch.commit();

  // Tell them. Best-effort: the move is already saved, and a failed notification
  // must not read as a failed approval.
  const msg = addressDecisionMessage({ approved: true, address, route });
  notify({
    employeeId: request.employeeId,
    type: NOTIFY.ADDRESS_RESOLVED,
    title: msg.title,
    body: msg.body,
    payload: { requestId: request.id },
  }).catch((e) => console.warn('[notify] address approval notice failed:', e?.message));

  return { syncedRides, address, route };
}

// Admin rejects: the address stays unchanged; store an optional reason and tell
// the employee, so a rejection isn't something they discover by chance.
export async function rejectAddressRequest(request, adminName, rejectionReason) {
  if (!firestore) throw new Error('Backend not configured.');
  const reason = (rejectionReason || '').trim();
  await updateDoc(doc(firestore, 'addressChangeRequests', request.id), {
    status: REQUEST_STATUS.REJECTED,
    rejectionReason: reason,
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
  });

  const msg = addressDecisionMessage({ approved: false, reason });
  notify({
    employeeId: request.employeeId,
    type: NOTIFY.ADDRESS_RESOLVED,
    title: msg.title,
    body: msg.body,
    payload: { requestId: request.id },
  }).catch((e) => console.warn('[notify] address rejection notice failed:', e?.message));
}
