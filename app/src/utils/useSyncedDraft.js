// ---------------------------------------------------------------------------
// useSyncedDraft — an edit form over LIVE data.
//
// The admin screens seed a form from a Firestore subscription. Doing that with a
// plain useState initialiser captures whatever happened to be loaded at mount
// and never looks again, which caused two real problems:
//
//   • Manage Timings mounted before the config arrived, so the form held the
//     built-in defaults, counted itself as "edited", and Save quietly
//     overwrote the admin's real timings with the defaults.
//   • Two admins editing the same employee would each save over the other,
//     because neither form noticed the other's change.
//
// This hook keeps a draft, and RE-SEEDS it whenever the live value changes —
// but only while the user hasn't typed anything (`dirty` is false), so it never
// yanks away edits in progress. `dirty` is compared against the live value, so
// discarding an edit by hand also clears it.
//
//   const [draft, setDraft, { dirty, reset }] = useSyncedDraft(liveValue);
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from 'react';

// Cheap structural comparison — these drafts are small plain objects/arrays.
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function useSyncedDraft(source) {
  const [draft, setDraft] = useState(source);
  // The live value the current draft was seeded from, so we can tell an
  // incoming update apart from the user's own edits.
  const baseline = useRef(source);

  useEffect(() => {
    // Live data changed. Adopt it if the form is untouched; otherwise leave the
    // user's edits alone (their Save will win, and `dirty` stays true).
    if (same(baseline.current, source)) {
      baseline.current = source;
      return;
    }
    if (same(draft, baseline.current)) {
      baseline.current = source;
      setDraft(source);
    } else {
      // Keep the newest live value as the comparison point so `dirty` stays
      // meaningful even while the user is mid-edit.
      baseline.current = source;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(source)]);

  const reset = useCallback(() => {
    baseline.current = source;
    setDraft(source);
  }, [source]);

  return [draft, setDraft, { dirty: !same(draft, source), reset }];
}
