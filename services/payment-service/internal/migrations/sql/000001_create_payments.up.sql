-- Payments simulated by payment-service. Amounts are integer minor units with an ISO 4217 code.
-- Every write carries an idempotency key, unique per user.
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  scenario text not null check (scenario in ('success', 'declined', 'timeout', 'insufficient_funds')),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index payments_user_id_created_at_idx on payments (user_id, created_at desc);
