# Deployment log — employee-cab-app (dev)

Every dev deploy appends here. Written by `/deploy` (see
`.claude/commands/deploy.md`). Dev only — this repo has no staging or production
deploy path.

Format:

```
## <ISO timestamp> — dev-<sha>
- Environment: dev
- Firebase target: <separate project | preview channel> / <id>
- Deployed: <hosting,functions,firestore,database>
- Deployer: <git config user.name>
- Result: success / failed / rolled back
- Commit: <sha> — "<message>"
- Pipeline: <GitHub Actions run URL>
```

Note on "rolled back": only Firebase **Hosting** can be rolled back automatically
(from the `dev-previous` snapshot taken before each deploy). Cloud Functions,
Firestore rules/indexes and Realtime Database rules have no automatic rollback —
recovery is re-deploying a known-good tag. An entry saying "rolled back" refers
to Hosting unless it says otherwise.

---

<!-- deploy entries are appended below this line -->

## 2026-08-13T23:15+05:30 — dev-68bae15 (working tree, uncommitted)
- Environment: dev
- Firebase target: existing project / cab-app-eec4c
- Deployed: firestore (rules), hosting
- Deployer: abhiandnow30
- Result: success
- Commit: 68bae15 — "fixed signin for drivers"
- Pipeline: none — deployed by hand with `firebase deploy`, not via `/deploy`

**Deployed from a DIRTY working tree.** 10 modified files plus 3 new ones were
uncommitted at deploy time, so `68bae15` does NOT describe what is live and this
release cannot be reproduced from the sha alone. Commit before the next deploy.

Contents: the ride-start OTP. A six-digit code is issued to each rider in the same
write that assigns their cab, stored at `bookings/<id>/private/otp` where the
driver cannot read it, and checked in `firestore.rules` on the way into the new
`On board` status — which is now the only route to `Completed`.

Order was rules first, then hosting: the client's new write to the `private`
subcollection would have been denied by the old rules, failing every cab
assignment. Safe to do at 23:09 only because no cab had been assigned that day —
otherwise a driver mid-trip on the old bundle would have been unable to complete
their ride.

Rollback: `git checkout firestore.rules` and redeploy for the rules; Hosting via
`firebase hosting:clone` or the console's release history.
