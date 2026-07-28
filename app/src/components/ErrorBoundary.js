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
import { colors } from '../theme';
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
          <MaterialCommunityIcons name="alert-circle-outline" size={56} color={colors.danger} />
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
          <Button mode="contained" icon="refresh" onPress={this.retry} style={styles.btn}>
            Try again
          </Button>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { fontWeight: 'bold', marginTop: 14, color: colors.text, textAlign: 'center' },
  body: { marginTop: 10, textAlign: 'center', color: colors.muted, maxWidth: 420, lineHeight: 20 },
  detail: {
    marginTop: 14,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    maxWidth: 420,
  },
  btn: { marginTop: 22 },
});
