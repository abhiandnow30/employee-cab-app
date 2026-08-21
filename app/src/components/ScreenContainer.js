// ---------------------------------------------------------------------------
// ScreenContainer — centers page content at a comfortable width on wide/web
// screens while staying full-width on phones. This keeps every screen from
// stretching edge-to-edge in the browser.
//
//   <ScreenContainer scroll>        long form pages (scrolls)
//   <ScreenContainer>               short pages that fit on screen
//   <ScreenContainer wide ...>      dashboards / lists (760 instead of 520)
//
// For FlatList screens, wrap the list in a plain centered View instead (a
// FlatList must keep flex height), e.g.:
//   <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { colors, spacing } from '../theme';

export default function ScreenContainer({ children, scroll = false, wide = false, style }) {
  const inner = <View style={[styles.inner, wide && styles.wide, style]}>{children}</View>;
  if (scroll) {
    return (
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollOuter}
        showsVerticalScrollIndicator={false}
      >
        {inner}
      </ScrollView>
    );
  }
  return <View style={styles.outer}>{inner}</View>;
}

const styles = StyleSheet.create({
  scrollView: { flex: 1, backgroundColor: colors.background },
  // The extra bottom padding is breathing room, not decoration: the last card
  // on a scrolling form used to end flush against the edge of the viewport,
  // which reads as content cut off rather than content finished.
  outer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: colors.background,
  },
  scrollOuter: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  // 520 rather than 480: Poppins is a wide face, and forms with a label and a
  // value side by side were wrapping at the old width.
  inner: { width: '100%', maxWidth: 520 },
  wide: { maxWidth: 760 },
});
