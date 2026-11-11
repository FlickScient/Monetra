-- Fiscus AI persistence on Neon. Additive only: does not modify finance tables.
CREATE TABLE IF NOT EXISTS fiscus_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscus_conversations_owner_recent_idx
  ON fiscus_conversations (clerk_user_id, workspace_id, last_message_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS fiscus_conversations_one_active_idx
  ON fiscus_conversations (clerk_user_id, workspace_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS fiscus_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES fiscus_conversations(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 12000),
  model text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscus_messages_conversation_created_idx
  ON fiscus_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS fiscus_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('preference', 'goal', 'context')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1200),
  user_approved boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'user',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscus_memories_owner_updated_idx
  ON fiscus_memories (clerk_user_id, workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS fiscus_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES fiscus_conversations(id) ON DELETE CASCADE,
  summary text NOT NULL,
  through_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiscus_summaries_conversation_unique UNIQUE (conversation_id)
);

CREATE TABLE IF NOT EXISTS fiscus_preferences (
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memory_enabled boolean NOT NULL DEFAULT true,
  locale text NOT NULL DEFAULT 'en',
  currency text NOT NULL DEFAULT 'BDT',
  response_style text NOT NULL DEFAULT 'balanced' CHECK (response_style IN ('concise', 'balanced', 'detailed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clerk_user_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS fiscus_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid,
  provider text NOT NULL DEFAULT 'gemini',
  model text,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  fallback_used boolean NOT NULL DEFAULT false,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fiscus_usage_owner_recent_idx
  ON fiscus_usage_logs (clerk_user_id, workspace_id, created_at DESC);
