# Fiscus AI Supabase backend

This is an isolated Supabase CLI workdir for Monetra's Fiscus AI backend.

## Important isolation rule

The repository already contains a legacy root-level \`supabase/migrations\` directory with old Monetra finance migrations. **Do not deploy that directory to the Fiscus AI Supabase project.** All Fiscus database changes and Edge Functions live under this isolated \`fiscus-supabase/supabase\` directory.

Run Supabase CLI commands from the repository root with \`--workdir fiscus-supabase\`. Never run a plain root-level \`supabase db push\` for this project.

## Architecture

- Clerk remains the identity provider.
- Neon remains the only financial database.
- Vercel remains the authenticated Monetra API and finance-context provider.
- Supabase stores Fiscus conversations, approved memories, preferences, prompt versions, runtime configuration and AI usage logs.
- Supabase Edge Function \`fiscus-chat\` orchestrates Gemini requests.
- The browser never receives a Supabase secret key or Gemini API key.

The existing Vercel route authenticates the Clerk session and validates workspace ownership with Monetra's existing \`getWorkspaceContext\`. It forwards the Clerk session JWT and a short-lived HMAC-signed request to the Edge Function. The Edge Function requires both a Clerk JWT accepted by Supabase's native Clerk third-party integration and the HMAC signature from Vercel.

The Edge Function creates a short-lived workspace access grant after the Vercel request has passed the existing workspace ownership check. RLS uses the verified Clerk \`sub\` claim and this short-lived grant. Workspace IDs are never trusted from the browser by themselves.

## Required dashboard setup

1. In Clerk Dashboard, activate the native Supabase integration (not the deprecated JWT-template integration) and copy the Clerk domain.
2. In Supabase Dashboard, add Clerk under Authentication → Sign In / Providers → Third-party Auth and enter the Clerk domain. Confirm Clerk session tokens contain the \`role: authenticated\` claim.
3. In Supabase API settings, add \`fiscus\` to the exposed schemas. The local config also declares it.
4. Confirm the project has a publishable key and a server-side secret key. Do not put the secret key in Vercel's public environment variables.

## Deploy the isolated project

Install the Supabase CLI, authenticate, and link this workdir to the Fiscus AI project:

- \`supabase --workdir fiscus-supabase login\`
- \`supabase --workdir fiscus-supabase link --project-ref YOUR_PROJECT_REF\`
- Review the pending migration before applying it.
- \`supabase --workdir fiscus-supabase db push\`
- \`supabase --workdir fiscus-supabase functions deploy fiscus-chat\`

The migration creates only the \`fiscus\` schema. It does not touch Neon or the legacy root-level Supabase migration history.

## Edge Function secrets

Set these in the Fiscus Supabase project (never commit values):

- \`GEMINI_API_KEY\`
- \`FISCUS_EDGE_SHARED_SECRET\` — generate a random secret of at least 32 bytes; use the same value in Vercel.
- \`SUPABASE_PUBLISHABLE_KEY\` (or \`SUPABASE_ANON_KEY\`) if the runtime does not provide it automatically.
- \`SUPABASE_SECRET_KEY\` (or the platform-provided \`SUPABASE_SERVICE_ROLE_KEY\`) for server-only privileged operations.

Supabase normally provides \`SUPABASE_URL\`, \`SUPABASE_ANON_KEY\` and \`SUPABASE_SERVICE_ROLE_KEY\` to Edge Functions. The function supports the newer publishable/secret key names as overrides.

## Vercel environment variables

Set these for the Monetra server runtime:

- \`SUPABASE_URL\`
- \`SUPABASE_PUBLISHABLE_KEY\` (or \`SUPABASE_ANON_KEY\`)
- \`FISCUS_EDGE_SHARED_SECRET\` — exactly the same secret as the Edge Function.

Keep the existing \`GEMINI_API_KEY\` in Vercel until the Supabase function is deployed and a real end-to-end request succeeds. After successful cutover, it can be removed from Vercel if no other route uses it.

## Data and privacy

- Conversation and message rows are protected by RLS using the Clerk subject and short-lived verified workspace access.
- Memories default to disabled and only explicitly approved memories are included in AI context.
- Prompt versions and runtime configuration are not readable or writable by ordinary authenticated users.
- Usage logs contain model, status, latency and token counts, not raw prompts or financial context.
- Service credentials are only used inside the Edge Function.
- The function is read-only with respect to Neon finance data. It receives a minimized context assembled by Monetra's authenticated Vercel route.

## Operational notes

- The current UI has one active conversation per user/workspace. The backend persists it and can restore or clear it.
- Primary/fallback model identifiers are seeded from the existing Monetra AI route defaults. Verify both model IDs are enabled for the Google project before production use.
- Do not enable admin prompt editing until a server-side Clerk admin allowlist and audit path are implemented.
- Do not deploy or merge until Clerk third-party auth, Supabase secrets, Vercel environment variables and the migration target have been verified.
