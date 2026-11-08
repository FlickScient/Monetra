import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import Constants from 'expo-constants';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/src/theme';

const publishableKey =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
  (Constants.expoConfig?.extra?.clerkPublishableKey as string | undefined) ??
  'pk_test_bm90YWJsZS1oZXJvbi02MDYuY2xlcmsuYWNjb3VudHMuZGV2JA';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorRoot}>
      <Text style={styles.errorTitle}>Monetra couldn’t open</Text>
      <Text style={styles.errorMessage}>{error.message || 'An unexpected startup error occurred.'}</Text>
      <Pressable onPress={retry} style={styles.retryButton}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  errorRoot: { flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center', padding: 28 },
  errorTitle: { color: theme.colors.text, fontSize: 24, fontWeight: '800' },
  errorMessage: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 12 },
  retryButton: { marginTop: 22, backgroundColor: theme.colors.greenDeep, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  retryText: { color: '#fff', fontWeight: '800' },
});
