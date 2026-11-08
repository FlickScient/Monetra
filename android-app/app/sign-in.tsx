import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSignIn, useSignUp } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { theme } from '@/src/theme';

type ClerkFailure = {
  message?: string;
  errors?: Array<{ longMessage?: string; message?: string }>;
};

function errorText(error: unknown) {
  const issue = error as ClerkFailure | null;
  return issue?.errors?.[0]?.longMessage ?? issue?.errors?.[0]?.message ?? issue?.message ?? 'Something went wrong. Please try again.';
}

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, fetchStatus: signInStatus } = useSignIn();
  const { signUp, fetchStatus: signUpStatus } = useSignUp();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [step, setStep] = useState<'credentials' | 'verify'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const busy = signInStatus === 'fetching' || signUpStatus === 'fetching';

  const finish = async (finalize: (options?: { navigate?: (...args: never[]) => void }) => Promise<unknown>) => {
    await finalize({ navigate: () => router.replace('/') });
  };

  const submit = async () => {
    setMessage('');
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setMessage('Enter your email and password.');
      return;
    }

    if (mode === 'signup') {
      const result = await signUp.password({ emailAddress: cleanEmail, password });
      if (result.error) {
        setMessage(errorText(result.error));
        return;
      }
      if (signUp.status === 'complete') {
        await finish(signUp.finalize as never);
        return;
      }
      if (signUp.unverifiedFields?.includes('email_address')) {
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) {
          setMessage(errorText(sent.error));
          return;
        }
        setStep('verify');
        return;
      }
      setMessage('Your account needs another verification step. Check your email or contact support.');
      return;
    }

    const result = await signIn.password({ emailAddress: cleanEmail, password });
    if (result.error) {
      const codeValue = (result.error as { errors?: Array<{ code?: string }> }).errors?.[0]?.code;
      if (codeValue === 'form_identifier_not_found') {
        setMessage('No account found with this email. Switch to Create account to register.');
      } else {
        setMessage(errorText(result.error));
      }
      return;
    }
    if (signIn.status === 'complete') {
      await finish(signIn.finalize as never);
    } else {
      setMessage('This account requires an additional verification step. Multi-factor sign-in will be enabled in the next auth pass.');
    }
  };

  const verifyEmail = async () => {
    setMessage('');
    if (!/^\d{6}$/.test(code.trim())) {
      setMessage('Enter the six-digit code sent to your email.');
      return;
    }
    const result = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (result.error) {
      setMessage(errorText(result.error));
      return;
    }
    if (signUp.status === 'complete') {
      await finish(signUp.finalize as never);
    } else {
      setMessage('Email verified, but the account still needs another step.');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brandMark}><Text style={styles.brandLetter}>M</Text></View>
        <Text style={styles.eyebrow}>YOUR FINANCIAL COMMAND CENTER</Text>
        <Text style={styles.title}>{step === 'verify' ? 'Check your inbox.' : mode === 'signin' ? 'Welcome back.' : 'Create your Monetra.'}</Text>
        <Text style={styles.subtitle}>
          {step === 'verify'
            ? `We sent a verification code to ${email.trim()}.`
            : 'One account. Your Personal, Family and Business finances.'}
        </Text>

        <View style={styles.card}>
          {step === 'credentials' ? (
            <>
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={theme.colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
              />
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={theme.colors.muted}
                secureTextEntry
                autoComplete={mode === 'signup' ? 'new-password' : 'password'}
                style={styles.input}
              />
              <Pressable disabled={busy} onPress={submit} style={({ pressed }) => [styles.primary, pressed && styles.pressed, busy && styles.disabled]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'signin' ? 'Sign in securely' : 'Create account'}</Text>}
              </Pressable>
              <Pressable onPress={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage(''); }}>
                <Text style={styles.switchText}>{mode === 'signin' ? "New to Monetra?  Create an account" : 'Already have an account?  Sign in'}</Text>
              </Pressable>
              <View nativeID="clerk-captcha" />
            </>
          ) : (
            <>
              <Text style={styles.label}>EMAIL VERIFICATION CODE</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={theme.colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                style={styles.input}
              />
              <Pressable disabled={busy} onPress={verifyEmail} style={[styles.primary, busy && styles.disabled]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Verify and continue</Text>}
              </Pressable>
              <Pressable onPress={() => { setStep('credentials'); setMode('signup'); setMessage(''); }}>
                <Text style={styles.switchText}>Back to account details</Text>
              </Pressable>
            </>
          )}
          {!!message && <Text accessibilityRole="alert" style={styles.error}>{message}</Text>}
        </View>
        <Text style={styles.footer}>PRIVATE BY DESIGN  ·  BUILT FOR CLARITY</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 56, paddingBottom: 40 },
  brandMark: { width: 54, height: 54, borderRadius: 17, backgroundColor: theme.colors.greenDeep, alignItems: 'center', justifyContent: 'center', marginBottom: 26 },
  brandLetter: { color: '#fff', fontSize: 29, fontWeight: '800', letterSpacing: -2 },
  eyebrow: { color: theme.colors.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.7, marginBottom: 12 },
  title: { color: theme.colors.text, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1.2 },
  subtitle: { color: theme.colors.muted, fontSize: 14, lineHeight: 22, marginTop: 10, marginBottom: 28, maxWidth: 310 },
  card: { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderWidth: 1, borderRadius: 22, padding: 20 },
  label: { color: theme.colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 9, marginTop: 8 },
  input: { minHeight: 52, borderRadius: 13, backgroundColor: theme.colors.surfaceSoft, borderWidth: 1, borderColor: theme.colors.line, paddingHorizontal: 14, color: theme.colors.text, fontSize: 15, marginBottom: 14 },
  primary: { minHeight: 52, borderRadius: 13, backgroundColor: theme.colors.greenDeep, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.86 },
  disabled: { opacity: 0.6 },
  switchText: { color: theme.colors.green, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: 17 },
  error: { color: theme.colors.danger, fontSize: 12, lineHeight: 18, marginTop: 4 },
  footer: { color: theme.colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.3, textAlign: 'center', marginTop: 30 },
});