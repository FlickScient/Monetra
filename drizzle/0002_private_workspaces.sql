-- Idempotently ensure all profile owners have the canonical three private workspaces.
INSERT INTO workspaces (user_id, workspace_type, name)
SELECT p.id::text, types.workspace_type,
       CASE types.workspace_type
         WHEN 'personal' THEN 'Personal'
         WHEN 'family' THEN 'Family'
         ELSE 'Business'
       END
FROM profiles p
CROSS JOIN (VALUES ('personal'), ('family'), ('business')) AS types(workspace_type)
ON CONFLICT (user_id, workspace_type) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM profiles p
    WHERE (SELECT count(*) FROM workspaces w WHERE w.user_id = p.id::text) <> 3
  ) THEN
    RAISE EXCEPTION 'Workspace defaults stopped: one or more profile owners do not have exactly three workspaces.';
  END IF;
END $$;
