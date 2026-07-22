// ---------------------------------------------------------------------------
// ScreenContainer — centers page content at a comfortable width on wide/web
// screens while staying full-width on phones. This keeps every screen from
// stretching edge-to-edge in the browser.
//
//   <ScreenContainer scroll>        long form pages (scrolls)
//   <ScreenContainer>               short pages that fit on screen
//   <ScreenContainer wide ...>      dashboards / lists (720 instead of 480)
//
// For FlatList screens, wrap the list in a plain centered View instead (a
// FlatList must keep flex height), e.g.:
//   <View style={{ flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';

export default function ScreenContainer({ children, scroll = false, wide = false, style }) {
  const inner = <View style={[styles.inner, wide && styles.wide, style]}>{children}</View>;
  if (scroll) {
    return <ScrollView contentContainerStyle={styles.scrollOuter}>{inner}</ScrollView>;
  }
  return <View style={styles.outer}>{inner}</View>;
}

const styles = StyleSheet.create({
  outer: { flex: 1, alignItems: 'center', padding: 16 },
  scrollOuter: { alignItems: 'center', padding: 16, flexGrow: 1 },
  inner: { width: '100%', maxWidth: 480 },
  wide: { maxWidth: 720 },
});
