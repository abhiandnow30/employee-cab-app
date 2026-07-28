// ---------------------------------------------------------------------------
// SIGN UP SCREEN  (drivers only)
// A driver creates their own account here: Name, Email, Phone, Password.
// The transport desk links them to a cab afterwards.
//
// Employees are provisioned by the transport desk (Employee Management), and
// ADMIN access is granted in the Firebase console — never from the app. The old
// screen offered an "Admin" role gated by a code that shipped inside the app
// bundle, which meant anyone could read it and make themselves an admin. The
// security rules now refuse any self-created role except 'driver', so that
// option is gone rather than merely hidden.
//
// On success, AppContext signs the user in and the app opens their home screen.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';

export default function SignUpScreen({ navigation }) {
  const { signup } = useApp();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    setError('');
    setLoading(true);
    const result = await signup({ role: 'driver', name, email, phone, password, confirm });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to the
    // driver home screen automatically. Nothing more to do here.
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
        <View style={styles.logoCircle}>
          <MaterialCommunityIcons name="account-plus" size={38} color="#FFFFFF" />
        </View>
        <Text variant="headlineMedium" style={styles.title}>
          Driver sign up
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          For cab drivers. Employees are added by the transport desk — ask them to
          create your account.
        </Text>

        <TextInput
          label="Name"
          value={name}
          onChangeText={setName}
          mode="outlined"
          left={<TextInput.Icon icon="account" />}
          style={styles.input}
        />

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

        {/* The transport desk links the cab afterwards — that's also what turns
            on live location sharing for this driver. */}
        <TextInput
          label="Phone"
          value={phone}
          onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ''))}
          mode="outlined"
          keyboardType="phone-pad"
          maxLength={10}
          left={<TextInput.Icon icon="phone" />}
          style={styles.input}
        />
        <HelperText type="info" visible={true} style={styles.info}>
          Your transport desk will link your cab after you sign up.
        </HelperText>

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

        <TextInput
          label="Confirm Password"
          value={confirm}
          onChangeText={setConfirm}
          mode="outlined"
          secureTextEntry={!showPassword}
          left={<TextInput.Icon icon="lock-check" />}
          style={styles.input}
        />

        {error ? (
          <HelperText type="error" visible={true}>
            {error}
          </HelperText>
        ) : null}

        <Button
          mode="contained"
          onPress={handleSignup}
          style={styles.button}
          loading={loading}
          disabled={loading}
          icon="content-save"
        >
          Save
        </Button>

        <Button mode="text" onPress={() => navigation.navigate('Login')} style={styles.link}>
          Already have an account? Sign In
        </Button>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 24, paddingTop: 40, paddingBottom: 40, alignItems: 'center' },
  form: { width: '100%', maxWidth: 480 },
  logoCircle: {
    alignSelf: 'center',
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { textAlign: 'center', fontWeight: 'bold', color: colors.primary },
  subtitle: { textAlign: 'center', marginBottom: 20, opacity: 0.7 },
  label: { marginBottom: 6, marginTop: 4, opacity: 0.8 },
  input: { marginBottom: 12 },
  info: { marginBottom: 8 },
  button: { marginTop: 8, paddingVertical: 4 },
  link: { marginTop: 10 },
});
