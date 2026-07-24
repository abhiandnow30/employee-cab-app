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

// Admin approves: write the new address onto the employee's profile AND mark the
// request approved — in a single atomic batch so the two never drift apart.
export async function approveAddressRequest(request, adminName) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'employees', request.employeeId), {
    address: request.requestedAddress,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, 'addressChangeRequests', request.id), {
    status: REQUEST_STATUS.APPROVED,
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
    rejectionReason: '',
  });
  return batch.commit();
}

// Admin rejects: the address stays unchanged; store an optional reason.
export async function rejectAddressRequest(request, adminName, rejectionReason) {
  if (!firestore) throw new Error('Backend not configured.');
  return updateDoc(doc(firestore, 'addressChangeRequests', request.id), {
    status: REQUEST_STATUS.REJECTED,
    rejectionReason: (rejectionReason || '').trim(),
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
  });
}
