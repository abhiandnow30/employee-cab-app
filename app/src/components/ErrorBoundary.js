// ---------------------------------------------------------------------------
// ErrorBoundary
// A React error anywhere below this component used to take the whole app down
// to a blank white screen with no way back. This catches it, shows what
// happened, and offers a retry that re-mounts the tree.
//
// It has to be a class component — only classes can implement
// componentDidCatch / getDerivedStateFromError.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, font, radius, shadow, spacing } from '../theme';
import { SUPPORT_HELPLINE } from '../branding';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep this in the console so a crash is still diagnosable in dev / web logs.
    console.error('[app] unhandled error:', error, info?.componentStack);
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.iconChip}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={40}
                color={colors.danger}
              />
            </View>
            <Text variant="headlineSmall" style={styles.title}>
              Something went wrong
            </Text>
            <Text variant="bodyMedium" style={styles.body}>
              The screen couldn't be displayed. Your bookings are safe — nothing was
              lost. Try again, and if it keeps happening call the transport desk on{' '}
              {SUPPORT_HELPLINE}.
            </Text>
            <Text variant="bodySmall" style={styles.detail}>
              {String(error?.message || error)}
            </Text>
            <Button
              mode="contained"
              icon="refresh"
              onPress={this.retry}
              style={styles.btn}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
            >
              Try again
            </Button>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xxxl,
    ...shadow.lg,
  },
  // A tinted disc behind the icon keeps a red alert glyph from reading as an
  // error that has bled onto the page.
  iconChip: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: font.bold,
    marginTop: spacing.lg,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    marginTop: spacing.md,
    textAlign: 'center',
    color: colors.textSecondary,
    lineHeight: 22,
  },
  // The raw error message: kept, because it is what makes a crash reportable,
  // but visually demoted into a code-ish tray so it never looks like a
  // sentence addressed to the person reading it.
  detail: {
    marginTop: spacing.lg,
    alignSelf: 'stretch',
    color: colors.muted,
    textAlign: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btn: { marginTop: spacing.xl, alignSelf: 'stretch', borderRadius: radius.md },
  btnContent: { paddingVertical: 6 },
  btnLabel: { fontFamily: font.semibold, fontSize: 15 },
});
