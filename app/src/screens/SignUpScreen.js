// ---------------------------------------------------------------------------
// SIGN UP SCREEN
// New users create an account here. Pick a role, fill in the details, Save.
//   • Employee / Admin → Name, Email, Employee ID, Password, Confirm
//   • Admin also needs the secret admin code
//   • Driver → Name, Email, Phone, Password, Confirm + choose a Cab
// On success, AppContext signs the user in and the app opens their home screen.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text, TextInput, Button, HelperText, SegmentedButtons } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';

export default function SignUpScreen({ navigation }) {
  const { signup } = useApp();

  const [role, setRole] = useState('employee');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [empId, setEmpId] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isDriver = role === 'driver';
  const isAdmin = role === 'admin';
  const isEmployee = role === 'employee';

  async function handleSignup() {
    setError('');
    setLoading(true);
    const result = await signup({
      role,
      name,
      email,
      empId,
      address,
      phone,
      adminCode,
      password,
      confirm,
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Success: the auth listener loads the profile and App.js switches to the
    // correct home screen automatically. Nothing more to do here.
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
          Create account
        </Text>
        <Text variant="bodyMedium" style={styles.subtitle}>
          Sign up to get started
        </Text>

        {/* Role */}
        <SegmentedButtons
          value={role}
          onValueChange={setRole}
          density="small"
          style={styles.role}
          buttons={[
            { value: 'employee', label: 'Employee' },
            { value: 'driver', label: 'Driver' },
            { value: 'admin', label: 'Admin' },
          ]}
        />

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

        {/* Employee ID — for Employee & Admin */}
        {!isDriver && (
          <TextInput
            label="Employee ID"
            value={empId}
            onChangeText={setEmpId}
            mode="outlined"
            left={<TextInput.Icon icon="badge-account" />}
            style={styles.input}
          />
        )}

        {/* Address — for Employee (mandatory; the transport desk uses it for pickup). */}
        {isEmployee && (
          <TextInput
            label="Address"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            placeholder="House / street, area, city, pincode"
            multiline
            numberOfLines={2}
            left={<TextInput.Icon icon="map-marker" />}
            style={styles.input}
          />
        )}

        {/* Phone — for Driver. (The admin assigns the cab later.) */}
        {isDriver && (
          <>
            <TextInput
              label="Phone"
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^0-9]/g, ''))}
              mode="outlined"
              keyboardType="phone-pad"
              left={<TextInput.Icon icon="phone" />}
              style={styles.input}
            />
            <HelperText type="info" visible={true} style={styles.info}>
              Your transport desk will assign your cab after you sign up.
            </HelperText>
          </>
        )}

        {/* Admin code — for Admin */}
        {isAdmin && (
          <TextInput
            label="Admin code"
            value={adminCode}
            onChangeText={setAdminCode}
            mode="outlined"
            autoCapitalize="characters"
            left={<TextInput.Icon icon="shield-key" />}
            style={styles.input}
          />
        )}

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
  role: { marginBottom: 14 },
  input: { marginBottom: 12 },
  info: { marginBottom: 8 },
  button: { marginTop: 8, paddingVertical: 4 },
  link: { marginTop: 10 },
});
