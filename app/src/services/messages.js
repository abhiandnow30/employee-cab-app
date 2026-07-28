// ---------------------------------------------------------------------------
// MESSAGES SERVICE
// Employees can text the transport desk (admin) with a request or question from
// the Contact Us screen. Messages live in Firestore at messages/<id>.
//   • Employee → createMessage()
//   • Admin    → subscribeAllMessages() (read-only inbox)
// Security rules let an employee create/read only their OWN messages, and only
// an admin read all of them.
// ---------------------------------------------------------------------------

import { collection, addDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';
import { firestore } from './firebase';

// Employee sends a message/request to the transport desk.
export async function createMessage(data) {
  if (!firestore) throw new Error('Backend not configured.');
  return addDoc(collection(firestore, 'messages'), {
    employeeId: data.employeeId,
    employeeName: data.employeeName || '',
    message: data.message,
    createdAt: serverTimestamp(),
  });
}

// Newest first; pending local writes (no server timestamp yet) sort as newest.
function byNewest(a, b) {
  const ta = a.createdAt?.seconds ?? Infinity;
  const tb = b.createdAt?.seconds ?? Infinity;
  return tb - ta;
}

function toList(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest);
}

// Admin: live list of ALL messages (admin only — enforced by rules).
export function subscribeAllMessages(cb, onError) {
  if (!firestore) {
    cb([]);
    return () => {};
  }
  return onSnapshot(collection(firestore, 'messages'), (snap) => cb(toList(snap)), onError);
}

// Employee: live list of only MY messages.
export function subscribeMyMessages(employeeId, cb, onError) {
  if (!firestore || !employeeId) {
    cb([]);
    return () => {};
  }
  const q = query(collection(firestore, 'messages'), where('employeeId', '==', employeeId));
  return onSnapshot(q, (snap) => cb(toList(snap)), onError);
}
