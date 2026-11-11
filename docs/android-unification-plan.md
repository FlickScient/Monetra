# Android app unification plan

## Goal

Make the Android APK present the same Monetra product as the production website, while retaining native offline access. The website remains the source of truth for product UI and finance business rules; the Android app adds a native offline capability layer.

## Repository facts

- The website is a Next.js application. Its main finance experience is currently implemented in `app/page.tsx`, with UI modules under `components/monetra`.
- The website root layout uses `@clerk/nextjs` in `app/layout.tsx`.
- The Android app is a separate Vite/React entry point at `native-app/src/main.tsx` and `native-app/src/App.tsx`, using `capacitor-clerk`.
- Capacitor builds the native app from `native/www`; `native-app/vite.config.ts` currently builds that separate native UI.
- The website uses server-side Next.js route handlers and browser fetches. The website page cannot simply be copied into the Vite entry point: it imports Next Clerk hooks and relies on the Next.js runtime and API routes.

## Chosen direction

Do not maintain a second, feature-reduced finance UI long-term. Reuse the website's actual UI modules and product behavior, and keep only the platform-specific shell separate.

The integration should be incremental and reversible:

1. **Shared UI and domain extraction**
   - Identify the website's page-level UI, shared components, hooks, types and data contracts.
   - Move reusable presentation and client-side domain logic into shared modules that both Next.js and the Android entry point can consume.
   - Replace Next-only imports in shared modules with small platform adapters (auth, navigation, storage, dialogs, downloads and API access).
   - Keep Next.js server routes and server-only code in the website runtime.

2. **Android web/runtime adapter**
   - Use the same website design system, page components, navigation, charts, forms and transitions in the Android build.
   - Provide a Clerk adapter that uses the existing supported Android authentication flow while exposing the same signed-in user/session contract to shared UI.
   - Keep Capacitor-specific back-button, status-bar, safe-area and native lifecycle handling in the Android shell.

3. **One finance data contract**
   - Reuse the existing authenticated finance API and workspace scoping.
   - Make the Android sync/bootstrap process hydrate all required entities from the existing website account.
   - Add explicit full-snapshot reconciliation for incomplete local caches without deleting pending local writes.
   - Keep idempotent push/pull cursors and conflict handling; never reset SQLite or overwrite pending offline operations during bootstrap.

4. **Offline capability**
   - Cache the application shell and required assets for offline launch.
   - Continue storing finance data in the existing SQLite vault protected by the six-digit PIN.
   - Route shared UI data operations through a repository interface: online API when connected, local SQLite plus queued writes when offline.
   - On reconnect, synchronize queued writes safely and refresh the shared UI.

5. **Validation and release**
   - Test all website navigation sections and primary interactions in Android.
   - Verify Personal, Family and Business workspace switching.
   - Compare wallets, categories, transactions, balances, debt, reports and analytics against the website.
   - Test online login, sign-up, session restoration, PIN setup/unlock, airplane-mode launch, reconnect and conflict recovery.
   - Build and distribute a new APK only after tests pass. Do not merge to production or replace the user's installed APK as part of the development work.

## Important constraints

- Do not point the packaged app at a remote website using Capacitor `server.url` as the final architecture. That would make the UI depend on a network request at launch and would not provide a reliable offline app shell.
- Do not blindly copy the Next.js page into Vite. Next-specific imports and server runtime dependencies must be adapted first.
- Do not remove the existing native authentication, SQLite, PIN or sync implementation until equivalent behavior has been implemented and tested.
- Do not perform destructive database migrations, clear local app data, reset SQLite, or discard queued offline writes.
- Keep all changes on `feat/unified-monetra-android` until the complete integration has been reviewed and explicitly approved for release.
