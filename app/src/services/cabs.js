// ---------------------------------------------------------------------------
// CABS SERVICE
// The company fleet lives in the Firestore "cabs" collection so the admin can
// add / edit / remove cabs. Every screen that needs the cab list (assign
// dialog, Manage Drivers, Track Cab) reads it live from here.
//
// The 3 starter cabs keep their original ids (c1/c2/c3) so any existing
// bookings/driver links that reference them stay valid.
// ---------------------------------------------------------------------------

import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot,
} from 'firebase/firestore';
import { firestore } from './firebase';
import { cabs as DEFAULT_CABS } from '../data/mockData';

const COL = 'cabs';

// Live list of all cabs. Calls cb with [{ id, cabNumber, driverName, driverPhone }].
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

export function addCab({ cabNumber, driverName, driverPhone }) {
  return addDoc(collection(firestore, COL), {
    cabNumber: (cabNumber || '').trim(),
    driverName: (driverName || '').trim(),
    driverPhone: (driverPhone || '').trim(),
  });
}

export function updateCab(id, data) {
  return updateDoc(doc(firestore, COL, id), data);
}

export function removeCab(id) {
  return deleteDoc(doc(firestore, COL, id));
}

// One-time: create the 3 starter cabs (with their original ids) if the fleet
// is empty. Lets the admin start from the familiar demo cabs and edit from there.
export function seedDefaultCabs() {
  return Promise.all(
    DEFAULT_CABS.map((c) =>
      setDoc(doc(firestore, COL, c.id), {
        cabNumber: c.cabNumber,
        driverName: c.driverName,
        driverPhone: c.driverPhone,
      })
    )
  );
}
