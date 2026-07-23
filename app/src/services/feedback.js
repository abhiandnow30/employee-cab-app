// ---------------------------------------------------------------------------
// FEEDBACK SERVICE
// Writes employee feedback and ratings to Firestore ("feedback" / "ratings").
// ---------------------------------------------------------------------------

import { collection, addDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { firestore } from './firebase';

export async function addFeedbackDoc(data) {
  return addDoc(collection(firestore, 'feedback'), { ...data, createdAt: serverTimestamp() });
}

export async function addRatingDoc(data) {
  return addDoc(collection(firestore, 'ratings'), { ...data, createdAt: serverTimestamp() });
}

// Newest first. Pending local writes have no server timestamp yet, so treat
// those as newest (mirrors the bookings service ordering).
function byNewest(a, b) {
  const ta = a.createdAt?.seconds ?? Infinity;
  const tb = b.createdAt?.seconds ?? Infinity;
  return tb - ta;
}

function toList(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest);
}

// Live list of all feedback (admin only — enforced by Firestore rules).
// Calls cb with [{ id, employeeName, category, message, createdAt }]. Returns
// an unsubscribe function.
export function subscribeFeedback(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(collection(firestore, 'feedback'), (snap) => cb(toList(snap)), onError);
}

// Live list of all ratings (admin only). Calls cb with
// [{ id, employeeName, stars, comment, createdAt }]. Returns an unsubscribe fn.
export function subscribeRatings(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(collection(firestore, 'ratings'), (snap) => cb(toList(snap)), onError);
}
