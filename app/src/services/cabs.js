// ---------------------------------------------------------------------------
// CABS SERVICE
// The company fleet lives in the Firestore "cabs" collection so the admin can
// add / edit / remove cabs. Every screen that needs the cab list (assign
// dialog, Manage Drivers, Track Cab) reads it live from here.
//
// A cab document:
//   { cabNumber, driverName, driverPhone, capacity, driverUid }
//   • capacity  — how many riders fit, so the desk can't overfill a carpool.
//   • driverUid — the driver ACCOUNT linked to this cab (set from Manage
//                 Drivers). It's how the app finds the cab's live-location feed,
//                 which is keyed by driver uid. driverName/driverPhone are kept
//                 in step with that account.
//
// The 3 starter cabs keep their original ids (c1/c2/c3) so any existing
// bookings/driver links that reference them stay valid.
// ---------------------------------------------------------------------------

import {
  collection, doc, addDoc, updateDoc, setDoc, onSnapshot, getDocs,
  query, where, writeBatch,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { cabs as DEFAULT_CABS, DEFAULT_CAB_CAPACITY, STATUS } from '../data/mockData';

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

export function addCab({ cabNumber, driverName, driverPhone, capacity }) {
  return addDoc(collection(firestore, COL), {
    cabNumber: (cabNumber || '').trim(),
    driverName: (driverName || '').trim(),
    driverPhone: (driverPhone || '').trim(),
    capacity: Number(capacity) || DEFAULT_CAB_CAPACITY,
    driverUid: null,
  });
}

export function updateCab(id, data) {
  const fields = { ...data };
  if ('capacity' in fields) fields.capacity = Number(fields.capacity) || DEFAULT_CAB_CAPACITY;
  return updateDoc(doc(firestore, COL, id), fields);
}

// Remove a cab, cleaning up everything that pointed at it — otherwise the fleet
// loses the cab but its driver keeps broadcasting for a cab that no longer
// exists, and rides show a blank cab.
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

// One-time: create the 3 starter cabs (with their original ids) if the fleet
// is empty. Lets the admin start from the familiar demo cabs and edit from
// there. Uses merge so re-running it can never wipe edits the admin has made.
export function seedDefaultCabs() {
  return Promise.all(
    DEFAULT_CABS.map((c) =>
      setDoc(
        doc(firestore, COL, c.id),
        {
          cabNumber: c.cabNumber,
          driverName: c.driverName,
          driverPhone: c.driverPhone,
          capacity: c.capacity || DEFAULT_CAB_CAPACITY,
        },
        { merge: true }
      )
    )
  );
}
