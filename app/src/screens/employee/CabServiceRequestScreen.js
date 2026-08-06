// ---------------------------------------------------------------------------
// CAB SERVICE REQUEST  (employee)
//
// The first thing someone sees when they sign in with their company Microsoft
// account and the transport desk has never entered them. They're a real
// employee — the directory said so — but the app knows nothing else about them:
// no employee ID, no home address, and no pickup route. A cab cannot be sent to
// an address nobody has, so a dashboard would only show them empty lists.
//
// So this screen replaces it until they've asked. They fill in their details
// once, it goes to the transport desk, and approving copies it onto their
// profile with a pickup route — see services/cabServiceRequests.js.
//
// After submitting they get the full app (App.js stops holding them here), with
// this screen still reachable so they can see the decision.
// ---------------------------------------------------------------------------

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Text, TextInput, Button, HelperText, Card, Chip, Divider,
} from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ScreenContainer from '../../components/ScreenContainer';
import { useApp } from '../../context/AppContext';
import { colors, spacing } from '../../theme';
import { SUPPORT_HELPLINE } from '../../branding';

export default function CabServiceRequestScreen({ navigation }) {
  const {
    currentUser, requestCabService, myCabServiceRequests, myPendingCabRequest,
    needsCabSetup,
  } = useApp();

  // Prefill whatever we already know. Name comes from the Microsoft account, so
  // it's usually right and just needs confirming.
  const [name, setName] = useState(currentUser?.name || '');
  const [empId, setEmpId] = useState(currentUser?.empId || '');
  const [phone, setPhone] = useState(currentUser?.phone || '');
  const [address, setAddress] = useState(currentUser?.address || '');
  const [landmark, setLandmark] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const latest = myCabServiceRequests?.[0] || null;

  async function submit() {
    setError('');
    setBusy(true);
    const res = await requestCabService({ name, empId, phone, address, landmark, note });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    // The live subscription now reports a Pending request, which flips this
    // screen to the "waiting" card below and unlocks the rest of the app.
  }

  // --- Already asked: show where it stands, not the form again --------------
  if (myPendingCabRequest) {
    return (
      <ScreenContainer scroll>
        <Card style={styles.card} mode="elevated">
          <Card.Content style={styles.centered}>
            <MaterialCommunityIcons name="clock-outline" size={52} color={colors.warning} />
            <Text variant="titleLarge" style={styles.title}>
              With the transport desk
            </Text>
            <Text variant="bodyMedium" style={styles.body}>
              Your details are in. The desk confirms them and puts you on a pickup
              route — you'll get a notification as soon as that's done.
            </Text>
            <Divider style={styles.divider} />
            <Detail label="Name" value={myPendingCabRequest.name} />
            <Detail label="Employee ID" value={myPendingCabRequest.empId} />
            <Detail label="Phone" value={myPendingCabRequest.phone} />
            <Detail label="Home address" value={myPendingCabRequest.address} />
            {myPendingCabRequest.landmark ? (
              <Detail label="Landmark" value={myPendingCabRequest.landmark} />
            ) : null}
            <Text variant="bodySmall" style={styles.help}>
              Need a cab before then? Call the transport desk on {SUPPORT_HELPLINE}.
            </Text>
          </Card.Content>
        </Card>
      </ScreenContainer>
    );
  }

  // --- Decided, and they're set up → nothing to do here --------------------
  if (!needsCabSetup && latest?.status === 'Approved') {
    return (
      <ScreenContainer scroll>
        <Card style={styles.card} mode="elevated">
          <Card.Content style={styles.centered}>
            <MaterialCommunityIcons name="check-decagram" size={52} color={colors.success} />
            <Text variant="titleLarge" style={styles.title}>
              You're set up for cab service
            </Text>
            <Text variant="bodyMedium" style={styles.body}>
              {latest.approvedRoute
                ? `You're on the ${latest.approvedRoute} pickup route.`
                : 'The transport desk has confirmed your details.'}
              {'\n'}Your rides appear under My Rides once you're on a shift roster.
            </Text>
            <Button
              mode="contained"
              icon="home"
              style={styles.submit}
              onPress={() => navigation.navigate('EmployeeHome')}
            >
              Go to home
            </Button>
          </Card.Content>
        </Card>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <Card style={styles.card} mode="elevated">
        <Card.Content>
          <View style={styles.centered}>
            <MaterialCommunityIcons name="car-clock" size={52} color={colors.primary} />
            <Text variant="titleLarge" style={styles.title}>
              Request cab service
            </Text>
            <Text variant="bodyMedium" style={styles.body}>
              You're signed in, but the transport desk doesn't have your details
              yet — so there's no address to collect you from. Fill this in once
              and they'll put you on a pickup route.
            </Text>
          </View>

          {/* A rejection is the reason they're back on this form, so say so
              rather than making them wonder why nothing happened. */}
          {latest?.status === 'Rejected' ? (
            <View style={styles.rejected}>
              <Chip
                icon="close-circle"
                compact
                textStyle={styles.chipText}
                style={[styles.chip, { backgroundColor: '#FDECEA' }]}
              >
                Previous request rejected
              </Chip>
              <Text variant="bodySmall" style={styles.rejectedReason}>
                {latest.rejectionReason || 'No reason was given — call the desk if you need to.'}
              </Text>
            </View>
          ) : null}

          <Divider style={styles.divider} />

          <TextInput
            label="Full name"
            value={name}
            onChangeText={setName}
            mode="outlined"
            left={<TextInput.Icon icon="account" />}
            style={styles.input}
          />
          <TextInput
            label="Employee ID"
            value={empId}
            onChangeText={setEmpId}
            mode="outlined"
            autoCapitalize="characters"
            left={<TextInput.Icon icon="card-account-details" />}
            style={styles.input}
          />
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
          <HelperText type="info" visible style={styles.hint}>
            The driver calls this number on the day.
          </HelperText>

          {/* The route is chosen FROM this, so it's the field that matters most:
              a vague address means the desk can't tell which cab passes it. */}
          <TextInput
            label="Home address"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            multiline
            numberOfLines={3}
            left={<TextInput.Icon icon="map-marker" />}
            style={styles.input}
          />
          <HelperText type="info" visible style={styles.hint}>
            Include your area — the desk picks your pickup route from this.
          </HelperText>
          <TextInput
            label="Nearest landmark (optional)"
            value={landmark}
            onChangeText={setLandmark}
            mode="outlined"
            left={<TextInput.Icon icon="signs-post" />}
            style={styles.input}
          />
          <TextInput
            label="Anything else the desk should know (optional)"
            value={note}
            onChangeText={setNote}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
          />

          {error ? (
            <HelperText type="error" visible>
              {error}
            </HelperText>
          ) : null}

          <Button
            mode="contained"
            icon="send"
            onPress={submit}
            loading={busy}
            disabled={busy}
            style={styles.submit}
          >
            Send to transport desk
          </Button>
          <Text variant="bodySmall" style={styles.help}>
            Urgent? Call the transport desk on {SUPPORT_HELPLINE}.
          </Text>
        </Card.Content>
      </Card>
    </ScreenContainer>
  );
}

// One labelled row of a submitted request, so the waiting card shows exactly
// what the desk is looking at.
function Detail({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text variant="bodySmall" style={styles.detailLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface },
  centered: { alignItems: 'center' },
  title: {
    fontWeight: 'bold',
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  body: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  divider: { alignSelf: 'stretch', marginVertical: spacing.lg },
  input: { marginBottom: spacing.md },
  hint: { marginTop: -spacing.md, marginBottom: spacing.xs },
  submit: { marginTop: spacing.md, paddingVertical: spacing.xs },
  help: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  rejected: { marginTop: spacing.md, alignItems: 'center' },
  chip: { alignSelf: 'center' },
  chipText: { color: colors.danger, fontSize: 12 },
  rejectedReason: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  detailRow: { alignSelf: 'stretch', marginBottom: spacing.md },
  detailLabel: { color: colors.muted },
  detailValue: { color: colors.text, fontWeight: '600' },
});
