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

// `data` = { type, date, reason, comments, rideKey?, bookingId?,
//            requestedShiftCode? }
// The routing is set HERE from the policy table rather than being sent by the
// client. Everything goes to the coordinator now, but the indirection stays: the
// rules check `routedTo` on every create, and it must come from policy, not from
// whatever the client felt like sending.
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
    // Type-specific extras. Only "shift changed" has one — no request asks for a
    // time or a direction any more, because both would mean a ride outside the two
    // the company runs.
    requestedShiftCode: data.requestedShiftCode || null,
    // Routing + lifecycle.
    routedTo: meta.routeTo,
    effect: meta.effect,
    status: REQUEST_STATUS.PENDING,
    createdAt: serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: '',
    resolutionNote: '',
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

// Everything the desk needs to work through, newest first. `pendingFor` filters it
// down to what is still open — all of which is the coordinator's.
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

// Resolve a request that needs nothing done to the data — the desk has simply
// acted on it. Kept as the fallback branch so an unrecognised type can still be
// closed rather than sitting in the queue for ever.
export async function resolveNoop(request, { actor, note, status }) {
  if (!firestore) throw new Error('Backend not configured.');
  const batch = writeBatch(firestore);
  stampResolution(batch, request, {
    status: status || REQUEST_STATUS.RESOLVED,
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

export { requestLabel, REQUEST_TYPES, REQUEST_STATUS, EFFECT, ROUTE_TO };
