// ---------------------------------------------------------------------------
// FEEDBACK SERVICE
// Writes employee feedback and ratings to Firestore ("feedback" / "ratings").
// ---------------------------------------------------------------------------

import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { firestore } from './firebase';

export async function addFeedbackDoc(data) {
  return addDoc(collection(firestore, 'feedback'), { ...data, createdAt: serverTimestamp() });
}

export async function addRatingDoc(data) {
  return addDoc(collection(firestore, 'ratings'), { ...data, createdAt: serverTimestamp() });
}
