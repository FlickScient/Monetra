# Monetra Android app bundle

This is a separate, bundled Capacitor application. It does not load the production website as its UI.

## Build prerequisites

- Node.js 20+
- Java 21
- Android SDK
- `VITE_CLERK_PUBLISHABLE_KEY` (public Clerk publishable key)
- `VITE_MONETRA_API_URL` (defaults to https://monetra-4rax.vercel.app)

## Build

```bash
npm ci
npm install --no-save vite@6 @vitejs/plugin-react@4
npm run build:native
npx cap add android
npx cap sync android
cd android-native
./gradlew assembleDebug
```

The debug APK is generated at `android-native/app/build/outputs/apk/debug/app-debug.apk`.

## Clerk configuration required

Add `capacitor://localhost` and `https://localhost` to the Clerk instance's allowed origins. The Vercel middleware also explicitly allows these origins for API CORS. Native API requests use short-lived Clerk session bearer tokens; the secret key is never bundled into the app.

The first online sign-in downloads the selected workspace and asks the user to create a six-digit local unlock PIN. Offline launch requires that PIN. The PIN is PBKDF2-hashed and stored inside the encrypted local SQLite database; it is never sent to the server.
