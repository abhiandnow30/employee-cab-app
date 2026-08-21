// ---------------------------------------------------------------------------
// MAILER — the SendGrid sender, hosted OUTSIDE Firebase.
//
// WHY THIS EXISTS
// Cloud Functions can't be used on this project: a function that calls an
// external API (SendGrid) needs the Blaze plan, and we don't have billing
// approval. So the one piece of work that genuinely cannot happen in the client
// — holding the SendGrid API key — moved to a tiny worker on a free host
// (Cloudflare Workers by default; see README.md for other hosts).
//
// `functions/index.js` is the parked Cloud Function version. It is NOT deployed.
//
// WHAT MAKES THIS SAFE — read before changing anything
//
// This worker holds NO Firebase credentials. There is no service-account key
// here. Three separate things keep a public endpoint from becoming a mail relay,
// and they are not interchangeable — keep all three.
//
// 1. AUTHENTICATION — who is calling? `verifyIdToken()` checks the caller's
//    Firebase ID token the way any server would: RS256 signature against
//    Google's published public keys, plus issuer, audience and expiry pinned to
//    OUR project. A forged, expired, or another project's token is rejected
//    here, before a single Firestore call is made.
//
// 2. AUTHORISATION — what may they do? Every Firestore read and write is made
//    with THE CALLER'S OWN TOKEN, so `firestore.rules` decides, exactly as it
//    does for the app. A rider's token is perfectly valid at step 1 and still
//    sends nothing, because `mailQueue` is desk-only in the rules.
//
//    Step 2 is not redundant with step 1, and it is the reason the token is
//    still forwarded rather than just checked: signature verification cannot
//    see a REVOKED session or a DISABLED account — the signed token stays
//    cryptographically valid until it expires. Firestore checks revocation
//    server-side on every call. So step 1 is the cheap early gate, step 2 is
//    the authority. Do not "simplify" by dropping either.
//
// 3. NO CALLER-SUPPLIED CONTENT — the request body carries job ids and nothing
//    else: no recipient, no subject, no body. This worker reads the booking, the
//    rider's profile and the cab out of Firestore and renders the message from
//    the template below. So the worst a signed-in desk user can do is email a
//    real rider about their own real booking, which is the feature. NEVER add a
//    caller-supplied `to`, `subject` or `html`: that hands the company's
//    SendGrid reputation to anyone who can sign in.
//
// The only secret here is SENDGRID_API_KEY, set with `wrangler secret put`.
// ---------------------------------------------------------------------------

// A single POST may touch at most this many jobs — a runaway client (or an
// attacker with a stolen desk token) can't turn one request into a mail blast.
const MAX_JOBS = 60;

// After this many tries a job is parked as 'failed' rather than retried
// forever. Each flush from the app retries whatever is still 'pending'.
const MAX_ATTEMPTS = 3;

const MAIL_TYPES = ['cab_assigned'];

export default { fetch: handle };

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

