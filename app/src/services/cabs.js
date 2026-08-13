// ---------------------------------------------------------------------------
// CABS SERVICE
// The fleet lives in the Firestore "cabs" collection, maintained by the TRANSPORT
// COORDINATOR: they add each vehicle, keep its details current, and link the
// driver account that will broadcast its location.
//
// A cab document:
//   { cabNumber, driverName, driverPhone, capacity, driverUid }
//   • capacity  — how many riders fit, so the desk can't overfill a carpool.
//   • driverUid — the driver ACCOUNT this cab follows. It is also the key the
//                 live-location feed uses (driverLocations/<uid>), so linking a
//                 driver here is what switches their tracking on.
//
// The link is two-sided and always written together:
//   cabs/<cabId>.driverUid  ←→  employees/<uid>.cabId
// A driver cannot write either side — `cabId` is what grants read access to that
// cab's riders (names and home addresses), so only the desk sets it.
//
// LINKING ALSO ISSUES THE DRIVER'S LOGIN CODE. A driver signs in with the last 4
// digits of their cab number plus their phone (utils/driverLogin.js), so the code
// is not a separate thing the desk maintains — it is a consequence of the link,
// and every function here that changes who drives what re-issues it. A driver who
// holds no cab holds no usable code.
//
// That re-issue cannot be part of the Firestore batch: it changes a Firebase Auth
// password, which is a sequence of network calls, not a document write. So it runs
// AFTER the link commits, and these functions report `codeWarning` when the link
// succeeded but the code did not follow. That is the honest failure to surface:
// the driver's previous code still works, and handing out the new one would lock
// them out.
// ---------------------------------------------------------------------------

