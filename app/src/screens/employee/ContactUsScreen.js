// ---------------------------------------------------------------------------
// CONTACT US
// Shows the transport-desk phone number. Tapping "Call us" opens the phone
// dialer (on a device). A "Back to Home" button returns to the home screen.
// ---------------------------------------------------------------------------

import React from 'react';
import { StyleSheet, View, Linking } from 'react-native';
import { Text, Card, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';

export default function ContactUsScreen({ navigation }) {
  function callUs() {
    const tel = 'tel:' + SUPPORT_HELPLINE.replace(/\s/g, '');
    Linking.openURL(tel).catch(() => {});
  }

  return (
    <View style={styles.container}>
      <Card style={styles.card} mode="elevated">
        <Card.Content style={styles.cardContent}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="headset" size={40} color={colors.primary} />
          </View>
          <Text variant="titleLarge" style={styles.title}>
            Need help?
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Reach the transport desk anytime.
          </Text>

          <Button
            mode="contained"
            icon="phone"
            style={styles.callBtn}
            contentStyle={styles.callBtnContent}
            onPress={callUs}
          >
            Call us
          </Button>

          <Text variant="titleMedium" style={styles.number} onPress={callUs}>
            {SUPPORT_HELPLINE}
          </Text>
          <Text variant="bodySmall" style={styles.hours}>
            Available 24×7
          </Text>
        </Card.Content>
      </Card>

      <Button
        mode="text"
        icon="home"
        style={styles.homeBtn}
        onPress={() => navigation.navigate('EmployeeHome')}
      >
        Back to Home
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  card: { borderRadius: 16 },
  cardContent: { alignItems: 'center', paddingVertical: 12 },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#E3F0FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: { fontWeight: 'bold' },
  subtitle: { color: colors.muted, marginTop: 4, marginBottom: 20, textAlign: 'center' },
  callBtn: { borderRadius: 10, alignSelf: 'stretch' },
  callBtnContent: { paddingVertical: 8 },
  number: { marginTop: 16, color: colors.primary, fontWeight: 'bold' },
  hours: { color: colors.muted, marginTop: 4 },
  homeBtn: { marginTop: 24, alignSelf: 'center' },
});