export async function handle(request, env) {
  const origin = request.headers.get('Origin');
  const cors = corsHeaders(origin, env);

  // Native (iOS/Android) requests carry no Origin and no preflight; the web
  // bundle does, and its origin has to be listed in ALLOWED_ORIGINS.
  if (origin && !cors) {
    return json({ error: 'Origin not allowed.' }, 403, {});
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors || {} });
  }
  if (request.method !== 'POST') {
    return json({ error: 'POST only.' }, 405, cors || {});
  }

  const missing = ['FIREBASE_PROJECT_ID', 'SENDGRID_API_KEY', 'FROM_EMAIL'].filter(
    (k) => !env[k]
  );
  if (missing.length) {
    console.error('[mailer] not configured — missing', missing.join(', '));
    return json({ error: 'Mailer is not configured.' }, 500, cors || {});
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400, cors || {});
  }

  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((v) => typeof v === 'string' && v.length && v.length <= 200))]
    : [];

  if (!idToken) return json({ error: 'idToken is required.' }, 401, cors || {});
  if (!ids.length) return json({ error: 'ids is required.' }, 400, cors || {});
  if (ids.length > MAX_JOBS) {
    return json({ error: `At most ${MAX_JOBS} ids per request.` }, 400, cors || {});
  }

  // GATE 1: is this a real token from our project? Rejected here, the request
  // never reaches Firestore or SendGrid. What this does NOT establish is that
  // the caller may send mail — that's gate 2, the rules, below.
  let caller;
  try {
    caller = (await verifyIdToken(idToken, env)).sub;
  } catch (err) {
    const status = err?.status === 503 ? 503 : 401;
    console.warn('[mailer] token rejected', { status, error: String(err?.message || err) });
    return json({ error: String(err?.message || err) }, status, cors || {});
  }

  const results = [];
  for (const id of ids) {
    try {
      results.push({ id, ...(await runJob(env, idToken, id)) });
    } catch (err) {
      const status = err?.status || 500;
      console.error('[mailer] job failed', { id, caller, status, error: String(err?.message || err) });
      // A denied read means this caller isn't the desk, or their session was
      // revoked since the token was signed. Stop rather than grind through the
      // rest — they will all fail the same way, and the app treats a non-2xx as
      // "retry on the next flush".
      if (status === 401 || status === 403) {
        return json({ error: 'Not allowed.', results }, 403, cors || {});
      }
      results.push({ id, status: 'error', error: String(err?.message || err) });
    }
  }

  return json({ results }, 200, cors || {});
}

// ---------------------------------------------------------------------------
// One job: claim it, build the mail, send it, record the outcome.
// ---------------------------------------------------------------------------

async function runJob(env, token, jobId) {
  const jobDoc = await fsGet(env, token, `mailQueue/${jobId}`);
  if (!jobDoc) return { status: 'skipped', reason: 'no such job' };

  const job = docData(jobDoc);
  if (job.status !== 'pending') {
    // Already sent, already being sent by a concurrent flush, or parked.
    return { status: 'skipped', reason: `status is ${job.status}` };
  }
  if (!MAIL_TYPES.includes(job.type)) {
    await finishJob(env, token, jobId, { status: 'failed', lastError: `unknown type ${job.type}` });
    return { status: 'failed', reason: 'unknown type' };
  }

  const attempts = Number(job.attempts || 0);

  // CLAIM IT FIRST, conditional on the document not having changed since we
  // read it. Two desk browsers flushing the same backlog at the same moment
  // both get here; only one wins the precondition, so nobody gets the mail
  // twice.
  const claimed = await claimJob(env, token, jobId, jobDoc.updateTime, attempts);
  if (!claimed) return { status: 'skipped', reason: 'claimed by another sender' };

  let mail;
  try {
    mail = await buildMail(env, token, job);
  } catch (err) {
    // Missing booking / no email on file — nothing a retry will fix.
    await finishJob(env, token, jobId, {
      status: 'failed',
      lastError: String(err?.message || err).slice(0, 500),
    });
    return { status: 'failed', reason: String(err?.message || err) };
  }

  try {
    await sendViaSendGrid(env, mail);
  } catch (err) {
    // A 4xx from SendGrid is our fault (unverified sender, malformed address)
    // and will fail identically next time, so park it. A 5xx or a network blip
    // is transient: leave it 'pending' and the next flush picks it up.
    const permanent = err?.sendGridStatus >= 400 && err?.sendGridStatus < 500;
    const spent = attempts + 1 >= MAX_ATTEMPTS;
    await finishJob(env, token, jobId, {
      status: permanent || spent ? 'failed' : 'pending',
      lastError: String(err?.message || err).slice(0, 500),
    });
    return {
      status: permanent || spent ? 'failed' : 'pending',
      reason: String(err?.message || err),
    };
  }

  await finishJob(env, token, jobId, { status: 'sent', sentTo: mail.to });
  return { status: 'sent' };
}

