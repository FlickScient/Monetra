# Fiscus AI Supabase backend

This is an isolated Supabase CLI workdir for Monetra's Fiscus AI backend.

## Important isolation rule

The repository already contains a legacy root-level `supabase/migrations` directory with old Monetra finance migrations. **Do not deploy that directory to the Fiscus AI Supabase project.** All Fiscus database changes and Edge Functions live under this isolated `fiscus-supabase/supabase` directory.

Run Supabase CLI commands from the repository root with `--workdir fiscus-supabase`. Never run a plain root-level `supabase db push` for this project.

## Architecture

- Clerk remains the identity provider.
- Neon remains the only financial database.
- Vercel remains the Monetra frontend and finance-context provider.
- Supabase stores Fiscus conversations, approved memories, preferences, prompt versions, runtime configuration and AI usage logs.
- Supabase Edge Function `fiscus-chat` runs AI orchestration and calls Gemini.
- The browser calls the Edge Function directly using its Clerk session JWT and a Supabase publishable key.
- The Edge Function retrieves financial context from a private Vercel endpoint. That endpoint is excluded from Clerk cookie middleware but accepts only a timestamped HMAC-signed request from the Edge Function, then independently verifies that the Clerk user owns the requested Neon workspace.
- The Edge Function creates a short-lived workspace access grant only after Vercel confirms workspace ownership. RLS uses the verified Clerk `sub` claim and this short-lived grant.

The browser never receives a Supabase secret key, HMAC secret or Gemini API key.

## Required dashboard setup

1. In Clerk Dashboard, activate the native Supabase integration (not the deprecated JWT-template integration) and copy the Clerk domain.
2. In Supabase Dashboard, add Clerk under Authentication → Sign In / Providers → Third-party Auth and enter the Clerk domain. Confirm Clerk session tokens contain the `role: authenticated` claim.
3. In Supabase API settings, add `fiscus` to the exposed schemas. The local config also declares it.
4. Confirm the project has a publishable key and a server-side secret key. Never expose the secret key.

## Deploy the isolated project

Install the Supabase CLI, authenticate, and link this workdir to the Fiscus AI project:

- `supabase --workdir fiscus-supabase login`
- `supabase --workdir fiscus-supabase link --project-ref YOUR_PROJECT_REF`
- Review the pending migration before applying it.
- `supabase --workdir fiscus-supabase db push`
- `supabase --workdir fiscus-supabase functions deploy fiscus-chat`

The migration creates only the `fiscus` schema. It does not touch Neon or the legacy root-level Supabase migration history.

## Supabase Edge Function secrets

Set these in the Fiscus Supabase project (never commit values):

- `GEMINI_API_KEY`
- `FISCUS_EDGE_SHARED_SECRET` — generate a random secret of at least 32 bytes; use the same value in Vercel.
- `MONETRA_CONTEXT_URL` — the Monetra Vercel origin, for example `https://monetra-4rax.vercel.app`.
- `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`) if the runtime does not provide it automatically.
- `SUPABASE_SECRET_KEY` (or the platform-provided `SUPABASE_SERVICE_ROLE_KEY`) for server-only privileged operations.

Supabase normally provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. The function supports the newer publishable/secret key names as overrides.

## Vercel environment variables

Set these for the Monetra application:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `FISCUS_EDGE_SHARED_SECRET` — exactly the same secret as the Edge Function. This variable must remain server-only; do not prefix it with `NEXT_PUBLIC_`.

The existing `GEMINI_API_KEY` can remain in Vercel during the transition. Once the Supabase function is deployed and the new flow is verified, remove it from Vercel if no other route uses it.

## Live project values

- Supabase project ref: `osfitgjwkjhhexgcazwj`
- Supabase URL: `https://osfitgjwkjhhexgcazwj.supabase.co`
- Edge Function: `https://osfitgjwkjhhexgcazwj.supabase.co/functions/v1/fiscus-chat`
- The database migrations and Edge Function have been applied/deployed to this project. The function is deployed with JWT verification enabled.

## Dashboard-only configuration still required

The management connection can deploy migrations and functions, but the remaining provider/environment settings must be completed in the dashboards:

1. **Supabase → Project Settings → API → Exposed schemas:** add `fiscus` (keep existing schemas).
2. **Supabase → Authentication → Sign In / Providers → Third-party Auth:** add Clerk using the Clerk domain. Use Clerk's native Supabase integration and ensure session tokens include `role: authenticated`.
3. **Supabase → Edge Functions → Secrets:** set `GEMINI_API_KEY`, `FISCUS_EDGE_SHARED_SECRET`, and `MONETRA_CONTEXT_URL`. The shared secret must be a random value of at least 32 bytes and must exactly match the Vercel value. Do not paste secrets into GitHub or chat.
4. **Vercel → Project → Settings → Environment Variables:** set `NEXT_PUBLIC_SUPABASE_URL=https://osfitgjwkjhhexgcazwj.supabase.co`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the project's publishable key, and `FISCUS_EDGE_SHARED_SECRET` to the same value used in Supabase. Apply to the production environment and redeploy after the code is merged.
5. **Vercel:** set `MONETRA_CONTEXT_URL` in Supabase to the exact production origin of this app (no trailing slash).

## Prompt and runtime operations

Prompt versions and runtime configuration are intentionally private and service-role-only. Manage them through the Supabase SQL editor or a future admin-only interface; do not grant ordinary users access.

Example: switch the active prompt in a transaction (replace the prompt text and version first):

```sql
begin;
update fiscus.prompt_versions set status = 'archived' where status = 'active';
insert into fiscus.prompt_versions (version, prompt, status, created_by, activated_at)
values ('1.1', 'PASTE THE NEW SYSTEM PROMPT HERE', 'active', 'admin', now());
commit;
```

Example: inspect recent usage without exposing prompts or financial context:

```sql
select created_at, clerk_user_id, workspace_id, model, status,
       latency_ms, input_tokens, output_tokens, fallback_used, error_code
from fiscus.ai_usage_logs
order by created_at desc
limit 100;
```

Example: change the model routing:

```sql
update fiscus.runtime_config
set primary_model = 'gemini-3.5-flash-lite',
    fallback_model = 'gemini-3.1-flash-lite',
    updated_by = 'admin',
    updated_at = now()
where id = 'default';
```

## Data and privacy

- Conversation and message rows are protected by RLS using the Clerk subject and short-lived verified workspace access.
- The internal Vercel context endpoint verifies workspace ownership directly against Neon before returning financial context.
- Memories default to disabled and only explicitly approved memories are included in AI context.
- Prompt versions and runtime configuration are not readable or writable by ordinary authenticated users.
- Usage logs contain model, status, latency and token counts, not raw prompts or financial context.
- Service credentials and Gemini credentials are only used inside the Edge Function.
- The function is read-only with respect to Neon finance data.

## Operational notes

- The current UI has one active conversation per user/workspace. The backend persists it and can restore or clear it.
- Primary/fallback model identifiers are seeded from the existing Monetra AI route defaults. Verify both model IDs are enabled for the Google project before production use.
- Prompt and runtime configuration are initially managed through the Supabase dashboard/SQL editor. Do not enable public prompt editing; an admin-only management API and audit UI are a separate follow-up.
- The Vercel context endpoint is intentionally excluded from Clerk cookie middleware. Its HMAC signature check is mandatory and must never be removed.
- Do not deploy or merge until Clerk third-party auth, Supabase secrets, Vercel environment variables and the migration target have been verified.
