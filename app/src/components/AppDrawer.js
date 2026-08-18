// ---------------------------------------------------------------------------
// AppDrawer — the navigation menu for employees.
// Two modes:
//   • overlay   (phones / narrow web): slides in over the page when ☰ is tapped,
//     with a dark backdrop and a close (✕). Rendered in a Portal.
//   • permanent (wide web): a fixed left sidebar that's always visible, with the
//     current screen highlighted. No backdrop, no close button.
// Layout: company brand at top, nav items in the middle, and the signed-in
// employee at the BOTTOM — showing just the name, which expands on tap to reveal
// Employee ID, email, and a "Change password" action.
//
// EXCEPT FOR DRIVERS AND COORDINATORS, who get neither: they sign in with a code
// the desk issues, so they have no password of their own and no real email
// address. See the comment in UserCard for why offering "Change password" to
// either would lock them out permanently rather than merely being useless.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Image, Pressable, ScrollView } from 'react-native';
import {
  Portal, Text, Dialog, TextInput, Button, HelperText,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COMPANY_NAME, companyLogo } from '../branding';
import { colors } from '../theme';

// Each menu item → which screen it opens.
//
// My Shift Calendar, Change Request and Feedback are deliberately NOT here: the
// Home screen already puts them front and centre as tiles, and listing them in
// both places made the menu longer without making anything reachable that wasn't
// already one tap away. Home is the first item, so the tiles are never far.
// Appended to the employee menu ONLY while it means something: someone with no
// address/route yet, or with a request still in flight. A fully set-up rider has
// nothing to do here, so it isn't a permanent row.
export const CAB_SERVICE_ITEM = {
  label: 'Cab Service', icon: 'car-clock', screen: 'CabServiceRequest',
};

export const DRAWER_ITEMS = [
  { label: 'Home', icon: 'home', screen: 'EmployeeHome' },
  { label: 'Profile', icon: 'account', screen: 'Profile' },
  { label: 'My Rides', icon: 'calendar-search', screen: 'MyRides' },
  { label: 'Notifications', icon: 'bell', screen: 'Notifications' },
  { label: 'Ride History', icon: 'history', screen: 'RosterHistory' },
  { label: 'Track Cab', icon: 'map-marker-radius', screen: 'TrackCab' },
  { label: 'Rate Us', icon: 'star', screen: 'RateUs' },
];

// Driver menu. Drivers had no drawer at all, which left their Profile screen
// registered but unreachable — the only navigation they had was the back arrow.
export const DRIVER_DRAWER_ITEMS = [
  { label: 'My Trips', icon: 'car-clock', screen: 'DriverHome' },
  { label: 'Share Location', icon: 'crosshairs-gps', screen: 'DriverShareLocation' },
  { label: 'Profile', icon: 'account', screen: 'Profile' },
];