import {
  collection, doc, addDoc, updateDoc, getDoc, onSnapshot, getDocs,
  query, where, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { DEFAULT_CAB_CAPACITY, STATUS } from '../data/mockData';
import { rotateDriverLoginCode } from './profile';
import { driverLoginCode, cabCodePart, unassignedLoginCode } from '../utils/driverLogin';

const COL = 'cabs';

// How many riders a cab seats. Cabs saved before `capacity` existed fall back to
// the fleet default rather than blocking every assignment.
export function cabCapacity(cab) {
  const n = Number(cab?.capacity);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAB_CAPACITY;
}

// Live list of all cabs. Calls cb with [{ id, cabNumber, driverName, ... }].
export function subscribeCabs(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    collection(firestore, COL),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// --- Login codes follow the link --------------------------------------------

// Re-issue ONE driver's login code: to match the cab number they now hold, or back
// to the unassigned value when they hold no cab (which is how a code is revoked —
// with no cab there is no last-4, so there is no code, and the app refuses
// anything shorter than a full one).
//
// Returns a message when it could not be done, rather than throwing: the link is
// already committed by the time this runs, so failing loudly would report a
// failure that did not happen. The caller shows the message.
async function reissueDriverCode(uid, cabNumber) {
  const snap = await getDoc(doc(firestore, 'employees', uid));
  if (!snap.exists()) return '';
  const driver = snap.data();
  if (driver.role !== 'driver') return ''; // not a code-based login
  const who = driver.name || 'That driver';

  let nextCode;
  if (cabNumber) {
    nextCode = driverLoginCode(cabNumber, driver.phone);
    if (!nextCode) {
      return cabCodePart(cabNumber)
        ? `${who} has no valid 10-digit phone number on file, so no login code could be created.`
        : `Cab ${cabNumber} has fewer than 4 digits in its number, so no login code could be created for ${who}.`;
    }
  } else {
    nextCode = unassignedLoginCode(driver.phone);
    if (!nextCode) return ''; // no valid phone → no account to revoke anything on
  }

  try {
    await rotateDriverLoginCode(uid, {
      phone: driver.phone,
      currentCode: driver.loginCode,
      nextCode,
    });
    return '';
  } catch (e) {
    console.warn('[cabs] could not re-issue login code:', e?.code, e?.message);
    return cabNumber
      ? `${who} is now on ${cabNumber}, but their login code could not be updated — their previous code still works. Press "Fix code" on their card in the Drivers tab.`
      : `${who} was unlinked, but their old login code could not be withdrawn. Press "Fix code" on their card in the Drivers tab.`;
  }
}

// Re-issue several drivers' codes one after another. Never in parallel: every
// rotation signs into the same throwaway secondary Firebase app, and overlapping
// sign-ins would race over that single session (the same reason
// adminInviteEmployees creates accounts one at a time).
async function reissueDriverCodes(jobs) {
  const problems = [];
  for (const { uid, cabNumber } of jobs) {
    const problem = await reissueDriverCode(uid, cabNumber);
    if (problem) problems.push(problem);
  }
  return problems.join(' ');
}

// --- Fleet CRUD (coordinator) -----------------------------------------------

// A cab record describes the VEHICLE only — its number and how many it seats.
// `driverName` / `driverPhone` are NOT typed in here: they are copied off the
// linked driver's account by linkCabDriver() below, so there is exactly one
// source for them. (They used to be form fields, which meant a name could be
// typed, saved, shown to riders, and then silently replaced the moment a real
// driver was linked — while granting that name's owner nothing at all.)
// Returns the new cab's id.
export async function addCab({ cabNumber, capacity }) {
  const ref = await addDoc(collection(firestore, COL), {
    cabNumber: (cabNumber || '').trim(),
    capacity: Number(capacity) || DEFAULT_CAB_CAPACITY,
    driverUid: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// Edit the vehicle. Deliberately does not mention the driver fields, so changing
// a cab's seat count can't wipe the linked driver's name off it.
//
// Renaming a cab changes its driver's LOGIN CODE, because the last 4 digits of the
// number are half of it. Missing that would leave the driver holding a code that
// silently stopped working — so the code is re-issued here too, and only when the
// number actually changed (saving the same form again must not churn it).
export async function updateCab(id, { cabNumber, capacity }) {
  const next = (cabNumber || '').trim();
  const before = await getDoc(doc(firestore, COL, id));
  const renamed = before.exists() && (before.data().cabNumber || '') !== next;
  const driverUid = before.exists() ? before.data().driverUid || null : null;

  await updateDoc(doc(firestore, COL, id), {
    cabNumber: next,
    capacity: Number(capacity) || DEFAULT_CAB_CAPACITY,
    updatedAt: serverTimestamp(),
  });

  const codeWarning =
    renamed && driverUid ? await reissueDriverCode(driverUid, next) : '';
  return { codeWarning };
}

// Point a cab at a driver account — or at nobody, when `driverUid` is null.
//
// Writes BOTH sides atomically, and releases whatever each side was holding
// before: a cab has one driver and a driver has one cab, so re-linking has to
// clear the previous pairing or the app ends up tracking a stale feed.
// Also copies the driver's name/phone onto the cab, so the name employees see is
// the person actually driving.
//
// Returns { codeWarning } — empty unless the link committed but a login code
// could not be re-issued afterwards.
export async function linkCabDriver(cabId, driverUid) {
  if (!firestore) throw new Error('Backend not configured.');

  let driver = {};
  if (driverUid) {
    const snap = await getDoc(doc(firestore, 'employees', driverUid));
    if (!snap.exists()) throw new Error('That driver account no longer exists.');
    driver = snap.data();
  }

  // Read for its NUMBER, which is half of the driver's login code. Also a
  // clearer refusal than the one the batch would produce for a cab that has been
  // deleted since the screen last rendered.
  const cabSnap = await getDoc(doc(firestore, COL, cabId));
  if (!cabSnap.exists()) throw new Error('That cab is no longer in the fleet.');
  const cabNumber = cabSnap.data().cabNumber || '';

  const batch = writeBatch(firestore);

  // Whoever currently holds this cab loses it.
  const holders = await getDocs(
    query(collection(firestore, 'employees'), where('cabId', '==', cabId))
  );
  const released = holders.docs.filter((d) => d.id !== driverUid);
  released.forEach((d) => batch.update(d.ref, { cabId: null }));

  // If this driver was on another cab, that cab loses its driver — but only if
  // that cab is still in the fleet. A driver whose profile points at a cab that
  // has since been removed is common (an old fleet cleared out), and
  // set(..., { merge: true }) on a MISSING document is a create, not an update:
  // the rules reject it for having no cab number, and the whole link failed with
  // nothing more informative than "Could not link that driver".
  if (driverUid && driver.cabId && driver.cabId !== cabId) {
    const previous = await getDoc(doc(firestore, COL, driver.cabId));
    if (previous.exists()) batch.update(previous.ref, { driverUid: null });
  }

  // update(), not set(merge) — a cab must already exist to be linked, and if it
  // doesn't, "no document to update" says so instead of failing a rule check.
  batch.update(
    doc(firestore, COL, cabId),
    driverUid
      ? { driverUid, driverName: driver.name || '', driverPhone: driver.phone || '' }
      : { driverUid: null }
  );
  if (driverUid) batch.update(doc(firestore, 'employees', driverUid), { cabId });

  await batch.commit();

  // The link is now the truth; make the codes match it. Everyone who just lost
  // this cab loses their code with it, and whoever gained it gets a new one.
  const codeWarning = await reissueDriverCodes([
    ...released.map((d) => ({ uid: d.id, cabNumber: null })),
    ...(driverUid ? [{ uid: driverUid, cabNumber }] : []),
  ]);
  return { codeWarning };
}

// --- Fleet oversight --------------------------------------------------------

// Take a vehicle out of the fleet, cleaning up everything that pointed at
// it — otherwise its driver keeps broadcasting for a cab that no longer exists
// and rides show a blank cab.
//
// Refuses while the cab still has upcoming rides: those riders would silently
// lose their cab, so the desk has to re-assign them first.
// Returns { ok, message?, blocking? }.
export async function removeCabSafely(id, todayKey) {
  if (!firestore) throw new Error('Backend not configured.');

  // Any upcoming, still-live ride on this cab?
  const rides = await getDocs(
    query(collection(firestore, 'bookings'), where('assignedCabId', '==', id))
  );
  const blocking = rides.docs
    .map((d) => d.data())
    .filter(
      (b) =>
        b.status !== STATUS.CANCELLED &&
        b.status !== STATUS.COMPLETED &&
        b.status !== STATUS.NO_SHOW &&
        (!todayKey || String(b.date || '') >= todayKey)
    );
  if (blocking.length) {
    return {
      ok: false,
      blocking: blocking.length,
      message: `This cab still has ${blocking.length} upcoming ride${
        blocking.length > 1 ? 's' : ''
      }. Re-assign them to another cab first.`,
    };
  }

  // Unlink any driver holding this cab, then delete it.
  const holders = await getDocs(
    query(collection(firestore, 'employees'), where('cabId', '==', id))
  );
  const batch = writeBatch(firestore);
  holders.docs.forEach((d) => batch.update(d.ref, { cabId: null }));
  batch.delete(doc(firestore, COL, id));
  await batch.commit();

  // The cab is gone, so its driver's login code has to go with it — otherwise a
  // code minted from a vehicle nobody owns any more keeps working.
  const codeWarning = await reissueDriverCodes(
    holders.docs.map((d) => ({ uid: d.id, cabNumber: null }))
  );
  return { ok: true, unlinkedDrivers: holders.size, codeWarning };
}

// Detach the driver from a cab without deleting the vehicle. Revokes their login
// code too, by way of linkCabDriver's own re-issue.
export function unlinkCabDriver(cabId) {
  return linkCabDriver(cabId, null);
}
