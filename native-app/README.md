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


## Signed release APK (GitHub Actions)

The repository includes `.github/workflows/android-release.yml`. It builds a release APK, signs it with Android `apksigner`, verifies the signature, and uploads `Monetra-release-signed.apk`.

Before building any APK, add these repository Actions secrets (the debug and release workflows both require them):

- `VITE_CLERK_PUBLISHABLE_KEY`: the real Clerk publishable key for the Monetra production instance.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the Fiscus Supabase project's publishable key (safe to bundle in the client app).

For a **signed release APK**, also add:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded contents of your release JKS/keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: keystore password.
- `ANDROID_KEY_ALIAS`: signing key alias.
- `ANDROID_KEY_PASSWORD`: signing key password.

Keep the keystore and passwords private. Back up the keystore securely: future Android updates must be signed with the same app-signing identity. The workflow intentionally fails instead of producing a misleading unsigned "release" APK when any required secret is missing.

The native app includes Fiscus chat. Its Supabase project URL is fixed to the configured Fiscus project, and only the public publishable key is supplied to the Vite build as `VITE_SUPABASE_PUBLISHABLE_KEY`; do not use the Supabase secret/service-role key in the app.

The existing pull-request workflow produces a **debug** APK only. A successful debug build does not mean release signing, Clerk production login, or on-device offline behavior has been verified.

## Finance sync service

The Android debug build is produced by the repository's `Monetra Android Build` GitHub Actions workflow on pull requests.

The Android client uses the production Monetra API at `https://monetra-4rax.vercel.app` for authenticated bootstrap, incremental changes, and queued offline writes. These routes are deployed by the main web application; do not point the APK at a preview deployment.