// Admin (transport desk) menu — the actions that used to be top buttons.
// HR / Admin owns the SOURCE DATA and the policy: the monthly roster, who exists,
// what the shifts mean, and the reporting. Day-to-day cab assignment is the
// coordinator's job and deliberately absent here.
export const ADMIN_DRAWER_ITEMS = [
  { label: 'Upload Roster', icon: 'file-upload-outline', screen: 'RosterUpload' },
  { label: 'Shift Timings', icon: 'clock-edit-outline', screen: 'ShiftPolicy' },
  { label: 'Employees', icon: 'account-cog', screen: 'EmployeeManagement' },
  // The transport desk itself. Its own screen rather than a role toggle inside
  // Add Employee: a coordinator is an account but not a rider, so none of the
  // rider fields on that form apply to them.
  { label: 'Coordinators', icon: 'headset', screen: 'ManageCoordinators' },
  // No "Exception Approvals" here. Nothing routes to HR any more: the company runs
  // two scheduled rides and nothing else, so the requests that needed HR's
  // sign-off (a cab after an extended shift, an emergency ride) no longer exist.
  // What remains — leave, absent, drop a ride, shift changed — only ever cancels or
  // re-codes a ride, which is the coordinator's job as they run the day.
  { label: 'Address Requests', icon: 'home-edit', screen: 'AddressRequests' },
  // People who signed in with their company account but were never entered by
  // HR, so they have no address or route and no cab can be sent for them. HR
  // approves; the coordinator sets the route (same screen, see its header).
  { label: 'Cab Requests', icon: 'car-clock', screen: 'CabRequests' },
  // WHERE "ALL BOOKINGS" USED TO BE. HR gets the day board here instead — the same
  // screen the coordinator runs on, and the one place "Add a rider" exists, which is
  // what HR actually needs: the monthly sheet always misses somebody (a mid-month
  // joiner, someone who turns out to need a cab) and HR is usually who hears about
  // it. Adding them writes the roster day, so the rider appears on the coordinator's
  // board with no re-upload. HR needn't assign the cab — the rider shows as Waiting.
  //
  // The Bookings screen is NOT deleted: it is still registered for both desk roles
  // in App.js and still in the coordinator's menu. Two things live only there, so if
  // HR ever needs them again this is the line to restore: approving/rejecting a
  // rider's cancellation REQUEST, and the by-cab view of the last 180 days.
  { label: "Today's Rides", icon: 'view-dashboard', screen: 'CoordinatorHome' },
  // HR needs to SEE who is driving what — which cab a ride was given to, and which
  // driver account is behind it — without owning the fleet. These two screens
  // render read-only for the admin role; the coordinator keeps the controls.
  { label: 'Cabs & Drivers', icon: 'car-multiple', screen: 'ManageFleet' },
  { label: 'Live Tracking', icon: 'map-marker-radius', screen: 'TrackCabs' },
  // No "Cab Routes" screen. The route list is no longer edited in the app: the
  // monthly sheet carries a Route column, and the names it may use are the fixed
  // list in data/mockData.js (CAB_ROUTES). canonicalRoute() still snaps a sheet
  // spelling onto that list and still REFUSES anything not on it — so adding a
  // new pickup area is now a code change, deliberately, rather than a field
  // anyone can type into and split a carpool across two spellings.
  { label: 'Cancelled Rides', icon: 'car-off', screen: 'CancelledRides' },
  { label: 'No-Shows', icon: 'account-alert', screen: 'NoShows' },
  { label: 'Feedback & Ratings', icon: 'message-star', screen: 'FeedbackInbox' },
];

// The COORDINATOR runs the day: turn the roster into assigned cabs, watch the
// trips, keep the fleet current. No roster upload, no policy, no employee
// records.
export const COORDINATOR_DRAWER_ITEMS = [
  { label: "Today's Rides", icon: 'view-dashboard', screen: 'CoordinatorHome' },
  { label: 'Requests', icon: 'clipboard-list-outline', screen: 'Requests' },
  // The coordinator is who knows which route an address is on, so they triage
  // these even though HR does the approving.
  { label: 'Cab Requests', icon: 'car-clock', screen: 'CabRequests' },
  { label: 'All Bookings', icon: 'view-list', screen: 'Bookings' },
  { label: 'Cabs & Drivers', icon: 'car-multiple', screen: 'ManageFleet' },
  { label: 'Live Tracking', icon: 'map-marker-radius', screen: 'TrackCabs' },
  { label: 'Messages', icon: 'email-outline', screen: 'Messages' },
  { label: 'No-Shows', icon: 'account-alert', screen: 'NoShows' },
];

const EMPTY_PW = { current: '', next: '', confirm: '' };

