CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization_type text NOT NULL CHECK (organization_type IN ('personal', 'family', 'business')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX organizations_one_personal_per_creator_idx
  ON organizations(created_by) WHERE organization_type = 'personal';
--> statement-breakpoint

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'administrator', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_org_user_unique UNIQUE (organization_id, user_id)
);
--> statement-breakpoint

CREATE INDEX organization_members_user_idx ON organization_members(user_id);
--> statement-breakpoint
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator', 'editor', 'viewer')),
  token_hash text NOT NULL,
  invited_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX invitations_token_hash_unique ON invitations(token_hash);
--> statement-breakpoint
CREATE INDEX invitations_organization_idx ON invitations(organization_id);
--> statement-breakpoint

-- Build a stable one-to-one mapping from every existing Clerk user to a
-- Personal organization before adding NOT NULL organization ownership.
CREATE TEMP TABLE _monetra_user_org_map (
  user_id text PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint

INSERT INTO organizations (name, organization_type, created_by)
SELECT 'Personal', 'personal', users.user_id
FROM (
  SELECT id AS user_id FROM profiles
  UNION SELECT user_id FROM wallets
  UNION SELECT user_id FROM categories
  UNION SELECT user_id FROM transactions
  UNION SELECT user_id FROM ledger_accounts
  UNION SELECT user_id FROM ledger_entries
) AS users
WHERE users.user_id IS NOT NULL
ON CONFLICT (created_by) WHERE organization_type = 'personal' DO NOTHING;
--> statement-breakpoint

INSERT INTO _monetra_user_org_map (user_id, organization_id)
SELECT created_by, id FROM organizations WHERE organization_type = 'personal';
--> statement-breakpoint

INSERT INTO organization_members (organization_id, user_id, role)
SELECT organization_id, user_id, 'owner' FROM _monetra_user_org_map
ON CONFLICT (organization_id, user_id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE wallets ADD COLUMN organization_id uuid;
--> statement-breakpoint
ALTER TABLE categories ADD COLUMN organization_id uuid;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN organization_id uuid;
--> statement-breakpoint
ALTER TABLE ledger_accounts ADD COLUMN organization_id uuid;
--> statement-breakpoint
ALTER TABLE ledger_entries ADD COLUMN organization_id uuid;
--> statement-breakpoint

UPDATE wallets AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
--> statement-breakpoint
UPDATE categories AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
--> statement-breakpoint
UPDATE transactions AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
--> statement-breakpoint
UPDATE ledger_accounts AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
--> statement-breakpoint
UPDATE ledger_entries AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
--> statement-breakpoint

ALTER TABLE wallets ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE categories ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE transactions ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE ledger_accounts ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE ledger_entries ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint

ALTER TABLE wallets ADD CONSTRAINT wallets_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
--> statement-breakpoint
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
--> statement-breakpoint

CREATE INDEX wallets_organization_idx ON wallets(organization_id);
--> statement-breakpoint
CREATE INDEX categories_organization_idx ON categories(organization_id);
--> statement-breakpoint
CREATE INDEX transactions_organization_date_idx ON transactions(organization_id, occurred_at);
--> statement-breakpoint
CREATE INDEX ledger_accounts_organization_idx ON ledger_accounts(organization_id);
--> statement-breakpoint
CREATE INDEX ledger_entries_organization_idx ON ledger_entries(organization_id);
--> statement-breakpoint
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);
