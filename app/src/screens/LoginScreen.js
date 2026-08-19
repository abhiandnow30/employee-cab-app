// ---------------------------------------------------------------------------
// LOGIN SCREEN
// Enter email + password. On success, AppContext stores the user and the app
// automatically switches to the employee or admin screens (see App.js).
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Text, TextInput, Button, HelperText, Divider } from 'react-native-paper';
import { useApp } from '../context/AppContext';
import AuthLayout from '../components/AuthLayout';
import { colors, font, radius, shadow, spacing } from '../theme';
import useMicrosoftAuthRequest from '../utils/useMicrosoftAuthRequest';

export default function LoginScreen({ navigation }) {
  const { login, resetPassword, loginWithMicrosoftPopup, loginWithMicrosoftCredential } = useApp();
  // Only does anything on native — see the hook's own header comment. Calling
  // it unconditionally (web included) is fine; it just never gets prompted.
  const { promptMicrosoftSignIn, ready: microsoftReady } = useMicrosoftAuthRequest();
  const [microsoftBusy, setMicrosoftBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(''); // success/neutral message (e.g. reset sent)
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef(null); // lets Enter on the email field jump here

  async function handleLogin() {
    setError('');
    setInfo('');
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setLoading(true);
    const result = await login(email, password); // checks with Firebase
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to the
    // right home screen automatically — no further navigation needed here.
  }

  // Web uses a plain popup; a phone has no popup, so it drives the OAuth
  // flow itself via useMicrosoftAuthRequest and hands Firebase the resulting
  // token. Either way, loginWithMicrosoftPopup/loginWithMicrosoftCredential
  // (AppContext.js) handle everything from there: if this Microsoft identity
  // already matches an employee, success flows through the same auth
  // listener as email/password (same as handleLogin above) with nothing more
  // to do here. If it's the first time and matches nobody by uid, those
  // functions delete the throwaway account and set microsoftConfirm instead —
  // App.js then shows a one-time password prompt (MicrosoftConfirmScreen) to
  // link Microsoft onto the employee's real existing account. Either way,
  // `result.ok` is true unless something genuinely went wrong.
  async function handleMicrosoftLogin() {
    setError('');
    setInfo('');
    setMicrosoftBusy(true);
    try {
      const result =
        Platform.OS === 'web'
          ? await loginWithMicrosoftPopup()
          : await (async () => {
              const token = await promptMicrosoftSignIn();
              if (!token) return { ok: true }; // cancelled — not an error
              return loginWithMicrosoftCredential(token.idToken, token.rawNonce);
            })();
      if (!result.ok && result.message) {
        setError(result.message);
      }
    } catch (e) {
      setError(e.message || 'Could not sign in with Microsoft.');
    } finally {
      setMicrosoftBusy(false);
    }
  }

  // Emails a password-reset link to the address typed in the Email field.
  async function handleForgot() {
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Enter your email above, then tap “Forgot password?”.');
      return;
    }
    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);
    if (res.ok) {
      setInfo(`Password-reset link sent to ${email.trim()}. Check your inbox.`);
    } else {
      setError(res.message);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to see your rides, track your cab and reach the transport desk."
    >
      <TextInput
        label="Email"
        value={email}
        onChangeText={setEmail}
        mode="outlined"
        dense
        autoCapitalize="none"
        keyboardType="email-address"
        left={<TextInput.Icon icon="email" />}
        style={styles.input}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />

      <TextInput
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={setPassword}
        mode="outlined"
        dense
        secureTextEntry={!showPassword}
        left={<TextInput.Icon icon="lock" />}
        right={
          <TextInput.Icon
            icon={showPassword ? 'eye-off' : 'eye'}
            onPress={() => setShowPassword((s) => !s)}
          />
        }
        style={styles.input}
        returnKeyType="go"
        onSubmitEditing={handleLogin}
      />

      {error ? (
        <HelperText type="error" visible={true} style={styles.error}>
          {error}
        </HelperText>
      ) : null}
      {info ? (
        <HelperText type="info" visible={true} style={styles.error}>
          {info}
        </HelperText>
      ) : null}

      <Button
        mode="contained"
        onPress={handleLogin}
        style={[styles.button, styles.primaryButton]}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
        loading={loading}
        disabled={loading}
      >
        Sign In
      </Button>

      <Button
        mode="text"
        onPress={handleForgot}
        style={styles.link}
        labelStyle={styles.signupLink}
        compact
        disabled={loading}
      >
        Forgot password?
      </Button>

      <View style={styles.dividerRow}>
        <Divider style={styles.dividerLine} />
        <Text variant="bodySmall" style={styles.dividerText}>or</Text>
        <Divider style={styles.dividerLine} />
      </View>

      {/* Works directly for anyone the admin already created in Employee
          Management — no prior trip to Profile required. The first time,
          if this Microsoft account doesn't match anyone yet by uid,
          loginWithMicrosoftPopup/loginWithMicrosoftCredential
          (AppContext.js) delete the throwaway account and prompt for a
          one-time password confirmation instead (App.js,
          MicrosoftConfirmScreen) — entirely client-side, no server code
          involved. Every sign-in after that is instant. The manual
          link-from-Profile flow (ProfileScreen.js) still exists too, as
          an alternative for anyone who'd rather set it up proactively. */}
      <Button
        mode="outlined"
        icon="microsoft"
        onPress={handleMicrosoftLogin}
        style={[styles.button, styles.microsoftButton]}
        contentStyle={styles.buttonContent}
        labelStyle={styles.buttonLabel}
        loading={microsoftBusy}
        disabled={microsoftBusy || loading || (Platform.OS !== 'web' && !microsoftReady)}
      >
        Sign in with Microsoft
      </Button>

      {/* Neither drivers nor coordinators sign in here: they have no email
          and no password of their own, just a number the desk issues them
          (a cab-derived code, or a short numeric passcode — see
          DriverLoginScreen and CoordinatorLoginScreen). These links are the
          only way to those screens on a phone, so they can't be dropped. */}
      <View style={styles.altTray}>
        <View style={styles.signupRow}>
          <Text variant="bodySmall" style={styles.signupHint}>
            Are you a driver?
          </Text>
          <Button
            mode="text"
            compact
            labelStyle={styles.signupLink}
            onPress={() => navigation.navigate('DriverLogin')}
            disabled={loading}
          >
            Driver sign in
          </Button>
        </View>
        <View style={styles.signupRow}>
          <Text variant="bodySmall" style={styles.signupHint}>
            Are you a coordinator?
          </Text>
          <Button
            mode="text"
            compact
            labelStyle={styles.signupLink}
            onPress={() => navigation.navigate('CoordinatorLogin')}
            disabled={loading}
          >
            Coordinator sign in
          </Button>
        </View>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  error: { marginTop: -spacing.xs, marginBottom: 2 },
  // Squarer and taller than Paper's default pill — that shape is what makes the
  // primary action read as the one thing on the form to press.
  button: { marginTop: spacing.sm, borderRadius: radius.md },
  buttonContent: { paddingVertical: 8 },
  buttonLabel: { fontFamily: font.semibold, fontSize: 15, letterSpacing: 0.2 },
  primaryButton: { ...shadow.brand },
  microsoftButton: { borderColor: colors.borderStrong, borderWidth: 1.5 },
  link: { marginTop: spacing.xs, alignSelf: 'center' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  dividerLine: { flex: 1, backgroundColor: colors.border },
  dividerText: {
    color: colors.muted,
    fontFamily: font.medium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // The two "are you a driver / coordinator" rows sit in their own tray at the
  // foot of the form, so they don't compete with the sign-in button above.
  altTray: {
    marginTop: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  signupHint: { color: colors.muted },
  signupLink: { fontFamily: font.semibold },
});