// The change-password dialog, shown from the user card.
function ChangePasswordDialog({ visible, onDismiss, onChangePassword }) {
  const [form, setForm] = useState(EMPTY_PW);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setForm(EMPTY_PW);
    setError('');
    setOk('');
    setBusy(false);
  }
  function close() {
    reset();
    onDismiss();
  }

  async function submit() {
    setError('');
    setOk('');
    if (!form.current || !form.next) {
      setError('Please fill in all fields.');
      return;
    }
    if (form.next.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (form.next !== form.confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await onChangePassword(form.current, form.next);
    setBusy(false);
    if (res?.ok) {
      setOk('Password changed ✓');
      setForm(EMPTY_PW);
    } else {
      setError(res?.message || 'Could not change password.');
    }
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={close} style={styles.pwDialog}>
        <Dialog.Title>Change password</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="Current password"
            value={form.current}
            onChangeText={(t) => setForm((f) => ({ ...f, current: t }))}
            mode="outlined"
            secureTextEntry
            dense
            style={styles.pwInput}
          />
          <TextInput
            label="New password"
            value={form.next}
            onChangeText={(t) => setForm((f) => ({ ...f, next: t }))}
            mode="outlined"
            secureTextEntry
            dense
            style={styles.pwInput}
          />
          <TextInput
            label="Confirm new password"
            value={form.confirm}
            onChangeText={(t) => setForm((f) => ({ ...f, confirm: t }))}
            mode="outlined"
            secureTextEntry
            dense
            style={styles.pwInput}
          />
          {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          {ok ? <HelperText type="info" visible>{ok}</HelperText> : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={close}>Close</Button>
          <Button onPress={submit} loading={busy} disabled={busy}>Save</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

// Friendly label for a role.
const ROLE_LABEL = {
  admin: 'HR / Admin',
  coordinator: 'Transport Coordinator',
  driver: 'Driver',
  employee: 'Employee',
};

// The signed-in user card at the bottom: name + role, expands on tap.
// Logout lives HERE, inside the expanded panel — not as a nav row and not in
// the header. Signing out is an account action, so it belongs with the account,
// alongside Change password, rather than sitting in the list of places to go.
function UserCard({ user, onChangePassword, onLogout }) {
  const [expanded, setExpanded] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const u = user || {};
  const roleLabel = ROLE_LABEL[u.role] || 'Employee';

  // NEITHER A DRIVER NOR A COORDINATOR HAS A PASSWORD OF THEIR OWN, so this card
  // must not offer to change one. It isn't merely a pointless row: their Firebase
  // password IS the code the desk issued them, so changing it would succeed and
  // leave them holding a secret their login screen cannot accept — a driver's
  // takes 14 digits and nothing else, a coordinator's takes a phone plus the
  // 4-digit passcode — locking them out for good.
  //
  // The two differ in how recoverable that is, and both are bad. A driver's code
  // is derived from cab + phone, so it can at least be recomputed; a
  // coordinator's passcode is random and mirrored only on their profile, so a
  // password changed out from under it could not be recovered at all — the
  // account would be scrap.
  //
  // Their email is hidden for the same family of reasons: it is synthesized on
  // an unroutable domain (see utils/driverLogin.js and utils/coordinatorLogin.js),
  // so showing it only invites someone to write to it — and for a coordinator it
  // also displays, to them, half of a credential they are supposed to think of as
  // "my phone number". The phone is the identity that actually means something.
  //
  // The phone shows for EVERY role that has one. It used to be driver-only, which
  // left the desk's own card showing an ID and an email and no way to check the
  // number riders are told to call — the one thing on the card someone else has
  // to dial. A blank `phone` simply omits the row, same as before.
  const isCodeUser = u.role === 'driver' || u.role === 'coordinator';
  const showEmail = !!u.email && !isCodeUser;
  const showPhone = !!u.phone;
  const hasMeta = !!u.empId || showEmail || showPhone;

  return (
    <View style={styles.userBox}>
      {/* Expanded details appear ABOVE the name (since the card sits at the
          bottom of the sidebar, details open upward).

          Every row here — meta, action, profile — uses the SAME 30px icon
          column as the nav items above, so all the text in the sidebar lines up
          on one edge instead of the account block sitting at its own indent. */}
      {expanded ? (
        <View style={styles.userDetails}>
          {u.empId ? (
            <View style={styles.metaRow}>
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={18}
                color="#D6E4FF"
                style={styles.rowIcon}
              />
              <Text style={styles.userMeta} numberOfLines={1}>
                Employee ID: {u.empId}
              </Text>
            </View>
          ) : null}
          {showEmail ? (
            <View style={styles.metaRow}>
              <MaterialCommunityIcons
                name="email-outline"
                size={18}
                color="#D6E4FF"
                style={styles.rowIcon}
              />
              {/* Left to wrap rather than truncated — a half-shown address is
                  no use to someone checking which account they're signed into. */}
              <Text style={styles.userMeta}>{u.email}</Text>
            </View>
          ) : null}
          {showPhone ? (
            <View style={styles.metaRow}>
              <MaterialCommunityIcons
                name="phone-outline"
                size={18}
                color="#D6E4FF"
                style={styles.rowIcon}
              />
              <Text style={styles.userMeta}>{u.phone}</Text>
            </View>
          ) : null}

          {/* Hairline between what the rows SAY and what they DO, so the tappable
              rows below read as actions rather than more detail. */}
          {hasMeta ? <View style={styles.detailDivider} /> : null}

          {/* Both actions share one row shape — same gutter, size and weight —
              so neither looks like the odd one out. */}
          {isCodeUser ? null : (
            <Pressable
              style={styles.accountAction}
              onPress={() => setPwOpen(true)}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
            >
              <MaterialCommunityIcons
                name="lock-reset"
                size={20}
                color="#FFFFFF"
                style={styles.rowIcon}
              />
              <Text style={styles.accountActionText}>Change password</Text>
            </Pressable>
          )}

          {onLogout ? (
            <Pressable
              style={styles.accountAction}
              onPress={onLogout}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
            >
              <MaterialCommunityIcons
                name="logout"
                size={20}
                color="#FFFFFF"
                style={styles.rowIcon}
              />
              <Text style={styles.accountActionText}>Logout</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Name + role row — tap to expand/collapse the details above. */}
      <Pressable style={styles.userTop} onPress={() => setExpanded((e) => !e)}>
        <MaterialCommunityIcons
          name="account-circle"
          size={24}
          color="#FFFFFF"
          style={styles.rowIcon}
        />
        <View style={styles.userNameCol}>
          {/* Admins show just "Admin" (no account name / second line);
              other roles show their name with the role beneath it. */}
          <Text style={styles.userName} numberOfLines={1}>
            {u.role === 'admin' ? roleLabel : u.name || roleLabel}
          </Text>
          {u.role !== 'admin' ? (
            <Text style={styles.userRole} numberOfLines={1}>
              {roleLabel}
            </Text>
          ) : null}
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-down' : 'chevron-up'}
          size={20}
          color="#FFFFFF"
        />
      </Pressable>

      {/* Not mounted at all for a code-based login, so there is no path to it even
          if the row above were ever restored by accident. */}
      {isCodeUser ? null : (
        <ChangePasswordDialog
          visible={pwOpen}
          onDismiss={() => setPwOpen(false)}
          onChangePassword={onChangePassword}
        />
      )}
    </View>
  );
}

// The brand strip + nav list + user card. Shared by both modes.
// `counts` is { [screenName]: number } — how much is waiting on this person for
// that screen. Rendered as a pill on the row, because a desk queue that only
// announces itself once you open it is a queue that gets left.
function DrawerBody({
  user, items = DRAWER_ITEMS, onNavigate, onClose, onChangePassword, onLogout,
  activeScreen, permanent, counts = {},
}) {
  return (
    <View style={styles.body}>
      {/* Company brand: logo + name on a white strip at the very top */}
      <View style={styles.brandBar}>
        <Image source={companyLogo} style={styles.brandLogo} resizeMode="contain" />
        <Text style={styles.brandName} numberOfLines={1}>
          {COMPANY_NAME}
        </Text>
        {!permanent ? (
          <Pressable onPress={onClose} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={22} color={colors.primaryDark} />
          </Pressable>
        ) : null}
      </View>

      {/* Menu items (fills the space between brand and the user card) */}
      <ScrollView style={styles.menu}>
        {items.map((item) => {
          const active = item.screen === activeScreen;
          const waiting = counts[item.screen] || 0;
          return (
            <Pressable
              key={item.label}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => onNavigate(item)}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
              accessibilityLabel={
                waiting ? `${item.label}, ${waiting} waiting` : item.label
              }
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={20}
                color="#FFFFFF"
                style={styles.itemIcon}
              />
              <Text style={[styles.itemText, active && styles.itemTextActive]}>
                {item.label}
              </Text>
              {waiting ? (
                <View style={styles.countPill}>
                  <Text style={styles.countText}>{waiting > 99 ? '99+' : waiting}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        {/* Nav is places to GO only. Logout is an account action and lives in
            the profile card below — it was a row here, which put it in the same
            list as the screens and gave the sidebar two kinds of thing. */}
      </ScrollView>

      {/* Signed-in user — at the bottom. Carries the app's ONLY logout. */}
      <UserCard user={user} onChangePassword={onChangePassword} onLogout={onLogout} />
    </View>
  );
}

export default function AppDrawer({
  visible,
  onClose,
  user,
  items,
  onNavigate,
  onChangePassword,
  onLogout,
  activeScreen,
  counts,
  permanent = false,
}) {
  // Permanent sidebar: a static left column, always on screen.
  if (permanent) {
    return (
      <View style={styles.permanentPanel}>
        <DrawerBody
          user={user}
          items={items}
          onNavigate={onNavigate}
          onChangePassword={onChangePassword}
          onLogout={onLogout}
          activeScreen={activeScreen}
          counts={counts}
          permanent
        />
      </View>
    );
  }

  // Overlay drawer: only rendered while open.
  if (!visible) return null;
  return (
    <Portal>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <DrawerBody
            user={user}
            items={items}
            onNavigate={onNavigate}
            onChangePassword={onChangePassword}
            onLogout={onLogout}
            onClose={onClose}
            activeScreen={activeScreen}
            counts={counts}
          />
        </View>
        {/* Tapping outside the panel closes it */}
        <Pressable style={styles.backdrop} onPress={onClose} />
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  panel: {
    width: '78%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: colors.primaryDark,
  },
  permanentPanel: {
    width: 250,
    height: '100%',
    backgroundColor: colors.primaryDark,
  },
  body: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  // White brand band lifted toward the top; the nav starts lower (menu has its
  // own top padding) so there's clear separation between brand and menu.
  brandBar: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20, // matches the nav items below
    paddingBottom: 8, // minimal white below the logo before the blue menu
    paddingTop: 24, // enough to clear the status bar, but tighter to the top
  },
  // Logo sized to its true aspect (≈106:119) and left-aligned so its left edge
  // sits at 20px like the nav icons; the 3px margin makes the column total 30px
  // so the brand name lands at 50px — exactly under the menu labels below.
  brandLogo: { width: 27, height: 30, marginRight: 3 },
  brandName: { color: colors.primaryDark, fontWeight: 'bold', fontSize: 16, flex: 1 },
  menu: { flex: 1 }, // nav sits right below the brand band
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  itemActive: { backgroundColor: colors.primary }, // highlight current screen
  itemIcon: { width: 30 },
  itemText: { color: '#FFFFFF', fontSize: 16, flex: 1 },
  itemTextActive: { fontWeight: 'bold' },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: colors.primaryDark, fontSize: 12, fontWeight: 'bold' },
  // Account block. paddingHorizontal matches `item` above (20) so the icon
  // column starts on the same edge as every nav row; paddingVertical is kept
  // tight so the collapsed card is a slim strip rather than a deep footer.
  userBox: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  // The shared 30px icon gutter — same width as `itemIcon`, so meta text,
  // "Change password" and the profile name all begin at the same x as the nav
  // labels. Changing one of these without the other is what made the block
  // look bolted on.
  rowIcon: { width: 30 },
  userTop: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  userNameCol: { flex: 1 },
  userName: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  userRole: { color: '#E3F0FF', fontSize: 12, marginTop: 1 },
  // Hairline separating the details from the profile row, so the expanded card
  // reads as two grouped parts instead of one long list.
  userDetails: {
    paddingBottom: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.18)',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  userMeta: { color: '#E3F0FF', fontSize: 13, flex: 1 },
  // Separates the read-only meta rows from the tappable ones below.
  detailDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginTop: 6,
    marginBottom: 2,
  },
  // Shared by Change password and Logout — one shape for both, so the account
  // panel doesn't invent a second row style for its second action.
  accountAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  accountActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', flex: 1 },
  pwInput: { marginBottom: 10 },
  pwDialog: { width: '100%', maxWidth: 400, alignSelf: 'center' },
});
