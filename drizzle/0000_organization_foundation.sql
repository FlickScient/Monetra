CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization_type text NOT NULL CHECK (organization_type IN ('personal', 'family', 'business')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX organizations_one_personal_per_creator_idx
  ON organizations(created_by) WHERE organization_type = 'personal';

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'administrator', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_org_user_unique UNIQUE (organization_id, user_id)
);

CREATE INDEX organization_members_user_idx ON organization_members(user_id);

-- Build a stable one-to-one mapping from every existing Clerk user to a
-- Personal organization before adding NOT NULL organization ownership.
CREATE TEMP TABLE _monetra_user_org_map (
  user_id text PRIMARY KEY,
  organization_id uuid NOT NULL
) ON COMMIT DROP;

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

INSERT INTO _monetra_user_org_map (user_id, organization_id)
SELECT created_by, id FROM organizations WHERE organization_type = 'personal';

INSERT INTO organization_members (organization_id, user_id, role)
SELECT organization_id, user_id, 'owner' FROM _monetra_user_org_map
ON CONFLICT (organization_id, user_id) DO NOTHING;

ALTER TABLE wallets ADD COLUMN organization_id uuid;
ALTER TABLE categories ADD COLUMN organization_id uuid;
ALTER TABLE transactions ADD COLUMN organization_id uuid;
ALTER TABLE ledger_accounts ADD COLUMN organization_id uuid;
ALTER TABLE ledger_entries ADD COLUMN organization_id uuid;

UPDATE wallets AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
UPDATE categories AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
UPDATE transactions AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
UPDATE ledger_accounts AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;
UPDATE ledger_entries AS record SET organization_id = mapping.organization_id
FROM _monetra_user_org_map AS mapping WHERE record.user_id = mapping.user_id;

ALTER TABLE wallets ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ledger_accounts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE ledger_entries ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE wallets ADD CONSTRAINT wallets_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE categories ADD CONSTRAINT categories_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE transactions ADD CONSTRAINT transactions_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(id);

CREATE INDEX wallets_organization_idx ON wallets(organization_id);
CREATE INDEX categories_organization_idx ON categories(organization_id);
CREATE INDEX transactions_organization_date_idx ON transactions(organization_id, occurred_at);
CREATE INDEX ledger_accounts_organization_idx ON ledger_accounts(organization_id);
CREATE INDEX ledger_entries_organization_idx ON ledger_entries(organization_id);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);
