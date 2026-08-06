// ---------------------------------------------------------------------------
// CAB SERVICE REQUEST SERVICE
//
// WHO THIS IS FOR. Signing in with a company Microsoft account is enough to get
// into the app (see selfProvisionFromDirectory in services/profile.js), but
// somebody who arrives that way has no employee id, no home address and no
// pickup route — so no cab can be sent for them, and until this existed they had
// no way to ask for one. They fill in those details here.
//
//   • Employee → createCabServiceRequest()   (status starts "Pending")
//   • Coordinator → proposeRoute()           (which route this address is on)
//   • Admin    → approveCabServiceRequest()  (writes name / empId / phone /
//                address / route onto their profile AND marks the request
//                "Approved", atomically)
//              → rejectCabServiceRequest()   (profile untouched, optional reason)
//
// THE REQUEST IS NOT THE PROFILE. The employee is asking, not writing: nothing
// they type reaches employees/<uid> until an admin approves it. That's the same
// reason addressChangeRequests exists — profile data is HR-owned — and it's
// enforced in firestore.rules, not just here.
//
// WHY THE COORDINATOR CAN'T APPROVE. Approval writes identity fields, and the
// rules only let a coordinator touch `roster.route` on a profile. So they do the
// part they're best placed for — knowing which pickup route an address sits on —
// and the admin confirms the rest.
// ---------------------------------------------------------------------------

import {
  collection, addDoc, doc, updateDoc, onSnapshot, query, where,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { notify, NOTIFY, cabServiceDecisionMessage } from './notifications';

const COL = 'cabServiceRequests';

export const CAB_REQUEST_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

// Employee raises the request. Always starts "Pending", and `requestedAt` must
// be the server's clock — the rules check it, so a wound-back device can't
// backdate its way to the front of the queue.
export async function createCabServiceRequest(data) {
  if (!firestore) throw new Error('Backend not configured.');
  if (!data?.employeeId) throw new Error('Missing employee.');
  return addDoc(collection(firestore, COL), {
    employeeId: data.employeeId,
    email: (data.email || '').trim().toLowerCase(),
    name: (data.name || '').trim(),
    empId: (data.empId || '').trim(),
    phone: (data.phone || '').trim(),
    address: (data.address || '').trim(),
    landmark: (data.landmark || '').trim(),
    note: (data.note || '').trim(),
    // Filled in by the coordinator, then used as the default when the admin
    // approves. Null means "nobody has said which route this is yet".
    proposedRoute: null,
    status: CAB_REQUEST_STATUS.PENDING,
    rejectionReason: '',
    reviewedBy: '',
    reviewedAt: null,
    approvedRoute: null,
    requestedAt: serverTimestamp(),
  });
}

// Newest first. A write that hasn't reached the server yet has no timestamp, so
// treat those as newest — same convention as the address/feedback services.
function byNewest(a, b) {
  const ta = a.requestedAt?.seconds ?? Infinity;
  const tb = b.requestedAt?.seconds ?? Infinity;
  return tb - ta;
}

function toList(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest);
}

// Desk (admin AND coordinator): the whole queue. Both roles watch it — the
// coordinator to route people, the admin to approve.
export function subscribeCabServiceRequests(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(collection(firestore, COL), (snap) => cb(toList(snap)), onError);
}

// Employee: only mine, so I can see whether I'm still waiting.
export function subscribeMyCabServiceRequests(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  const q = query(collection(firestore, COL), where('employeeId', '==', employeeId));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}

// Coordinator names the route for this address. The only field they may write
// here — see coordinatorProposingRoute() in firestore.rules.
export function proposeRoute(requestId, route) {
  if (!firestore) throw new Error('Backend not configured.');
  return updateDoc(doc(firestore, COL, requestId), {
    proposedRoute: route ? String(route).trim() : null,
  });
}

