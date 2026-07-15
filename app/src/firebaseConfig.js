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

const firebaseConfig = {
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
if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  database = getDatabase(app);
} else {
  console.warn(
    '[firebase] Not configured yet — fill in src/firebaseConfig.js to enable live tracking.'
  );
}

// The Realtime Database instance (null until configured) — used by the tracking service.
export const db = database;