// Everything the email says comes from Firestore, never from the request.
async function buildMail(env, token, job) {
  const bookingDoc = await fsGet(env, token, `bookings/${job.bookingId}`);
  if (!bookingDoc) throw new Error(`booking ${job.bookingId} not found`);
  const booking = docData(bookingDoc);

  if (!booking.employeeId) throw new Error('booking has no employeeId');

  const [employeeDoc, cabDoc] = await Promise.all([
    fsGet(env, token, `employees/${booking.employeeId}`),
    booking.assignedCabId ? fsGet(env, token, `cabs/${booking.assignedCabId}`) : null,
  ]);

  const employee = docData(employeeDoc) || {};
  const cab = docData(cabDoc) || {};

  const to = (employee.email || '').trim();
  if (!to) throw new Error('no email on file for this employee');
  if (!cab.cabNumber) throw new Error('assigned cab not found');

  return { to, ...cabAssignedMail({ booking, employee, cab, env }) };
}

// ---------------------------------------------------------------------------
// The message.
//
// Wording follows `cabAssignedMessage()` in app/src/services/notifications.js
// on purpose, so the email and the in-app notification say the same thing. Note
// what it does NOT say: a promised pickup instant. The shift time is a deadline
// (pickup) or an earliest bound (drop); the driver coordinates the exact minute
// with the rider. Keep the two channels in step if you change either.
// ---------------------------------------------------------------------------

