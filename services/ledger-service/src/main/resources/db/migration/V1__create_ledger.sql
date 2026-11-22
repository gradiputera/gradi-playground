-- Ledger core (ADR 0006): chart of accounts, journal entries and their lines.
-- Amounts are integer minor units; the currency is set once per entry (ISO 4217).

create table accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense'))
);

insert into accounts (code, name, type) values
  ('1000', 'Cash', 'asset'),
  ('1100', 'Settlement Receivable', 'asset'),
  ('2000', 'Customer Funds', 'liability'),
  ('4000', 'Fee Revenue', 'revenue'),
  ('5000', 'Processing Expense', 'expense');

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 255),
  kind text not null check (kind in ('opening', 'payment', 'reversal')),
  payment_id uuid,
  reverses_entry_id uuid references journal_entries (id) on delete cascade,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  posted_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check ((kind = 'reversal') = (reverses_entry_id is not null))
);

create index journal_entries_user_id_posted_at_idx on journal_entries (user_id, posted_at);

create table journal_lines (
  entry_id uuid not null references journal_entries (id) on delete cascade,
  line_no smallint not null check (line_no > 0),
  account_code text not null references accounts (code),
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  primary key (entry_id, line_no),
  -- Each line is either a debit or a credit, never both or neither.
  check ((debit_minor > 0) <> (credit_minor > 0))
);

create index journal_lines_account_code_idx on journal_lines (account_code);

-- Every entry balances: checked at commit, so an entry and its lines are inserted in one
-- transaction. An entry needs at least two lines, and its debits must equal its credits.
create function assert_entry_balances() returns trigger
language plpgsql
as $$
declare
  target uuid;
  line_count integer;
  debits bigint;
  credits bigint;
begin
  if tg_table_name = 'journal_entries' then
    target := new.id;
  else
    target := new.entry_id;
  end if;
  select count(*), coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0)
    into line_count, debits, credits
    from journal_lines
   where entry_id = target;
  if line_count < 2 or debits <> credits then
    raise exception 'journal entry % does not balance: % lines, debits %, credits %',
      target, line_count, debits, credits
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger journal_entries_balance
  after insert on journal_entries
  deferrable initially deferred
  for each row execute function assert_entry_balances();

create constraint trigger journal_lines_balance
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function assert_entry_balances();

-- Append-only: entries and lines are never updated. Sandbox reset (ADR 0011) deletes the
-- caller's entries instead, which cascades to their lines.
create function reject_update() returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'restrict_violation';
end;
$$;

create trigger journal_entries_append_only
  before update on journal_entries
  for each row execute function reject_update();

create trigger journal_lines_append_only
  before update on journal_lines
  for each row execute function reject_update();
