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
// ---------------------------------------------------------------------------

import {
  collection, doc, addDoc, updateDoc, getDoc, onSnapshot, getDocs,
  query, where, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { DEFAULT_CAB_CAPACITY, STATUS } from '../data/mockData';

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
export function updateCab(id, { cabNumber, capacity }) {
  return updateDoc(doc(firestore, COL, id), {
    cabNumber: (cabNumber || '').trim(),
    capacity: Number(capacity) || DEFAULT_CAB_CAPACITY,
    updatedAt: serverTimestamp(),
  });
}

// Point a cab at a driver account — or at nobody, when `driverUid` is null.
//
// Writes BOTH sides atomically, and releases whatever each side was holding
// before: a cab has one driver and a driver has one cab, so re-linking has to
// clear the previous pairing or the app ends up tracking a stale feed.
// Also copies the driver's name/phone onto the cab, so the name employees see is
// the person actually driving.
export async function linkCabDriver(cabId, driverUid) {
  if (!firestore) throw new Error('Backend not configured.');

  let driver = {};
  if (driverUid) {
    const snap = await getDoc(doc(firestore, 'employees', driverUid));
    if (!snap.exists()) throw new Error('That driver account no longer exists.');
    driver = snap.data();
  }

  const batch = writeBatch(firestore);

  // Whoever currently holds this cab loses it.
  const holders = await getDocs(
    query(collection(firestore, 'employees'), where('cabId', '==', cabId))
  );
  holders.docs
    .filter((d) => d.id !== driverUid)
    .forEach((d) => batch.update(d.ref, { cabId: null }));

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

  return batch.commit();
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
  return { ok: true, unlinkedDrivers: holders.size };
}

// Detach the driver from a cab without deleting the vehicle.
export function unlinkCabDriver(cabId) {
  return linkCabDriver(cabId, null);
}
