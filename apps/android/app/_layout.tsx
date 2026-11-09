import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Stack } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout() {
  if (!publishableKey) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 28, backgroundColor: "#F4F3EC" }}>
        <Text style={{ color: "#20251D", fontSize: 22, fontWeight: "700" }}>Monetra setup required</Text>
        <Text style={{ color: "#697064", marginTop: 10, lineHeight: 22 }}>
          Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to apps/android/.env, then rebuild the Android app.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#F4F3EC" } }} />
    </ClerkProvider>
  );
}
