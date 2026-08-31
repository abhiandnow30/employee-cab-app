// ---------------------------------------------------------------------------
// REQUESTS  (admin) — a tab shell over three existing screens, the same
// pattern coordinator/RequestsScreen.js already uses for Change Requests +
// Cancelled Rides. None of the three screens' internals changed; this only
// decides which one is showing.
//
// WHY THIS EXISTS. Ride changes, cab setup and address changes each land in
// HR's queue rarely enough that three separate drawer rows for them was mostly
// three empty screens — real navigation clutter for something used this
// lightly. One row, one screen, a tab per kind.
//
// ADDRESS CHANGES STAYS ADMIN-ONLY, EVEN INSIDE THIS SHELL. Not a UI choice —
// firestore.rules only lets an admin READ addressChangeRequests at all
// (isAdmin(), not isDesk()), so a coordinator opening that tab would hit a
// permission-denied error, not an empty list. This screen is only ever
// registered under the admin branch in App.js, so a coordinator can't reach it
// in the first place; the `isAdmin` check below is a second, cheap guard on
// top of that, not the real boundary.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import ChangeRequestQueueScreen from '../coordinator/ChangeRequestQueueScreen';
import CabRequestsScreen from './CabRequestsScreen';
import AddressChangeRequestsScreen from './AddressChangeRequestsScreen';
import { useApp } from '../../context/AppContext';
import { colors, spacing } from '../../theme';

export default function RequestsInboxScreen() {
  const { currentUser, myQueue, menuCounts } = useApp();
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('rides');

  // Each count is the same pending number that used to badge that screen's own
  // drawer row — see AppContext.js's menuCounts — so nothing here is a new
  // computation, just moved from three drawer badges onto three tab labels.
  const rideCount = myQueue().length;
  const cabCount = menuCounts?.CabRequests || 0;
  const addressCount = menuCounts?.AddressRequests || 0;

  const buttons = [
    {
      value: 'rides',
      label: rideCount ? `Ride Cancel Requests (${rideCount})` : 'Ride Cancel Requests',
      icon: 'clipboard-list-outline',
    },
    {
      value: 'cabs',
      label: cabCount ? `New Cab Requests (${cabCount})` : 'New Cab Requests',
      icon: 'car-clock',
    },
  ];
  if (isAdmin) {
    buttons.push({
      value: 'address',
      label: addressCount ? `Address Requests (${addressCount})` : 'Address Requests',
      icon: 'home-edit',
    });
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabsRow}>
        <SegmentedButtons value={tab} onValueChange={setTab} buttons={buttons} />
      </View>
      <View style={styles.content}>
        {tab === 'rides' ? <ChangeRequestQueueScreen /> : null}
        {tab === 'cabs' ? <CabRequestsScreen /> : null}
        {tab === 'address' && isAdmin ? <AddressChangeRequestsScreen /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  tabsRow: { padding: spacing.lg, paddingBottom: spacing.md },
  content: { flex: 1 },
});
