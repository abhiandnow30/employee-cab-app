// ---------------------------------------------------------------------------
// NATIVE (phone) Microsoft sign-in.
//
// Web doesn't need this — Firebase's signInWithPopup/linkWithPopup (see
// services/auth.js) handle the whole OAuth dance themselves in a popup. A
// phone has no popup, so this drives the same OpenID Connect flow by hand:
// open the system browser at Microsoft's own login page, get an id_token
// back, then hand that token to Firebase's OAuthProvider.credential().
//
// The nonce exists so Firebase can prove the id_token it receives was really
// issued for THIS sign-in attempt, not replayed from a captured request
// elsewhere: we hash a random raw nonce and send the HASH to Microsoft as the
// `nonce` request param; Microsoft embeds it in the id_token's own `nonce`
// claim; Firebase then re-hashes the RAW nonce we give it and checks the two
// match. Both the raw and hashed forms have to travel together — hence
// returning `rawNonce` alongside `idToken` from promptMicrosoftSignIn().
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';

// Required once per app so the system browser sheet actually closes and
// hands control back to the app after Microsoft redirects — without this the
// browser can be left open after a successful sign-in.
WebBrowser.maybeCompleteAuthSession();

const MICROSOFT_CLIENT_ID = process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || '';
const MICROSOFT_TENANT_ID = process.env.EXPO_PUBLIC_MICROSOFT_TENANT_ID || 'common';

// Microsoft's v2.0 endpoints are stable and well-known, so these are hardcoded
// rather than fetched via discovery — one less network round trip before the
// user even sees the sign-in prompt.
const discovery = {
  authorizationEndpoint: `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
};

export default function useMicrosoftAuthRequest() {
  const rawNonceRef = useRef(null);
  const [hashedNonce, setHashedNonce] = useState(null);

  // A fresh nonce per mount (per sign-in attempt shown to the user), not per
  // prompt press — regenerating on every keystroke-adjacent render would just
  // waste hashing work for no security benefit.
  useEffect(() => {
    const raw = Crypto.randomUUID();
    rawNonceRef.current = raw;
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw).then(setHashedNonce);
  }, []);

  const redirectUri = useMemo(
    () => AuthSession.makeRedirectUri({ scheme: 'cabservice', path: 'microsoft-auth' }),
    []
  );

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: MICROSOFT_CLIENT_ID,
      scopes: ['openid', 'profile', 'email'],
      redirectUri,
      responseType: AuthSession.ResponseType.IdToken,
      usePKCE: false, // implicit id_token flow — no code to exchange, no secret needed
      // `prompt: select_account` keeps this in step with the web popup
      // (microsoftProvider() in services/auth.js): always let the person choose
      // which work account to use, instead of silently reusing whichever
      // session the system browser already holds.
      extraParams: {
        prompt: 'select_account',
        ...(hashedNonce ? { nonce: hashedNonce } : {}),
      },
    },
    discovery
  );

  // Opens the system browser and resolves once the employee finishes (or
  // cancels). Returns null on cancel/dismiss, { idToken, rawNonce } on
  // success — hand that straight to signInWithMicrosoftCredential /
  // linkMicrosoftCredential in services/auth.js. Throws on a real failure.
  async function promptMicrosoftSignIn() {
    if (!MICROSOFT_CLIENT_ID) {
      throw new Error('Microsoft sign-in is not configured yet.');
    }
    if (!hashedNonce || !rawNonceRef.current) {
      throw new Error('Still getting ready — try again in a moment.');
    }
    const result = await promptAsync();
    if (result.type === 'cancel' || result.type === 'dismiss') return null;
    if (result.type !== 'success' || !result.params?.id_token) {
      throw new Error(result.params?.error_description || 'Microsoft sign-in failed.');
    }
    return { idToken: result.params.id_token, rawNonce: rawNonceRef.current };
  }

  return { promptMicrosoftSignIn, ready: !!request && !!hashedNonce };
}
