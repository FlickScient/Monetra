# Monetra Android

Native Android client built with React Native + Expo. This is not a WebView wrapper.

## Configure

1. Copy `.env.example` to `.env`.
2. Set `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` to the same Clerk instance used by the website.
3. Set `EXPO_PUBLIC_MONETRA_API_URL` to the deployed Monetra website origin (no trailing slash).
4. Set the Fiscus Edge Function URL and Supabase publishable key.
5. Ensure Clerk Native API is enabled in the Clerk dashboard.
6. Install dependencies with `npm install` from this directory.

## Build a standalone Android APK

The GitHub Actions workflow `.github/workflows/android-apk.yml` validates TypeScript, generates the native Android project and builds an installable debug APK. Run it manually from Actions or push a change to `android-native`. Download the artifact named `monetra-android-debug-apk` from the completed workflow.

For a signed production release, configure EAS credentials and use:

```sh
npx eas-cli build --platform android --profile production
```

Clerk's native components require a development/native build; Expo Go is not supported.

## Offline model

- SQLite caches a per-user, per-workspace bootstrap snapshot and sync cursor.
- Cached workspaces are isolated by Clerk user ID and workspace ID.
- On reconnect, pending operations are pushed with their original operation IDs, then the incremental change feed is pulled.
- The current backend push endpoint supports transaction creation, transfers, and debt payments only. Other mutation types must not be queued until matching validated server handlers exist.
- Fiscus conversations are cached locally; its AI response generation still requires internet. Approved memory settings and records are managed through the existing workspace-scoped Fiscus backend.

## Current implementation scope

The current native screens cover authentication, cached overview, wallet listing, recent activity, and a Fiscus chat/history/memory surface. This is a first native implementation milestone, not yet a feature-complete replacement for every website workflow. Editing/deleting transactions, reports, budgets, savings goals, debt management, settings and complete offline mutation coverage still require porting and device testing against the website.