function cabAssignedMail({ booking, employee, cab, env }) {
  const name = employee.name || booking.employeeName || 'there';

  // `leg` decides the direction when it's there; older bookings only carry
  // `pickup`, so that's the fallback. Guessing "inbound" off a missing pickup
  // would send someone to the wrong end of the trip.
  const inbound = booking.leg ? booking.leg === 'in' : booking.pickup !== 'Office';
  const from = inbound ? booking.employeeAddress || employee.address || 'your home' : 'the office';

  // The shift time is a BOUND, not a departure time — see the block comment
  // above. Phrased the same way the in-app notification phrases it.
  const bound = booking.shift
    ? inbound
      ? `reach office by ${booking.shift}`
      : `leaves after ${booking.shift}`
    : '';

  const rows = [
    ['Cab number', cab.cabNumber || '—'],
    ['Driver', cab.driverName || '—'],
    ['Driver phone', cab.driverPhone || '—'],
    ['Date', booking.date || '—'],
    ['Shift', booking.shift || '—'],
    ['Pickup from', from],
  ];

  const subject = `Cab assigned — ${booking.date || 'your upcoming ride'}`;
  const ride = [
    booking.direction ? `${booking.direction} ride` : 'ride',
    booking.date ? `on ${booking.date}` : '',
    bound ? `(${bound})` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h2 style="color:#1a56db; margin-bottom: 4px;">Your cab has been assigned</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>A cab has been assigned for your ${escapeHtml(ride)}.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
        ${rows
          .map(
            ([label, value]) => `
          <tr>
            <td style="padding:6px 0; color:#6b7280; border-bottom:1px solid #e5e7eb;">${escapeHtml(label)}</td>
            <td style="padding:6px 0; font-weight:bold; text-align:right; border-bottom:1px solid #e5e7eb;">${escapeHtml(String(value))}</td>
          </tr>`
          )
          .join('')}
      </table>
      <p>The driver will coordinate the exact pickup time with you. You can follow the
         cab live from <strong>My Rides</strong> in the app.</p>
      <p style="color:#9ca3af; font-size:12px;">This is an automated message from the
         ${escapeHtml(env.COMPANY_NAME || 'Cab Service')} app. Please do not reply to this email.</p>
    </div>
  `;

  const text = [
    `Your cab has been assigned for your ${ride}.`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'The driver will coordinate the exact pickup time with you.',
    'Follow the cab live from My Rides in the app.',
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// SendGrid
// ---------------------------------------------------------------------------

async function sendViaSendGrid(env, { to, subject, text, html }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.FROM_EMAIL, name: env.FROM_NAME || env.COMPANY_NAME || 'Cab Service' },
      reply_to: env.REPLY_TO_EMAIL ? { email: env.REPLY_TO_EMAIL } : undefined,
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
      // Rewriting links in an internal notification buys nothing and makes the
      // mail look like marketing to spam filters.
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
    }),
  });

  if (res.status === 202) return;

  const detail = (await res.text().catch(() => '')).slice(0, 500);
  const err = new Error(`SendGrid ${res.status}: ${detail}`);
  err.sendGridStatus = res.status;
  throw err;
}

// ---------------------------------------------------------------------------
// Firestore REST, always as the CALLER (so firestore.rules applies)
// ---------------------------------------------------------------------------

function docsBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

function docName(env, path) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function fsGet(env, token, path) {
  const res = await fetch(`${docsBase(env)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    throw httpError(403, `Firestore denied read of ${path}`);
  }
  if (!res.ok) {
    throw httpError(502, `Firestore read of ${path} failed: ${res.status}`);
  }
  return res.json();
}

// Take the job, but only if nobody else has touched it since we read it.
// Returns false when the precondition loses — that is a normal outcome, not an
// error. Ordinary rule denials still raise, so a bad token doesn't look like a
// lost race.
async function claimJob(env, token, jobId, updateTime, attempts) {
  const res = await fsCommit(env, token, {
    writes: [
      {
        update: {
          name: docName(env, `mailQueue/${jobId}`),
          fields: {
            status: { stringValue: 'sending' },
            attempts: { integerValue: String(attempts + 1) },
          },
        },
        updateMask: { fieldPaths: ['status', 'attempts'] },
        currentDocument: { updateTime },
      },
    ],
  });
  if (res.ok) return true;
  if (res.status === 400 || res.status === 409) return false; // FAILED_PRECONDITION
  if (res.status === 401 || res.status === 403) {
    throw httpError(403, 'Firestore denied the mailQueue write');
  }
  throw httpError(502, `Could not claim job ${jobId}: ${res.status}`);
}

// Record the outcome. `sentAt` is written as a server-side transform rather
// than a clock reading from this worker — the same reason the app uses
// serverTimestamp() everywhere.
async function finishJob(env, token, jobId, { status, sentTo, lastError }) {
  const fields = { status: { stringValue: status } };
  const paths = ['status'];
  if (sentTo) {
    fields.sentTo = { stringValue: sentTo };
    paths.push('sentTo');
  }
  fields.lastError = lastError ? { stringValue: lastError } : { nullValue: null };
  paths.push('lastError');

  const write = {
    update: { name: docName(env, `mailQueue/${jobId}`), fields },
    updateMask: { fieldPaths: paths },
  };
  if (status === 'sent') {
    write.updateTransforms = [{ fieldPath: 'sentAt', setToServerValue: 'REQUEST_TIME' }];
  }

  const res = await fsCommit(env, token, { writes: [write] });
  if (!res.ok) {
    // The mail may well have gone out already, so this must not look like a
    // send failure — log it and move on. Worst case the job stays 'sending'
    // and is visible in Firestore as stuck.
    console.error('[mailer] could not record outcome', { jobId, status, http: res.status });
  }
}

function fsCommit(env, token, body) {
  return fetch(`${docsBase(env)}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Firestore's typed values → plain JS.
function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue; // ISO 8601 string
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const key of Object.keys(fields)) out[key] = decodeValue(fields[key]);
  return out;
}

function docData(doc) {
  return doc ? decodeFields(doc.fields || {}) : null;
}

// ---------------------------------------------------------------------------
// FIREBASE ID TOKEN VERIFICATION  (step 1 of the three gates — see the header)
//
// A Firebase ID token is an RS256 JWT signed by Google. Verifying it means:
// checking the signature against the public key named by the token's `kid`, then
// checking the claims are for our project and still current. That is all the
// Admin SDK's verifyIdToken() does locally too — minus revocation checking,
// which needs a Google round trip and which Firestore already does for us on
// every call (see gate 2 in the header).
//
// Everything here uses WebCrypto and no dependencies, so it runs unchanged on
// Cloudflare Workers, Deno, Vercel Edge and Node 18+.
// ---------------------------------------------------------------------------

// Google's public keys for Firebase Auth tokens, in JWK form so WebCrypto can
// import them directly. (The /robot/v1/metadata/x509/ URL serves the same keys
// as X.509 certificates, which WebCrypto cannot import without hand-parsing the
// DER — hence the JWK endpoint.)
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Google rotates these keys and publishes a Cache-Control max-age (~6h). We
// honour it, clamped: never hammer the endpoint, never trust a key set for days.
const JWKS_MIN_TTL_MS = 5 * 60 * 1000;
const JWKS_MAX_TTL_MS = 6 * 60 * 60 * 1000;

// Tolerance for clock drift between Google's signer and this worker.
const CLOCK_SKEW_S = 60;

// Per-isolate cache. A cold isolate costs one extra fetch; a warm one costs
// nothing, which is why the JWKS fetch doesn't show up per request.
let jwksCache = { keys: null, expiresAt: 0 };

async function fetchJwks() {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw httpError(503, `Could not fetch Google's signing keys: ${res.status}`);
  const body = await res.json();
  const keys = body?.keys;
  if (!Array.isArray(keys) || !keys.length) {
    throw httpError(503, "Google's signing key set was empty");
  }

  const maxAge = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '');
  const ttl = Math.min(
    JWKS_MAX_TTL_MS,
    Math.max(JWKS_MIN_TTL_MS, maxAge ? Number(maxAge[1]) * 1000 : JWKS_MIN_TTL_MS)
  );
  jwksCache = { keys, expiresAt: Date.now() + ttl };
  return keys;
}

// The JWK for this `kid`. A miss is expected around a rotation, so we refetch
// once before giving up — otherwise every request in a warm isolate would fail
// for as long as the stale set was cached.
async function jwkForKid(kid) {
  if (!jwksCache.keys || Date.now() >= jwksCache.expiresAt) await fetchJwks();
  let jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) {
    await fetchJwks();
    jwk = jwksCache.keys.find((k) => k.kid === kid);
  }
  return jwk || null;
}

