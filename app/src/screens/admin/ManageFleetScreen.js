// ---------------------------------------------------------------------------
// FLEET & DRIVERS — a tab shell over three existing screens.
//
// Fleet (vehicles) and Drivers (accounts) used to be separate sidebar items.
// They're closely related — a driver is only useful once linked to a cab — so
// they share one menu entry with a tab switch. Nothing about any of the three
// screens changed: this just renders one of them underneath the tabs.
//
// COORDINATORS JOINED THIS SHELL (Sep 2026) rather than keeping its own drawer
// row, since there is usually only a small handful of them — a whole sidebar
// item for a screen opened this rarely was more clutter than the content
// justified. Admin-only, and not just as a menu choice: firestore.rules lets a
// coordinator create/delete only DRIVER profiles (never role 'coordinator'),
// and gives them no update path onto another profile's name or phone at all —
// so there is no coordinator-reachable action this tab could expose even if it
// were shown to them. Registered solely under the admin branch in App.js for
// that reason; the `isAdmin` check below is a second, cheap guard on top of
// the real one.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import ManageCabsScreen from './ManageCabsScreen';
import ManageDriversScreen from './ManageDriversScreen';
import ManageCoordinatorsScreen from './ManageCoordinatorsScreen';
import { useApp } from '../../context/AppContext';
import { colors, spacing } from '../../theme';

export default function ManageFleetScreen() {
  const { currentUser } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('fleet');

  const buttons = [
    { value: 'fleet', label: 'Cabs', icon: 'car-multiple' },
    { value: 'drivers', label: 'Drivers', icon: 'account-tie-hat' },
  ];
  if (isAdmin) {
    buttons.push({ value: 'coordinators', label: 'Coordinators', icon: 'headset' });
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabsRow}>
        <SegmentedButtons value={tab} onValueChange={setTab} buttons={buttons} />
      </View>
      <View style={styles.content}>
        {tab === 'fleet' ? <ManageCabsScreen /> : null}
        {tab === 'drivers' ? <ManageDriversScreen /> : null}
        {tab === 'coordinators' && isAdmin ? <ManageCoordinatorsScreen /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  tabsRow: { padding: spacing.lg, paddingBottom: spacing.md },
  content: { flex: 1 },
});
