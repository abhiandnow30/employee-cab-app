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
export const DRAWER_ITEMS = [
  { label: 'Home', icon: 'home', screen: 'EmployeeHome' },
  { label: 'Profile', icon: 'account', screen: 'Profile' },
  { label: 'My Rides', icon: 'calendar-search', screen: 'MyRides' },
  { label: 'Ride History', icon: 'history', screen: 'RosterHistory' },
  { label: 'Trip Cancel', icon: 'car-off', screen: 'TripCancel' },
  { label: 'Track Cab', icon: 'map-marker-radius', screen: 'TrackCab' },
  { label: 'Feedback', icon: 'message-text', screen: 'Feedback' },
  { label: 'Rate Us', icon: 'star', screen: 'RateUs' },
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

// The signed-in employee card at the bottom: name only, expands on tap.
function UserCard({ user, onChangePassword }) {
  const [expanded, setExpanded] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const u = user || {};

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

      {/* Name row — tap to expand/collapse the details above. */}
      <Pressable style={styles.userTop} onPress={() => setExpanded((e) => !e)}>
        <MaterialCommunityIcons name="account-circle" size={32} color="#FFFFFF" />
        <Text style={styles.userName} numberOfLines={1}>
          {u.name || 'Employee'}
        </Text>
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
function DrawerBody({ user, onNavigate, onClose, onChangePassword, activeScreen, permanent }) {
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
        {DRAWER_ITEMS.map((item) => {
          const active = item.screen === activeScreen;
          return (
            <Pressable
              key={item.label}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => onNavigate(item)}
              android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
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
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Signed-in employee — at the bottom */}
      <UserCard user={user} onChangePassword={onChangePassword} />
    </View>
  );
}

export default function AppDrawer({
  visible,
  onClose,
  user,
  onNavigate,
  onChangePassword,
  activeScreen,
  permanent = false,
}) {
  // Permanent sidebar: a static left column, always on screen.
  if (permanent) {
    return (
      <View style={styles.permanentPanel}>
        <DrawerBody
          user={user}
          onNavigate={onNavigate}
          onChangePassword={onChangePassword}
          activeScreen={activeScreen}
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
            onNavigate={onNavigate}
            onChangePassword={onChangePassword}
            onClose={onClose}
            activeScreen={activeScreen}
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
  itemIcon: { width: 30 },
  itemText: { color: '#FFFFFF', fontSize: 16 },
  itemTextActive: { fontWeight: 'bold' },
  userBox: {
    backgroundColor: '#1E88E5',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  userTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  userName: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16, flex: 1 },
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