// Admin approves. Two things move together in ONE atomic batch:
//
//   1. the employee's profile — name, employee id, phone, address and pickup
//      route, plus clearing `selfProvisioned` because the desk has now vetted
//      them and they are no longer an unchecked walk-up
//   2. the request itself, marked Approved with what was actually approved
//
// `edits` is what the admin confirmed on screen, which may differ from what was
// typed (a tidied address, a corrected employee id) — so it, not the raw
// request, is what gets written.
//
// THE ROUTE IS THE POINT. Approving without one leaves them exactly as stuck as
// before: visible in the directory, but landing under "No route set" on the
// coordinator's board every single day. Hence the explicit check.
export async function approveCabServiceRequest(request, adminName, edits = {}) {
  if (!firestore) throw new Error('Backend not configured.');

  const name = (edits.name ?? request.name ?? '').trim();
  const empId = (edits.empId ?? request.empId ?? '').trim();
  const phone = (edits.phone ?? request.phone ?? '').trim();
  const address = (edits.address ?? request.address ?? '').trim();
  const route = (edits.route ?? request.proposedRoute ?? '').trim();

  if (!name) throw new Error('A name is required.');
  if (!address) throw new Error('A home address is required — the cab has nowhere to go without it.');
  if (!route) throw new Error('Pick a pickup route, or they will land under "No route set" every day.');

  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'employees', request.employeeId), {
    name,
    empId,
    phone,
    address,
    'roster.route': route,
    // They came in off the directory unvetted; the desk has now checked them.
    selfProvisioned: false,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(firestore, COL, request.id), {
    status: CAB_REQUEST_STATUS.APPROVED,
    approvedRoute: route,
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
    rejectionReason: '',
  });
  await batch.commit();

  // Tell them. Best-effort: the approval is already saved, and a failed
  // notification must never read as a failed approval.
  const msg = cabServiceDecisionMessage({ approved: true, route });
  notify({
    employeeId: request.employeeId,
    type: NOTIFY.CAB_SERVICE_RESOLVED,
    title: msg.title,
    body: msg.body,
    payload: { requestId: request.id },
  }).catch((e) => console.warn('[notify] cab service approval notice failed:', e?.message));

  return { name, empId, phone, address, route };
}

// Admin rejects: the profile is left exactly as it was. A reason matters more
// here than elsewhere — the person is left unable to get a cab, so "why" is the
// only actionable thing they have.
export async function rejectCabServiceRequest(request, adminName, rejectionReason) {
  if (!firestore) throw new Error('Backend not configured.');
  const reason = (rejectionReason || '').trim();
  await updateDoc(doc(firestore, COL, request.id), {
    status: CAB_REQUEST_STATUS.REJECTED,
    rejectionReason: reason,
    reviewedBy: adminName || 'Admin',
    reviewedAt: serverTimestamp(),
  });

  const msg = cabServiceDecisionMessage({ approved: false, reason });
  notify({
    employeeId: request.employeeId,
    type: NOTIFY.CAB_SERVICE_RESOLVED,
    title: msg.title,
    body: msg.body,
    payload: { requestId: request.id },
  }).catch((e) => console.warn('[notify] cab service rejection notice failed:', e?.message));
}

// --- Who still needs to fill this in ---------------------------------------
//
// The one place that decides whether someone is "set up for cab service", so
// the employee gate in App.js, the home screen and the desk queue can't drift
// apart on the answer.
//
// Deliberately based on the FIELDS, not on `selfProvisioned`: an employee HR
// created years ago with a blank address is in exactly the same position as a
// walk-up who signed in this morning — no cab can be sent for either.
export function needsCabServiceSetup(profile) {
  if (!profile) return false;
  if (profile.role !== 'employee') return false;
  return !String(profile.address || '').trim() || !String(profile.roster?.route || '').trim();
}

// Is there already a request in flight, so we ask them to wait rather than
// making them fill the same form again?
export function pendingRequest(requests) {
  return (requests || []).find((r) => r.status === CAB_REQUEST_STATUS.PENDING) || null;
}
