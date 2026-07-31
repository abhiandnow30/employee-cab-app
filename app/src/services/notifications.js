// ---------------------------------------------------------------------------
// NOTIFICATIONS  (in-app)
//
// Step 6 of the workflow: once a cab is assigned, tell the employee — driver,
// cab number and place, and a link to follow it live. Never a promised pickup
// instant — the driver coordinates that directly with the rider.
//
// These are IN-APP notifications: a document per employee event, read by the
// employee's Notifications screen with an unread badge in the header. That needs
// no infrastructure beyond Firestore.
//
// PUSH notifications (a banner on a locked phone) are deliberately NOT this —
// they need expo-notifications, a stored device token per user, and a server
// holding the FCM key, which means Cloud Functions and a paid Firebase plan.
// When that exists, it reads this same collection and sends; nothing here
// changes.
//
// Written by the DESK (assignment, resolving a request), read by the employee.
// ---------------------------------------------------------------------------

import {
  collection, addDoc, doc, updateDoc, onSnapshot, query, where, orderBy, limit,
  writeBatch, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { firestore } from './firebase';

const COL = 'notifications';

export const NOTIFY = {
  CAB_ASSIGNED: 'cab_assigned',
  RIDE_CANCELLED: 'ride_cancelled',
  PICKUP_CHANGED: 'pickup_changed',
  REQUEST_RESOLVED: 'request_resolved',
  ADDRESS_RESOLVED: 'address_resolved',
  ROSTER_PUBLISHED: 'roster_published',
};

// Create one notification. `payload` carries whatever the screen needs to deep
// link — a bookingId to open Track Cab, a date to open the calendar.
export async function notify({ employeeId, type, title, body, payload = {} }) {
  if (!firestore || !employeeId) return null;
  return addDoc(collection(firestore, COL), {
    employeeId,
    type,
    title,
    body,
    payload,
    createdAt: serverTimestamp(),
    readAt: null,
  });
}

// Notify many employees at once — one cab assignment covers a whole carpool.
// Batched, and chunked under Firestore's 500-write limit.
export async function notifyMany(items) {
  if (!firestore || !items?.length) return 0;
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(firestore);
    items.slice(i, i + CHUNK).forEach((n) => {
      batch.set(doc(collection(firestore, COL)), {
        employeeId: n.employeeId,
        type: n.type,
        title: n.title,
        body: n.body,
        payload: n.payload || {},
        createdAt: serverTimestamp(),
        readAt: null,
      });
    });
    await batch.commit();
    written += Math.min(CHUNK, items.length - i);
  }
  return written;
}

// The employee's own feed, newest first. Returns an unsubscribe function.
export function subscribeMyNotifications(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  const q = query(
    collection(firestore, COL),
    where('employeeId', '==', employeeId),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export function markRead(id) {
  return updateDoc(doc(firestore, COL, id), { readAt: serverTimestamp() });
}

// Clear the badge in one write per unread item, batched.
export async function markAllRead(employeeId) {
  if (!firestore || !employeeId) return 0;
  const snap = await getDocs(
    query(
      collection(firestore, COL),
      where('employeeId', '==', employeeId),
      where('readAt', '==', null)
    )
  );
  if (snap.empty) return 0;
  const batch = writeBatch(firestore);
  snap.docs.forEach((d) => batch.update(d.ref, { readAt: serverTimestamp() }));
  await batch.commit();
  return snap.size;
}

// --- Message builders -------------------------------------------------------
// Kept here so the wording of an assignment notification lives in one place
// rather than being retyped at each call site.

// Everything Step 6 asks for: driver, phone, cab, place, and the tracking
// link. The "link" is the app's own Track Cab route — a real URL on web.
//
// Deliberately does NOT promise a specific pickup/drop instant — the shift's
// own start/end is a deadline (pickup) or earliest-bound (drop) on the
// employee's schedule, not a cab departure time the app predetermines. The
// driver/transport desk coordinate the exact timing on the day.
export function cabAssignedMessage(ride, cab) {
  const driver = cab?.driverName || 'Your driver';
  const phone = cab?.driverPhone ? ` (${cab.driverPhone})` : '';
  const where = ride.leg === 'in' ? ride.employeeAddress || 'your home' : 'the office';
  const bound = ride.leg === 'in' ? `reach office by ${ride.shift}` : `leaves after ${ride.shift}`;
  return {
    title: `Cab assigned — ${ride.date}`,
    body:
      `${cab?.cabNumber || 'A cab'} · ${driver}${phone}\n` +
      `${ride.direction} on ${ride.date} (${bound}) from ${where}. ` +
      `The driver will coordinate the exact pickup time.\n` +
      `Track it live from My Rides.`,
  };
}

export function rideCancelledMessage(ride, note) {
  return {
    title: `Ride cancelled — ${ride.date}`,
    body:
      `Your ${ride.direction} ride on ${ride.date} has been cancelled.` +
      (note ? `\n${note}` : ''),
  };
}

// The outcome of a home-address change. Worth telling them either way: an
// approved move changes where the cab collects them tomorrow, and a rejected one
// means it doesn't — and until this existed both were silent, discoverable only by
// opening Profile and noticing the chip had changed.
export function addressDecisionMessage({ approved, address, route, reason }) {
  if (approved) {
    return {
      title: 'Address change approved',
      body:
        `Your home address is now:\n${address}` +
        (route ? `\nYou are on the ${route} pickup route.` : '') +
        '\nUpcoming rides have been updated.',
    };
  }
  return {
    title: 'Address change rejected',
    body:
      'Your home address is unchanged.' +
      (reason ? `\n${reason}` : '\nContact the transport desk for details.'),
  };
}

export function requestResolvedMessage(request, outcome, note) {
  return {
    title: `${outcome} — ${request.typeLabel || 'your request'}`,
    body:
      `Your request for ${request.date} was ${outcome.toLowerCase()}.` +
      (note ? `\n${note}` : ''),
  };
}
