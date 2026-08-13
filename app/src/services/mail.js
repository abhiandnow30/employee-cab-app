// ---------------------------------------------------------------------------
// EMAIL NOTIFICATIONS (outbound, via SendGrid)
//
// The rider gets an email when a cab is assigned. Two things had to be true at
// once: the SendGrid API key must never reach a client bundle, and we cannot use
// Cloud Functions (calling an external API from one needs the Blaze plan, which
// we don't have). So the split is:
//
//   this file  → writes a JOB into `mailQueue` and asks the mailer to run it
//   ../../../mailer → a worker on a free host that holds the SendGrid key,
//                     reads the booking/rider/cab out of Firestore and sends
//
// WHAT THE CLIENT SENDS IS ONLY IDS. No recipient, no subject, no body — the
// mailer derives all of that from Firestore, so nothing here can be talked into
// emailing an arbitrary address. Don't "simplify" this by posting the message
// text: that turns the endpoint into an open relay for anyone who can sign in.
//
// WHY THERE IS A QUEUE COLLECTION AT ALL
// A Firestore trigger used to guarantee the email got a go at being sent even if
// the browser that assigned the cab was closed a second later. Without triggers,
// the desk's own client is what kicks the send off — so the intent is recorded
// durably FIRST (one `mailQueue` doc per rider), and the HTTP call is only an
// attempt. Anything still `pending` is retried by the next flush, and a job that
// never sends stays visible in Firestore instead of vanishing.
//
// Everything here is BEST-EFFORT and never throws: a failed email must not undo
// a completed cab assignment. Same treatment as the in-app notifications in
// notifications.js.
// ---------------------------------------------------------------------------

import {
  collection, doc, getDocs, query, where, limit, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { firestore, auth } from './firebase';

const COL = 'mailQueue';

export const MAIL = {
  CAB_ASSIGNED: 'cab_assigned',
};

// Set in .env — the deployed mailer's URL (see mailer/README.md). With no URL
// the app behaves exactly as it did before emails existed: in-app notifications
// still work, jobs simply aren't queued.
export const MAILER_URL = (process.env.EXPO_PUBLIC_MAILER_URL || '').replace(/\/+$/, '');
export const hasMailer = MAILER_URL.length > 0;

// The mailer caps a request at 60 jobs, so we do too.
const MAX_PER_REQUEST = 60;

// How long a job may sit `pending` before a later flush treats it as abandoned
// and retries it. Long enough that a send in flight from another tab isn't
// duplicated (and the mailer's claim step catches that race anyway).
const STALE_MS = 2 * 60 * 1000;

// --- Public API -------------------------------------------------------------

// Queue "your cab has been assigned" for every rider on a freshly assigned cab.
// `rides` is [{ bookingId, employeeId }]. Fire-and-forget: callers don't await.
export async function queueCabAssignedEmails(rides) {
  const jobs = (rides || [])
    .filter((r) => r?.bookingId && r?.employeeId)
    .map((r) => ({ type: MAIL.CAB_ASSIGNED, bookingId: r.bookingId, employeeId: r.employeeId }));
  if (!jobs.length) return { queued: 0, sent: 0 };
  return queueAndFlush(jobs);
}

// Retry whatever is still pending, without queueing anything new. Exposed so a
// screen can offer "resend failed emails" later; `queueAndFlush` also calls the
// same sweep on every assignment, which is what makes stragglers self-heal
// without anyone pressing a button.
export async function flushPendingMail() {
  return queueAndFlush([]);
}

// --- Internals --------------------------------------------------------------

async function queueAndFlush(jobs) {
  if (!firestore) return { queued: 0, sent: 0 };

  let ids = [];
  try {
    ids = await writeJobs(jobs);
  } catch (e) {
    console.warn('[mail] could not queue email jobs:', e?.message);
    return { queued: 0, sent: 0 };
  }

  if (!hasMailer) {
    // Nothing to send with — the jobs stay `pending`, so configuring
    // EXPO_PUBLIC_MAILER_URL later picks them up rather than losing them.
    if (ids.length) console.warn('[mail] EXPO_PUBLIC_MAILER_URL is not set — jobs left pending.');
    return { queued: ids.length, sent: 0 };
  }

  const stale = await stalePendingIds(ids);
  const batch = [...ids, ...stale].slice(0, MAX_PER_REQUEST);
  if (!batch.length) return { queued: ids.length, sent: 0 };

  const sent = await postToMailer(batch);
  return { queued: ids.length, sent };
}

// One doc per rider, written in a single batch so the whole carpool's intent
// lands or none of it does.
async function writeJobs(jobs) {
  if (!jobs.length) return [];
  const uid = auth?.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');

  const batch = writeBatch(firestore);
  const ids = [];
  jobs.slice(0, MAX_PER_REQUEST).forEach((job) => {
    const ref = doc(collection(firestore, COL));
    ids.push(ref.id);
    batch.set(ref, {
      type: job.type,
      bookingId: job.bookingId,
      employeeId: job.employeeId,
      status: 'pending',
      attempts: 0,
      queuedBy: uid,
      queuedAt: serverTimestamp(),
    });
  });
  await batch.commit();
  return ids;
}

// Jobs an earlier attempt left behind — the tab was closed mid-send, the mailer
// was unreachable, SendGrid had a wobble. Equality-only query, so no composite
// index is needed; the age filter happens here.
async function stalePendingIds(exclude) {
  try {
    const snap = await getDocs(
      query(collection(firestore, COL), where('status', '==', 'pending'), limit(50))
    );
    const skip = new Set(exclude);
    const cutoff = Date.now() - STALE_MS;
    return snap.docs
      .filter((d) => !skip.has(d.id))
      .filter((d) => {
        const at = d.data().queuedAt;
        // A null `queuedAt` is a serverTimestamp that hasn't resolved locally
        // yet — i.e. something just written, not a straggler.
        return typeof at?.toMillis === 'function' && at.toMillis() < cutoff;
      })
      .map((d) => d.id);
  } catch (e) {
    // Only the desk may read this collection. Anyone else lands here, which is
    // fine — they never queue mail either.
    console.warn('[mail] could not scan pending jobs:', e?.message);
    return [];
  }
}

async function postToMailer(ids) {
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(`${MAILER_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, ids }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn('[mail] mailer rejected the request:', res.status, payload?.error || '');
      return 0;
    }
    const results = payload?.results || [];
    const sent = results.filter((r) => r.status === 'sent').length;
    const bad = results.filter((r) => r.status === 'failed' || r.status === 'error');
    if (bad.length) console.warn('[mail] some emails did not send:', bad);
    return sent;
  } catch (e) {
    // Offline, DNS, CORS — the jobs are still `pending`, so the next
    // assignment's flush retries them.
    console.warn('[mail] could not reach the mailer:', e?.message);
    return 0;
  }
}
