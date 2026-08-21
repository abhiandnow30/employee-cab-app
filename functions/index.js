// ---------------------------------------------------------------------------
// ⚠️  PARKED — NOT DEPLOYED. DO NOT WIRE ANYTHING TO THIS FILE.
//
// This needs the Blaze plan (a function calling an external API is blocked on
// the free Spark plan), and there is no budget approval for it. The live email
// path is ../mailer — a worker on a free host that holds the SendGrid key,
// triggered by the desk's client after an assignment, with `mailQueue` in
// Firestore as the durable record. See mailer/README.md.
//
// Kept because it is the better design *if* Blaze is ever approved: a Firestore
// trigger fires server-side whether or not the desk's browser is still open.
// Switching back means deploying this, deleting the queue call sites in
// AppContext, and dropping the mailQueue rules block — not editing this file.
//
// If you do revive it, note the email wording here predates the current in-app
// notification text: it promises a specific pickup time, which the app
// deliberately no longer does (see cabAssignedMessage() in
// app/src/services/notifications.js, and cabAssignedMail() in mailer/src/worker.js
// which follows it).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CLOUD FUNCTIONS — Employee Cab app
//
// onCabAssigned: fires whenever a bookings/{bookingId} doc's status becomes
// "Cab assigned" (or the assigned cab changes while it's already assigned —
// a reassignment), and emails the rider the cab number, driver, and pickup
// time. This is the only server-side code in the project; everything else is
// Firestore/RTDB called directly from the client (see ../CLAUDE.md).
//
// Runs with the Admin SDK, which bypasses firestore.rules entirely — that's
// expected and required here (a driver may not read employee profiles, but
// this function has to, to get their email).
// ---------------------------------------------------------------------------

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
const db = admin.firestore();

// Set with: firebase functions:secrets:set SENDGRID_API_KEY
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');

// Must be a sender identity verified in SendGrid (Settings → Sender
// Authentication) — SendGrid rejects the send otherwise. Replace before
// deploying.
const FROM_EMAIL = 'noreply@your-domain.com';

const STATUS_ASSIGNED = 'Cab assigned';

function formatPickupTime(departAt) {
  if (!departAt || typeof departAt.toDate !== 'function') return '';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(departAt.toDate());
}

function buildEmail({ employeeName, cab, pickupTime, pickupPoint, direction }) {
  const rows = [
    ['Cab number', cab.cabNumber || '—'],
    ['Driver', cab.driverName || '—'],
    ['Driver phone', cab.driverPhone || '—'],
    ['Pickup time', pickupTime || '—'],
    ['Pickup point', pickupPoint],
  ];

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h2 style="color:#1a56db; margin-bottom: 4px;">Your cab has been assigned</h2>
      <p>Hi ${employeeName},</p>
      <p>A cab has been assigned for your ${direction ? `${direction} ` : ''}ride${pickupTime ? ` on ${pickupTime}` : ''}.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
        ${rows
          .map(
            ([label, value]) => `
          <tr>
            <td style="padding:6px 0; color:#6b7280; border-bottom:1px solid #e5e7eb;">${label}</td>
            <td style="padding:6px 0; font-weight:bold; text-align:right; border-bottom:1px solid #e5e7eb;">${value}</td>
          </tr>`
          )
          .join('')}
      </table>
      <p style="color:#9ca3af; font-size:12px;">This is an automated message from the Cab Service app. Please do not reply to this email.</p>
    </div>
  `;

  const text = [
    'Your cab has been assigned.',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join('\n');

  return { html, text };
}

exports.onCabAssigned = onDocumentUpdated(
  { document: 'bookings/{bookingId}', secrets: [SENDGRID_API_KEY] },
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const bookingId = event.params.bookingId;

    const justAssigned = before.status !== STATUS_ASSIGNED && after.status === STATUS_ASSIGNED;
    const reassigned =
      after.status === STATUS_ASSIGNED &&
      before.assignedCabId &&
      after.assignedCabId &&
      before.assignedCabId !== after.assignedCabId;

    if (!justAssigned && !reassigned) return;
    if (!after.assignedCabId || !after.employeeId) return;

    const [employeeSnap, cabSnap] = await Promise.all([
      db.doc(`employees/${after.employeeId}`).get(),
      db.doc(`cabs/${after.assignedCabId}`).get(),
    ]);

    const employee = employeeSnap.exists ? employeeSnap.data() : null;
    const cab = cabSnap.exists ? cabSnap.data() : null;

    if (!employee?.email) {
      logger.warn('No email on file — skipping cab-assigned email.', {
        bookingId,
        employeeId: after.employeeId,
      });
      return;
    }
    if (!cab) {
      logger.warn('Assigned cab doc not found — skipping cab-assigned email.', {
        bookingId,
        cabId: after.assignedCabId,
      });
      return;
    }

    const { html, text } = buildEmail({
      employeeName: employee.name || after.employeeName || 'there',
      cab,
      pickupTime: formatPickupTime(after.departAt),
      pickupPoint: after.pickup === 'Office' ? 'Office' : after.employeeAddress || 'your registered address',
      direction: after.direction || '',
    });

    sgMail.setApiKey(SENDGRID_API_KEY.value());
    try {
      await sgMail.send({
        to: employee.email,
        from: FROM_EMAIL,
        subject: 'Your cab has been assigned',
        text,
        html,
      });
      logger.info('Cab-assigned email sent.', { bookingId, to: employee.email });
    } catch (err) {
      // Best-effort: a failed email must never retry into a loop or block the
      // booking — the assignment already succeeded before this function ran.
      logger.error('Failed to send cab-assigned email.', {
        bookingId,
        error: err?.response?.body || err.message,
      });
    }
  }
);
