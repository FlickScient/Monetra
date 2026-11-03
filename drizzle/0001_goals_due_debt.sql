CREATE TABLE savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  target_minor bigint NOT NULL CHECK (target_minor > 0),
  currency text NOT NULL DEFAULT 'BDT' CHECK (currency ~ '^[A-Z]{3}$'),
  target_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX savings_goals_organization_idx ON savings_goals(organization_id, created_at);
--> statement-breakpoint

CREATE TABLE goal_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_allocations_goal_wallet_unique UNIQUE (goal_id, wallet_id)
);
--> statement-breakpoint
CREATE INDEX goal_allocations_organization_idx ON goal_allocations(organization_id);
--> statement-breakpoint

CREATE TABLE goal_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('allocate', 'release')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX goal_allocation_events_organization_idx ON goal_allocation_events(organization_id, created_at);
--> statement-breakpoint

CREATE TABLE due_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('receivable', 'payable')),
  counterparty_name text NOT NULL CHECK (length(trim(counterparty_name)) BETWEEN 1 AND 120),
  principal_minor bigint NOT NULL CHECK (principal_minor > 0),
  currency text NOT NULL DEFAULT 'BDT' CHECK (currency ~ '^[A-Z]{3}$'),
  annual_rate_bps integer NOT NULL DEFAULT 0 CHECK (annual_rate_bps >= 0),
  due_date date,
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_settled', 'settled', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX due_debts_organization_idx ON due_debts(organization_id, created_at);
--> statement-breakpoint

CREATE TABLE due_debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  due_debt_id uuid NOT NULL REFERENCES due_debts(id) ON DELETE RESTRICT,
  user_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  payment_method text,
  note text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT due_debt_payments_idempotency_unique UNIQUE (organization_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX due_debt_payments_organization_idx ON due_debt_payments(organization_id, created_at);
--> statement-breakpoint
CREATE INDEX due_debt_payments_debt_idx ON due_debt_payments(due_debt_id, paid_at);
