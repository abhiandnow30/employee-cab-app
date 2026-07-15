// ---------------------------------------------------------------------------
// OTP SCREEN
// After email + password, the employee enters a one-time code.
// For this demo the code is a fixed TEST_OTP. Later, the backend will send a
// real code by SMS and verify it server-side.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, TextInput, Button, HelperText, Card } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { TEST_OTP } from '../data/mockData';
import { colors } from '../theme';

export default function OtpScreen({ route }) {
  const { email } = route.params;
  const { signInByEmail } = useApp();

  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  function handleVerify() {
    setError('');
    if (otp.trim() !== TEST_OTP) {
      setError('Incorrect code. Please try again.');
      return;
    }
    // Correct code → log the user in. App.js then shows the home screen.
    signInByEmail(email);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.logoCircle}>
          <MaterialCommunityIcons name="shield-check" size={38} color="#FFFFFF" />
        </View>
        <Text variant="headlineMedium" style={styles.title}>
          Verify it's you
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Enter the 6-digit code sent to{'\n'}
          {email}
        </Text>

        <TextInput
          label="Enter OTP"
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/[^0-9]/g, ''))} // digits only
          mode="outlined"
          keyboardType="number-pad"
          maxLength={6}
          left={<TextInput.Icon icon="shield-key" />}
          style={styles.input}
          returnKeyType="go"
          onSubmitEditing={handleVerify}
        />

        {error ? (
          <HelperText type="error" visible={true}>
            {error}
          </HelperText>
        ) : null}

        <Button mode="contained" onPress={handleVerify} style={styles.button}>
          Verify &amp; sign in
        </Button>

        {/* Demo helper — remove once real SMS OTP exists. */}
        <Card style={styles.hintCard} mode="contained">
          <Card.Content>
            <Text variant="labelLarge">Demo OTP</Text>
            <Text variant="bodySmall">Use code: {TEST_OTP}</Text>
          </Card.Content>
        </Card>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  logoCircle: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { textAlign: 'center', fontWeight: 'bold', color: colors.primary },
  subtitle: { textAlign: 'center', marginBottom: 28, marginTop: 8, opacity: 0.7 },
  input: { marginBottom: 4 },
  button: { marginTop: 12, paddingVertical: 4 },
  hintCard: { marginTop: 28 },
});
