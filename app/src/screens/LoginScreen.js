// ---------------------------------------------------------------------------
// LOGIN SCREEN
// Enter email + password. On success, AppContext stores the user and the app
// automatically switches to the employee or admin screens (see App.js).
// ---------------------------------------------------------------------------

import React, { useState, useRef } from 'react';
import { StyleSheet, View, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, HelperText, Card } from 'react-native-paper';
import { useApp } from '../context/AppContext';
import { COMPANY_NAME, companyLogo } from '../branding';
import { colors } from '../theme';

export default function LoginScreen({ navigation }) {
  const { login, resetPassword } = useApp();

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Card style={styles.card} mode="elevated">
          <Card.Content style={styles.cardContent}>
            <Image
              source={companyLogo}
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <Text variant="titleMedium" style={styles.brandName}>
              {COMPANY_NAME}
            </Text>
            <View style={styles.brandDivider} />
            <Text variant="titleLarge" style={styles.title}>
              Cab Service
            </Text>
            <Text variant="bodySmall" style={styles.subtitle}>
              Book your company cab
            </Text>

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
              style={styles.button}
              loading={loading}
              disabled={loading}
            >
              Sign In
            </Button>

            <Button
              mode="text"
              onPress={handleForgot}
              style={styles.link}
              compact
              disabled={loading}
            >
              Forgot password?
            </Button>

            <Button
              mode="text"
              onPress={() => navigation.navigate('SignUp')}
              style={styles.link}
              compact
            >
              New here? Create an account
            </Button>
          </Card.Content>
        </Card>

        {/* Demo helper — remove once real login exists. */}
        <Text variant="bodySmall" style={styles.hint}>
          Demo (password: cab12345) · employee@demo.com · admin@demo.com · driver@demo.com
        </Text>
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
  input: { marginBottom: 10 },
  error: { marginTop: -2, marginBottom: 2 },
  button: { marginTop: 6, paddingVertical: 2, borderRadius: 8 },
  link: { marginTop: 4 },
  hint: {
    maxWidth: 380,
    textAlign: 'center',
    marginTop: 16,
    opacity: 0.5,
    color: colors.muted,
  },
});
