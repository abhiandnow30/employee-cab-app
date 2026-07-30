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
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, Image, Pressable, ScrollView } from 'react-native';
import {
  Portal, Text, Dialog, TextInput, Button, HelperText,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COMPANY_NAME, companyLogo } from '../branding';

// Each menu item → which screen it opens.
//
// My Shift Calendar, Change Request and Feedback are deliberately NOT here: the
// Home screen already puts them front and centre as tiles, and listing them in
// both places made the menu longer without making anything reachable that wasn't
// already one tap away. Home is the first item, so the tiles are never far.
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
  { label: 'Shift Policy', icon: 'clock-edit-outline', screen: 'ShiftPolicy' },
  { label: 'Employees', icon: 'account-cog', screen: 'EmployeeManagement' },
  // No "Exception Approvals" here. Nothing routes to HR any more: the company runs
  // two scheduled rides and nothing else, so the requests that needed HR's
  // sign-off (a cab after an extended shift, an emergency ride) no longer exist.
  // What remains — leave, absent, drop a ride, shift changed — only ever cancels or
  // re-codes a ride, which is the coordinator's job as they run the day.
  { label: 'Address Requests', icon: 'home-edit', screen: 'AddressRequests' },
  { label: 'All Bookings', icon: 'view-list', screen: 'Bookings' },
  // HR needs to SEE who is driving what — which cab a ride was given to, and which
  // driver account is behind it — without owning the fleet. These three screens
  // render read-only for the admin role; the coordinator keeps the controls.
  { label: 'Drivers', icon: 'account-tie-hat', screen: 'ManageDrivers' },
  { label: 'Fleet', icon: 'car-multiple', screen: 'ManageCabs' },
  { label: 'Live Tracking', icon: 'map-marker-radius', screen: 'TrackCabs' },
  { label: 'Routes & Timings', icon: 'map-marker-path', screen: 'ManageTimings' },
  { label: 'Cancelled Rides', icon: 'car-off', screen: 'CancelledRides' },
  { label: 'No-Shows', icon: 'account-alert', screen: 'NoShows' },
  { label: 'Feedback & Ratings', icon: 'message-star', screen: 'FeedbackInbox' },
];

// The COORDINATOR runs the day: turn the roster into assigned cabs, watch the
// trips, keep the fleet current. No roster upload, no policy, no employee
// records.
export const COORDINATOR_DRAWER_ITEMS = [
  { label: "Today's Rides", icon: 'view-dashboard', screen: 'CoordinatorHome' },
  { label: 'Change Requests', icon: 'clipboard-list-outline', screen: 'ChangeRequests' },
  { label: 'All Bookings', icon: 'view-list', screen: 'Bookings' },
  { label: 'Fleet', icon: 'car-multiple', screen: 'ManageCabs' },
  { label: 'Drivers', icon: 'account-tie-hat', screen: 'ManageDrivers' },
  { label: 'Live Tracking', icon: 'map-marker-radius', screen: 'TrackCabs' },
  { label: 'Messages', icon: 'email-outline', screen: 'Messages' },
  { label: 'Cancelled Rides', icon: 'car-off', screen: 'CancelledRides' },
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
function UserCard({ user, onChangePassword }) {
  const [expanded, setExpanded] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const u = user || {};
  const roleLabel = ROLE_LABEL[u.role] || 'Employee';

  return (
    <View style={styles.userBox}>
      {/* Expanded details appear ABOVE the name (since the card sits at the
          bottom of the sidebar, details open upward). */}
      {expanded ? (
        <View style={styles.userDetails}>
          {u.empId ? (
            <Text style={styles.userMeta}>Employee ID: {u.empId}</Text>
          ) : null}
          {u.email ? (
            <Text style={styles.userMeta}>{u.email}</Text>
          ) : null}
          <Pressable style={styles.changePw} onPress={() => setPwOpen(true)}>
            <MaterialCommunityIcons name="lock-reset" size={18} color="#FFFFFF" />
            <Text style={styles.changePwText}>Change password</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Name + role row — tap to expand/collapse the details above. */}
      <Pressable style={styles.userTop} onPress={() => setExpanded((e) => !e)}>
        <MaterialCommunityIcons name="account-circle" size={32} color="#FFFFFF" />
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
          size={22}
          color="#FFFFFF"
        />
      </Pressable>

      <ChangePasswordDialog
        visible={pwOpen}
        onDismiss={() => setPwOpen(false)}
        onChangePassword={onChangePassword}
      />
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
            <MaterialCommunityIcons name="close" size={22} color="#0D47A1" />
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

        {/* Logout — shown when a handler is provided (admin sidebar). */}
        {onLogout ? (
          <Pressable
            style={[styles.item, styles.logoutItem]}
            onPress={onLogout}
            android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
          >
            <MaterialCommunityIcons name="logout" size={20} color="#FFFFFF" style={styles.itemIcon} />
            <Text style={styles.itemText}>Logout</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Signed-in user — at the bottom */}
      <UserCard user={user} onChangePassword={onChangePassword} />
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
    backgroundColor: '#0D47A1', // dark blue
  },
  permanentPanel: {
    width: 250,
    height: '100%',
    backgroundColor: '#0D47A1', // dark blue
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
  brandName: { color: '#0D47A1', fontWeight: 'bold', fontSize: 16, flex: 1 },
  menu: { flex: 1 }, // nav sits right below the brand band
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  itemActive: { backgroundColor: '#1565C0' }, // highlight current screen
  logoutItem: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
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
  countText: { color: '#0D47A1', fontSize: 12, fontWeight: 'bold' },
  userBox: {
    backgroundColor: '#1E88E5',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  userTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  userNameCol: { flex: 1 },
  userName: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  userRole: { color: '#E3F0FF', fontSize: 12, marginTop: 1 },
  userDetails: { marginBottom: 12 },
  userMeta: { color: '#E3F0FF', fontSize: 12, marginBottom: 4 },
  changePw: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  changePwText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  pwInput: { marginBottom: 10 },
  pwDialog: { width: '100%', maxWidth: 400, alignSelf: 'center' },
});