// Returns the token's claims, or throws a 401. Never returns for a bad token —
// callers can treat a return value as "this is a real user of our project".
export async function verifyIdToken(idToken, env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw httpError(401, 'Malformed ID token.');
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header;
  let claims;
  try {
    header = b64urlToJson(rawHeader);
    claims = b64urlToJson(rawPayload);
  } catch {
    throw httpError(401, 'Malformed ID token.');
  }

  // PIN THE ALGORITHM. Without this, `alg: "none"` (no signature at all) or a
  // switch to HS256 (where the "public" key doubles as the HMAC secret) turn
  // verification into theatre. Firebase only ever issues RS256.
  if (header?.alg !== 'RS256') {
    throw httpError(401, `Unexpected token algorithm: ${header?.alg}`);
  }
  if (typeof header?.kid !== 'string' || !header.kid) {
    throw httpError(401, 'ID token has no key id.');
  }

  // Claims, per Firebase's documented requirements. `aud`/`iss` are what stop a
  // token minted by some OTHER Firebase project — trivially obtainable, since
  // anyone can create one — from being accepted here.
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== projectId) {
    throw httpError(401, 'ID token is for a different project.');
  }
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw httpError(401, 'ID token has the wrong issuer.');
  }
  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw httpError(401, 'ID token has no subject.');
  }
  if (!(Number(claims.exp) > now - CLOCK_SKEW_S)) {
    throw httpError(401, 'ID token has expired.');
  }
  if (!(Number(claims.iat) <= now + CLOCK_SKEW_S)) {
    throw httpError(401, 'ID token was issued in the future.');
  }
  if (claims.auth_time != null && !(Number(claims.auth_time) <= now + CLOCK_SKEW_S)) {
    throw httpError(401, 'ID token has a future auth time.');
  }

  const jwk = await jwkForKid(header.kid);
  if (!jwk) throw httpError(401, 'ID token was signed by an unknown key.');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(rawSignature),
    signed
  );
  if (!ok) throw httpError(401, 'ID token signature does not verify.');

  return claims;
}

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin, env) {
  const base = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (!origin) return base; // native app: no CORS involved at all
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { ...base, 'Access-Control-Allow-Origin': origin };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
