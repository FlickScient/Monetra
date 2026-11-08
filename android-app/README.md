# Monetra Native Android

A separate React Native / Expo application. It is not a WebView and does not embed the website.

## Current milestone

- Native Clerk email/password sign-in and sign-up with email verification.
- Secure Clerk token persistence through the official Expo token cache.
- Native workspace discovery through the existing Monetra API.
- Production website UI and data are not modified by this app directory.

## Local setup

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the Clerk publishable key.
3. Keep the Clerk Secret Key out of this app. The app never connects directly to Neon.
4. Enable Clerk Dashboard → Native applications for this Clerk instance.
5. Install dependencies with `npx expo install` and run `npx expo run:android`.

## Package identity

The native app uses `com.flickscient.monetra.native` so it can be installed alongside earlier Monetra test APKs without Android package/signature conflicts.

## Planned milestones

1. Authentication and workspace discovery.
2. Bearer-token compatibility for all existing finance API routes, then dashboard/wallet/transaction data.
3. Native implementations of every website module.
4. SQLite offline cache, queued writes, idempotent sync and conflict handling.
5. Android build, installation and real-device verification.

No finance records are stored in this app until the authenticated API and local cache layers are implemented and tested.