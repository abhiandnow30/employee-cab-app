// ---------------------------------------------------------------------------
// COORDINATOR LOGIN
// Two boxes and a button: their own phone number, and the short numeric passcode the
// transport desk gave them. Together those ARE the credentials — see
// utils/coordinatorLogin.js for how one becomes the account and the other becomes
// the password.
//
// There is no email, no password to choose and no sign-up. HR creates the account
// (Coordinators → Add coordinator) and the passcode exists from that moment, so
// there is nothing to activate and no first sign-in to wait for.
//
// The passcode is shown in clear text on purpose, the same call the driver screen
// makes: it is read off a slip of paper or a message, it can be re-issued in one
// tap by the desk, and hiding it behind dots buys nothing but typos.
//
// NO "FORGOT PASSCODE" LINK. Their Auth address is synthesized on an unroutable
// domain, so Firebase has nowhere to send a reset. Losing it is a phone call to
// HR, who press "New code" — which is why that is what this screen says.
//
// On success the auth listener in AppContext loads the profile and App.js opens
// Today's Rides — the same path an email/password sign-in takes.
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import { StyleSheet, View, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, HelperText, Card } from 'react-native-paper';
import { useApp } from '../context/AppContext';
import { COMPANY_NAME, companyLogo, SUPPORT_HELPLINE } from '../branding';
import { colors } from '../theme';
import { COORDINATOR_PHONE_LENGTH, PASSCODE_LENGTH } from '../utils/coordinatorLogin';

export default function CoordinatorLoginScreen({ navigation }) {
  const { loginCoordinator } = useApp();

  const [phone, setPhone] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const codeRef = useRef(null); // filling the phone box jumps here

  async function handleLogin() {
    setError('');
    // Checked per FIELD, so the message names the box to fix rather than saying
    // "that login is wrong" about two boxes at once.
    if (phone.length !== COORDINATOR_PHONE_LENGTH) {
      setError(`Enter your ${COORDINATOR_PHONE_LENGTH}-digit phone number.`);
      return;
    }
    if (passcode.length !== PASSCODE_LENGTH) {
      setError(`Your passcode is the ${PASSCODE_LENGTH} digits the desk gave you.`);
      return;
    }
    setLoading(true);
    const result = await loginCoordinator(phone, passcode);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to
    // Today's Rides automatically — no navigation needed here.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Card style={styles.card} mode="elevated">
          <Card.Content style={styles.cardContent}>
            <Image source={companyLogo} style={styles.brandLogo} resizeMode="contain" />
            <Text variant="titleMedium" style={styles.brandName}>
              {COMPANY_NAME}
            </Text>
            <View style={styles.brandDivider} />
            <Text variant="titleLarge" style={styles.title}>
              Coordinator Sign In
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              Your phone number and the passcode HR gave you
            </Text>

            {/* Digits only and capped at the exact length in both boxes, so a
                mistyped entry is caught here rather than coming back as a generic
                Firebase error. Filling the phone box hands focus to the passcode. */}
            <TextInput
              label="Your phone number"
              value={phone}
              onChangeText={(t) => {
                const digits = t.replace(/[^0-9]/g, '').slice(0, COORDINATOR_PHONE_LENGTH);
                setPhone(digits);
                if (digits.length === COORDINATOR_PHONE_LENGTH) codeRef.current?.focus();
              }}
              mode="outlined"
              placeholder="e.g. 9848094029"
              keyboardType="number-pad"
              maxLength={COORDINATOR_PHONE_LENGTH}
              autoCapitalize="none"
              autoCorrect={false}
              left={<TextInput.Icon icon="phone" />}
              style={styles.input}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => codeRef.current?.focus()}
            />
            <HelperText type="info" visible={true} style={styles.hint}>
              The number the transport desk has on file for you.
            </HelperText>

            <TextInput
              ref={codeRef}
              label={`Passcode — ${PASSCODE_LENGTH} digits`}
              value={passcode}
              onChangeText={(t) => setPasscode(t.replace(/[^0-9]/g, '').slice(0, PASSCODE_LENGTH))}
              mode="outlined"
              placeholder="e.g. 4071"
              keyboardType="number-pad"
              maxLength={PASSCODE_LENGTH}
              autoCapitalize="none"
              autoCorrect={false}
              left={<TextInput.Icon icon="shield-key-outline" />}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <HelperText type="info" visible={true} style={styles.hint}>
              Given to you by HR when your account was created.
            </HelperText>

            {error ? (
              <HelperText type="error" visible={true} style={styles.error}>
                {error}
              </HelperText>
            ) : null}

            <Button
              mode="contained"
              onPress={handleLogin}
              style={styles.button}
              loading={loading}
              disabled={loading}
            >
              Sign In
            </Button>

            {/* No self-service reset exists, so point at the only thing that
                actually works rather than at a link that would go nowhere. */}
            <Text variant="bodySmall" style={styles.help}>
              Lost your passcode? HR can issue a new one from the Coordinators
              screen — call the desk on {SUPPORT_HELPLINE}.
            </Text>

            <Button
              mode="text"
              compact
              onPress={() => navigation.navigate('Login')}
              style={styles.link}
              disabled={loading}
            >
              Employee or admin sign in
            </Button>
          </Card.Content>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, borderRadius: 12 },
  cardContent: { paddingVertical: 24 },
  brandLogo: { width: 96, height: 64, alignSelf: 'center' },
  brandName: {
    textAlign: 'center',
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 4,
  },
  brandDivider: {
    height: 1,
    backgroundColor: colors.border,
    alignSelf: 'center',
    width: '60%',
    marginVertical: 14,
  },
  title: { textAlign: 'center', fontWeight: 'bold', color: colors.primary },
  subtitle: { textAlign: 'center', marginBottom: 20, opacity: 0.6 },
  input: { marginBottom: 0 },
  hint: { marginTop: -2, marginBottom: 4 },
  error: { marginTop: 2, marginBottom: 2 },
  button: { marginTop: 6, paddingVertical: 2, borderRadius: 8 },
  help: {
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
    color: colors.muted,
  },
  link: { marginTop: 6 },
});
