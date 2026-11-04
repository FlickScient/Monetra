CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  workspace_type text NOT NULL CHECK (workspace_type IN ('personal', 'family', 'business')),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_user_type_unique UNIQUE (user_id, workspace_type)
);
--> statement-breakpoint
CREATE INDEX workspaces_user_idx ON workspaces(user_id);
--> statement-breakpoint
-- Preserve the existing owner's workspace labels while establishing the
-- canonical three-workspace set. Legacy organization tables remain untouched.
INSERT INTO workspaces (user_id, workspace_type, name)
SELECT created_by, organization_type, name
FROM organizations
WHERE organization_type IN ('personal', 'family', 'business')
ON CONFLICT (user_id, workspace_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO workspaces (user_id, workspace_type, name)
SELECT p.id, types.workspace_type,
       CASE types.workspace_type
         WHEN 'personal' THEN 'Personal'
         WHEN 'family' THEN 'Family'
         ELSE 'Business'
       END
FROM profiles p
CROSS JOIN (VALUES ('personal'), ('family'), ('business')) AS types(workspace_type)
ON CONFLICT (user_id, workspace_type) DO NOTHING;
