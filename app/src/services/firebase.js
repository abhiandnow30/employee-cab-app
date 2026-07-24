// ---------------------------------------------------------------------------
// FIREBASE CONFIG
// This connects the app to your Firebase project (our real-time backend).
//
// 👉 HOW TO FILL THIS IN:
//   1. Go to https://console.firebase.google.com/ and open (or create) a project.
//   2. Click the ⚙️ (Project settings) → "Your apps" → add a Web app (</> icon).
//   3. Firebase shows a "firebaseConfig" object — COPY its values in below.
//   4. Create a "Realtime Database" (left menu → Build → Realtime Database →
//      Create database → Start in TEST mode for now). Copy its URL into
//      databaseURL below (looks like https://YOUR-PROJECT-default-rtdb.firebaseio.com).
//
// NOTE: These values are NOT secret — Firebase web config is meant to live in
// client apps. What protects your data is the Realtime Database *rules*, which
// we'll tighten in Stage 4.
// ---------------------------------------------------------------------------

import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// Exported so we can spin up a SECONDARY Firebase app when the admin creates an
// employee login — that keeps the admin signed in on the primary app while the
// new account is provisioned on the secondary one.
export const firebaseConfig = {
  apiKey: 'AIzaSyAVOqkSyw71WtL3u91M-5QKGIQbDl83TKM',
  authDomain: 'cab-app-eec4c.firebaseapp.com',
  databaseURL: 'https://cab-app-eec4c-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'cab-app-eec4c',
  storageBucket: 'cab-app-eec4c.firebasestorage.app',
  messagingSenderId: '14672823860',
  appId: '1:14672823860:web:a20a6b918f6f05e2b86c61',
};

// Until you paste real values, `databaseURL` still starts with "PASTE_".
// In that case we DON'T initialize Firebase, so the rest of the app keeps
// running normally — only the tracking screens stay in "Waiting…" state.
export const isFirebaseConfigured = !firebaseConfig.databaseURL.startsWith('PASTE_');

let database = null;
let authInstance = null;
let firestoreInstance = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  database = getDatabase(app); // Realtime DB → live cab location
  authInstance = getAuth(app); // Authentication → login
  // Firestore → employees, bookings, etc. Force long-polling instead of the
  // streaming WebChannel: some corporate proxies / security extensions rewrite
  // the streaming response with a wildcard CORS header, which the browser then
  // blocks (credentials + '*' is illegal), leaving Firestore stuck offline.
  // Long-polling avoids that channel and connects reliably behind such networks.
  firestoreInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });
} else {
  console.warn(
    '[firebase] Not configured yet — fill in src/services/firebase.js to enable live tracking.'
  );
}

// The Realtime Database instance (null until configured) — used by the tracking service.
export const db = database;

// Authentication + Firestore instances (null until configured).
export const auth = authInstance;
export const firestore = firestoreInstance;
