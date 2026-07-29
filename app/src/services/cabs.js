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

export function addCab({ cabNumber, driverName, driverPhone, capacity }) {
  return addDoc(collection(firestore, COL), {
    cabNumber: (cabNumber || '').trim(),
    driverName: (driverName || '').trim(),
    driverPhone: (driverPhone || '').trim(),
    capacity: Number(capacity) || DEFAULT_CAB_CAPACITY,
    driverUid: null,
    createdAt: serverTimestamp(),
  });
}

export function updateCab(id, { cabNumber, driverName, driverPhone, capacity }) {
  return updateDoc(doc(firestore, COL, id), {
    cabNumber: (cabNumber || '').trim(),
    driverName: (driverName || '').trim(),
    driverPhone: (driverPhone || '').trim(),
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

  // If this driver was on another cab, that cab loses its driver.
  if (driverUid && driver.cabId && driver.cabId !== cabId) {
    batch.set(doc(firestore, COL, driver.cabId), { driverUid: null }, { merge: true });
  }

  batch.set(
    doc(firestore, COL, cabId),
    driverUid
      ? { driverUid, driverName: driver.name || '', driverPhone: driver.phone || '' }
      : { driverUid: null },
    { merge: true }
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
