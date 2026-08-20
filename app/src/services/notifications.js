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
  CAB_SERVICE_RESOLVED: 'cab_service_resolved',
  // THE ONLY TYPE A DRIVER CAN SEND. Every other notification in this list is
  // raised by the desk; this one is raised from the kerb, by the person who
  // decided the rider wasn't there. firestore.rules is written around that
  // asymmetry — see the `notifications` create rule, which lets a driver file
  // this type and nothing else, for a rider on their own cab and nobody else.
  NO_SHOW: 'no_show',
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

// The driver reached the pickup and marked the rider absent.
//
// WORDED AS A CLAIM, NOT A VERDICT — "the driver marked", not "you did not turn
// up". This is one person's account of what happened at a kerb, and it is the
// only notification in this file that is not the desk reporting its own
// decision. If it is wrong, the rider is the one who knows, and they can only
// say so if they are told at the time rather than discovering it in a report
// weeks later. Hence the helpline: this message has to be actionable, because
// the rider cannot change the status themselves.
export function noShowMessage(ride, helpline) {
  return {
    title: `Marked as no-show — ${ride?.date || 'today'}`,
    body:
      `The driver marked you as not present for your ${
        ride?.direction || 'cab'
      } ride${ride?.shift ? ` at ${ride.shift}` : ''}.` +
      (helpline ? `\nIf that isn't right, call the transport desk on ${helpline}.` : ''),
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

// The outcome of a "please set me up for cab service" request from someone who
// signed in without being on the roster. Worth telling them either way: until
// this is decided they have no route, so no cab can collect them, and the
// waiting is otherwise invisible.
export function cabServiceDecisionMessage({ approved, route, reason }) {
  if (approved) {
    return {
      title: 'Cab service approved',
      body:
        'Your details have been confirmed by the transport desk.' +
        (route ? `\nYou are on the ${route} pickup route.` : '') +
        '\nYour rides will appear here once you are added to a shift roster.',
    };
  }
  return {
    title: 'Cab service request rejected',
    body:
      'The transport desk could not set up cab service from these details.' +
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
