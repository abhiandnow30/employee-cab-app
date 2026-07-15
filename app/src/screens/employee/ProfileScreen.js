// ---------------------------------------------------------------------------
// PROFILE
// Shows the signed-in employee's details and a Log out button.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Avatar, Card, List, Button, Divider } from 'react-native-paper';
import { useApp } from '../../context/AppContext';

export default function ProfileScreen() {
  const { currentUser, logout } = useApp();
  const u = currentUser || {};
  const initials = (u.name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Avatar.Text size={72} label={initials} />
        <Text variant="headlineSmall" style={styles.name}>
          {u.name}
        </Text>
        <Text variant="bodyMedium" style={styles.role}>
          {u.role === 'admin' ? 'Transport Desk' : 'Employee'}
        </Text>
      </View>

      <Card mode="outlined" style={styles.card}>
        <List.Item title="Email" description={u.email} left={(p) => <List.Icon {...p} icon="email" />} />
        <Divider />
        <List.Item title="Employee ID" description={u.empId} left={(p) => <List.Icon {...p} icon="identifier" />} />
        <Divider />
        <List.Item title="Phone" description={u.phone} left={(p) => <List.Icon {...p} icon="phone" />} />
      </Card>

      <Button mode="contained" icon="logout" onPress={logout} style={styles.logout}>
        Log out
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { alignItems: 'center', marginBottom: 24 },
  name: { marginTop: 12, fontWeight: 'bold' },
  role: { opacity: 0.7 },
  card: { marginBottom: 24 },
  logout: { paddingVertical: 4 },
});
