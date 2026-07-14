// ---------------------------------------------------------------------------
// LOGIN SCREEN
// Enter email + password. On success, AppContext stores the user and the app
// automatically switches to the employee or admin screens (see App.js).
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, HelperText, Card } from 'react-native-paper';
import { useApp } from '../context/AppContext';

export default function LoginScreen() {
  const { login } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  function handleLogin() {
    setError('');
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    const result = login(email, password);
    if (!result.ok) {
      setError(result.message);
    }
    // On success we do nothing here — App.js notices the user is logged in
    // and shows the right home screen automatically.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text variant="headlineMedium" style={styles.title}>
          Employee Cab
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Book your company cab
        </Text>

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          mode="outlined"
          autoCapitalize="none"
          keyboardType="email-address"
          left={<TextInput.Icon icon="email" />}
          style={styles.input}
        />

        <TextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          mode="outlined"
          secureTextEntry={!showPassword}
          left={<TextInput.Icon icon="lock" />}
          right={
            <TextInput.Icon
              icon={showPassword ? 'eye-off' : 'eye'}
              onPress={() => setShowPassword((s) => !s)}
            />
          }
          style={styles.input}
        />

        {error ? (
          <HelperText type="error" visible={true}>
            {error}
          </HelperText>
        ) : null}

        <Button mode="contained" onPress={handleLogin} style={styles.button}>
          Log in
        </Button>

        {/* Demo helper — remove once real login exists. */}
        <Card style={styles.hintCard} mode="contained">
          <Card.Content>
            <Text variant="labelLarge">Demo logins (password: 1234)</Text>
            <Text variant="bodySmall">Employee → employee@demo.com</Text>
            <Text variant="bodySmall">Admin → admin@demo.com</Text>
          </Card.Content>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { textAlign: 'center', fontWeight: 'bold' },
  subtitle: { textAlign: 'center', marginBottom: 28, opacity: 0.7 },
  input: { marginBottom: 12 },
  button: { marginTop: 8, paddingVertical: 4 },
  hintCard: { marginTop: 28 },
});
