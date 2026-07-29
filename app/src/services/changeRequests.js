// ---------------------------------------------------------------------------
// CHANGE REQUEST SERVICE  (Steps 7 & 8)
//
// An employee raises an exception to the roster; the desk resolves it. The
// routing policy lives in data/changeRequests.js — this module is the plumbing
// that reads it and carries out the effect.
//
// Resolving a request usually has to change TWO things at once — the request's
// own status, and the day's rides — so each resolver writes both in one batch.
// If a cancellation succeeded but the request stayed "Pending", the coordinator
// would work it twice.
//
// Requests are never deleted: they're the audit trail for why a rostered ride
// didn't run.
// ---------------------------------------------------------------------------

import {
  collection, addDoc, doc, getDocs, onSnapshot, query, where, orderBy, limit,
  writeBatch, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { firestore } from './firebase';
import {
  REQUEST_STATUS, REQUEST_TYPES, ROUTE_TO, EFFECT, requestMeta, requestLabel,
} from '../data/changeRequests';
import { STATUS } from '../data/mockData';
import { rosterId } from './roster';

const COL = 'changeRequests';

// --- Raise (employee) -------------------------------------------------------

// `data` = { type, date, reason, comments, rideKey?, bookingId?, requestedTime?,
//            requestedShiftCode?, direction? }
// The routing is set HERE from the policy table rather than being sent by the
// client, so an employee can't aim their own request at whichever desk they'd
// prefer.
export async function createChangeRequest(employee, data) {
  if (!firestore) throw new Error('Backend not configured.');
  const meta = requestMeta(data.type);
  if (!meta) throw new Error('Unknown request type.');

  return addDoc(collection(firestore, COL), {
    employeeId: employee.uid,
    employeeName: employee.name || employee.email || '',
    empId: employee.empId || '',
    route: employee.roster?.route || null,
    type: data.type,
    typeLabel: meta.label,
    date: data.date,
    reason: data.reason || '',
    comments: (data.comments || '').trim(),
    // Which ride it's about, when there is one.
    rideKey: data.rideKey || null,
    bookingId: data.bookingId || null,
    // Type-specific extras.
    requestedTime: data.requestedTime || null,
    requestedShiftCode: data.requestedShiftCode || null,
    direction: data.direction || null,
    // Routing + lifecycle.
    routedTo: meta.routeTo,
    effect: meta.effect,
    status: REQUEST_STATUS.PENDING,
    createdAt: serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: '',
    resolutionNote: '',
    escalated: false,
  });
}

// --- Reads ------------------------------------------------------------------

// An employee's own requests, newest first.
export function subscribeMyChangeRequests(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(firestore, COL),
      where('employeeId', '==', employeeId),
      orderBy('createdAt', 'desc'),
      limit(100)
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Everything the desk needs to work through, newest first. Both desk roles read
// the same collection and filter by `routedTo` in the UI, so an escalation is
// visible to HR the moment the coordinator raises it.
export function subscribeAllChangeRequests(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(firestore, COL), orderBy('createdAt', 'desc'), limit(300)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// --- Resolve (desk) --------------------------------------------------------

// Shared tail of every resolution: stamp the request itself.
function stampResolution(batch, request, { status, actor, note }) {
  batch.update(doc(firestore, COL, request.id), {
    status,
    resolvedAt: serverTimestamp(),
    resolvedBy: actor?.uid || null,
    resolvedByName: actor?.name || actor?.email || '',
    resolutionNote: (note || '').trim(),
  });
}

// Cancel the whole day's rides for this employee — Leave and Absent.
// `bookings` is the desk's live booking list; only that employee's rides on that
// date are touched. For Leave we also rewrite the roster's code to L, because
// leave is a roster fact and would otherwise regenerate rides tomorrow.
export async function resolveCancelDay(request, { actor, bookings, note, recode }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);

  const affected = (bookings || []).filter(
    (b) =>
      b.employeeId === request.employeeId &&
      b.date === request.date &&
      b.status !== STATUS.CANCELLED &&
      b.status !== STATUS.COMPLETED
  );
  affected.forEach((b) => {
    batch.update(doc(firestore, 'bookings', b.id), { status: STATUS.CANCELLED });
  });

  // Leave rewrites the roster so the day stops generating rides at all.
  if (recode) {
    const month = String(request.date).slice(0, 7);
    const day = String(request.date).slice(8, 10);
    batch.set(
      doc(firestore, 'rosters', rosterId(month, request.employeeId)),
      { days: { [day]: recode }, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  stampResolution(batch, request, { status: REQUEST_STATUS.RESOLVED, actor, note });
  await batch.commit();
  return { cancelled: affected.length };
}

// Cancel exactly one leg.
export async function resolveCancelRide(request, { actor, note }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  if (request.bookingId) {
    batch.update(doc(firestore, 'bookings', request.bookingId), { status: STATUS.CANCELLED });
  }
  stampResolution(batch, request, { status: REQUEST_STATUS.RESOLVED, actor, note });
  await batch.commit();
  // A ride with no booking document yet needed nothing cancelling — the roster
  // change (or simply not assigning it) is enough.
  return { cancelled: request.bookingId ? 1 : 0 };
}

// Move a pickup time. Only meaningful once the ride is a real booking; before
// that the coordinator just assigns at the new time.
export async function resolveRetime(request, { actor, note, newTime, departAt }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  if (request.bookingId) {
    batch.update(doc(firestore, 'bookings', request.bookingId), {
      shift: newTime,
      ...(departAt ? { departAt } : {}),
    });
  }
  stampResolution(batch, request, { status: REQUEST_STATUS.RESOLVED, actor, note });
  await batch.commit();
  return { retimed: request.bookingId ? 1 : 0 };
}

// Change the roster's shift code for that day. The day's rides are derived, so
// this is all that's needed — they regenerate at the new times. Any cab already
// assigned at the OLD time is cancelled, or the employee would have two rides.
export async function resolveRecode(request, { actor, bookings, note, code }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);

  const month = String(request.date).slice(0, 7);
  const day = String(request.date).slice(8, 10);
  batch.set(
    doc(firestore, 'rosters', rosterId(month, request.employeeId)),
    { days: { [day]: code }, updatedAt: serverTimestamp() },
    { merge: true }
  );

  const stale = (bookings || []).filter(
    (b) =>
      b.employeeId === request.employeeId &&
      b.date === request.date &&
      b.status !== STATUS.CANCELLED &&
      b.status !== STATUS.COMPLETED
  );
  stale.forEach((b) =>
    batch.update(doc(firestore, 'bookings', b.id), { status: STATUS.CANCELLED })
  );

  stampResolution(batch, request, { status: REQUEST_STATUS.RESOLVED, actor, note });
  await batch.commit();
  return { recoded: 1, cancelled: stale.length };
}

// Approve an extra ride (shift extension approved by HR, or an emergency the
// coordinator can cover). The booking itself is created by the caller — this
// records the decision. `status` is Approved rather than Resolved for a shift
// extension, because the coordinator still has to put a cab on it.
export async function resolveExtraRide(request, { actor, note, status }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  stampResolution(batch, request, {
    status: status || REQUEST_STATUS.APPROVED,
    actor,
    note,
  });
  await batch.commit();
  return { ok: true };
}

// Reject anything.
export async function rejectRequest(request, { actor, note }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  stampResolution(batch, request, { status: REQUEST_STATUS.REJECTED, actor, note });
  await batch.commit();
  return { ok: true };
}

// Coordinator has no vehicle free → push an emergency ride up to HR. The request
// stays Pending; only its routing moves, so it appears in the admin's exception
// queue without losing its history.
export async function escalateRequest(request, { actor, note }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, COL, request.id), {
    routedTo: ROUTE_TO.ADMIN,
    escalated: true,
    escalatedAt: serverTimestamp(),
    escalatedBy: actor?.uid || null,
    escalationNote: (note || '').trim(),
  });
  await batch.commit();
  return { ok: true };
}

// --- Helpers ---------------------------------------------------------------

// Is there already an open request of this type for that employee+date? Stops
// the desk seeing the same thing three times because someone tapped twice.
export async function findOpenRequest(employeeId, date, type) {
  if (!firestore) return null;
  const snap = await getDocs(
    query(
      collection(firestore, COL),
      where('employeeId', '==', employeeId),
      where('date', '==', date)
    )
  );
  const hit = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .find((r) => r.type === type && r.status === REQUEST_STATUS.PENDING);
  return hit || null;
}

// The queue for one desk role: still pending, and routed to them.
export function pendingFor(requests, role) {
  return (requests || []).filter(
    (r) => r.status === REQUEST_STATUS.PENDING && r.routedTo === role
  );
}

// Approved requests that call for an extra ride and don't have one yet. These are
// fed into ridesForDate() so they show up in the coordinator's day alongside the
// rostered rides — before this existed an approved extension went nowhere.
export function awaitingCab(requests) {
  return (requests || []).filter(
    (r) =>
      r.status === REQUEST_STATUS.APPROVED &&
      r.effect === EFFECT.EXTRA_RIDE &&
      !r.fulfilledBookingId
  );
}

// Close an extra-ride request once the desk has actually put a cab on it: record
// which booking fulfilled it and mark it done, so it stops appearing as
// outstanding work.
export async function markRequestFulfilled(requestId, bookingId) {
  if (!firestore || !requestId) return;
  return updateDoc(doc(firestore, COL, requestId), {
    fulfilledBookingId: bookingId || null,
    status: REQUEST_STATUS.RESOLVED,
    resolvedAt: serverTimestamp(),
  });
}

export { requestLabel, REQUEST_TYPES, REQUEST_STATUS, EFFECT, ROUTE_TO };
