// ---------------------------------------------------------------------------
// DRIVER LOGIN
// Two boxes and a button: the last 4 digits of the cab they are driving, and their
// own phone number. Together those ARE the credentials — see utils/driverLogin.js
// for how one becomes the account and the other becomes the password.
//
// TWO FIELDS RATHER THAN ONE 14-DIGIT STRING, because that is how a driver holds
// the information: they can read the last 4 digits off the vehicle they are sitting
// in, and they know their own number by heart. Asking for one long code made them
// stitch the two together in their head and get it wrong.
//
// There is no email, no password and no sign-up. The desk creates the account
// (Cabs & Drivers → Drivers) and the code comes into being when they link that
// driver to a cab.
//
// Both fields are shown in clear text on purpose. They are read off a slip of
// paper or the side of a car, they change whenever the cab changes, and hiding
// them behind dots buys nothing but typos in a car park at 8 PM.
//
// On success the auth listener in AppContext loads the profile and App.js opens My
// Trips — the same path an email/password sign-in takes.
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { useApp } from '../context/AppContext';
import AuthLayout from '../components/AuthLayout';
import { SUPPORT_HELPLINE } from '../branding';
import { colors, font, radius, shadow, spacing } from '../theme';
import { CAB_CODE_LENGTH, DRIVER_PHONE_LENGTH } from '../utils/driverLogin';
import { HJ_SUPPRESS } from '../analytics/hotjar';

// No `navigation` prop: signing in swaps the whole stack by role (see App.js), so
// this screen never navigated anywhere itself — the only call was the removed
// "Employee or admin sign in" link.
export default function DriverLoginScreen() {
  const { loginDriver } = useApp();

  const [cabDigits, setCabDigits] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const phoneRef = useRef(null); // filling the cab box jumps here

  async function handleLogin() {
    setError('');
    // Checked per FIELD, so the message names the box to fix rather than saying
    // "that code is the wrong length" about two boxes at once.
    if (cabDigits.length !== CAB_CODE_LENGTH) {
      setError(`Enter the last ${CAB_CODE_LENGTH} digits of your cab number.`);
      return;
    }
    if (phone.length !== DRIVER_PHONE_LENGTH) {
      setError(`Enter your ${DRIVER_PHONE_LENGTH}-digit phone number.`);
      return;
    }
    setLoading(true);
    const result = await loginDriver(cabDigits + phone);
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to My
    // Trips automatically — no navigation needed here.
  }

  return (
    <AuthLayout title="Driver Sign In" subtitle="Your cab and your phone number are your login.">
      {/* Digits only and capped at the exact length in both boxes, so a
          mistyped entry is caught here rather than coming back as a Firebase
          error. Filling the cab box hands focus to the phone box — four
          digits then a jump, so neither has to be tapped. */}
      <TextInput
        {...HJ_SUPPRESS}
        label={`Cab number — last ${CAB_CODE_LENGTH} digits`}
        value={cabDigits}
        onChangeText={(t) => {
          const digits = t.replace(/[^0-9]/g, '').slice(0, CAB_CODE_LENGTH);
          setCabDigits(digits);
          if (digits.length === CAB_CODE_LENGTH) phoneRef.current?.focus();
        }}
        mode="outlined"
        placeholder="e.g. 4567"
        keyboardType="number-pad"
        maxLength={CAB_CODE_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        left={<TextInput.Icon icon="car" />}
        style={styles.input}
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={() => phoneRef.current?.focus()}
      />
      <HelperText type="info" visible={true} style={styles.hint}>
        The last 4 digits of the number plate on the cab you are driving.
      </HelperText>

      <TextInput
        {...HJ_SUPPRESS}
        ref={phoneRef}
        label="Your phone number"
        value={phone}
        onChangeText={(t) =>
          setPhone(t.replace(/[^0-9]/g, '').slice(0, DRIVER_PHONE_LENGTH))
        }
        mode="outlined"
        placeholder="e.g. 7894561230"
        keyboardType="number-pad"
        maxLength={DRIVER_PHONE_LENGTH}
        autoCapitalize="none"
        autoCorrect={false}
        left={<TextInput.Icon icon="phone" />}
        style={styles.input}
        returnKeyType="go"
        onSubmitEditing={handleLogin}
      />
      <HelperText type="info" visible={true} style={styles.hint}>
        The number the transport desk has on file for you.
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
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
        loading={loading}
        disabled={loading}
      >
        Sign In
      </Button>

      {/* The cab half changes when the cab does, so "it worked yesterday" is
          a normal thing to happen and the desk is who fixes it. */}
      <Text variant="bodySmall" style={styles.help}>
        Changed cab, or not been assigned one yet? Call the transport desk on{' '}
        {SUPPORT_HELPLINE}.
      </Text>

      {/* NO "Employee or admin sign in" LINK. Removed at explicit request. The
          main sign-in screen still links INTO this one, so the route is how
          anyone gets here in the first place; this was only the way back. If a
          driver lands here by a stale bookmark and needs the
          employee screen, it is /login — worth restoring this button if that
          turns out to happen. */}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 0, backgroundColor: colors.surface },
  hint: { marginTop: -2, marginBottom: spacing.xs, color: colors.muted },
  error: { marginTop: 2, marginBottom: 2 },
  // Squarer and taller than Paper's default pill — that shape is what makes the
  // primary action read as the one thing on the form to press.
  button: { marginTop: spacing.md, borderRadius: radius.md, ...shadow.brand },
  buttonContent: { paddingVertical: 8 },
  buttonLabel: { fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.2 },
  // The fallback route when the login itself can't work — set apart in a tinted
  // tray so it reads as help, not as more form.
  help: {
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    lineHeight: 19,
    color: colors.textSecondary,
  },
});
