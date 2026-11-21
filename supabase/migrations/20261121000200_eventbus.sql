-- Platform event bus (ADR 0005): pgmq queues per consumer group, subscriptions, and a single
-- privileged publish entry point for services. Delivery (the dispatcher) is in the next migration.

create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists eventbus;
comment on schema eventbus is 'Platform event bus: consumer groups, subscriptions, publish and dispatch. Not exposed through the Data API.';

-- Consumer groups. endpoint_url differs per environment: seed.sql sets local values, the owner
-- sets hosted values. A consumer without an endpoint is skipped by the dispatcher.
create table eventbus.consumers (
  consumer_group text primary key check (consumer_group ~ '^[a-z][a-z0-9_]{0,30}$'),
  endpoint_url   text check (endpoint_url is null or endpoint_url ~ '^https?://'),
  enabled        boolean not null default true,
  max_attempts   integer not null default 6 check (max_attempts between 1 and 20)
);
comment on table eventbus.consumers is 'One row per consumer group (one queue evt_<group> and one dead-letter queue evt_<group>_dlq each).';

-- Which consumer groups receive which event types (the topology from contracts/events/README.md).
create table eventbus.subscriptions (
  event_type     text not null check (event_type ~ '^[a-z][a-z0-9.-]*\.v[0-9]+$'),
  consumer_group text not null references eventbus.consumers (consumer_group),
  primary key (event_type, consumer_group)
);

insert into eventbus.consumers (consumer_group)
values ('account'), ('ledger'), ('payment'), ('notification'), ('reporting');

insert into eventbus.subscriptions (event_type, consumer_group)
values
  ('payment.succeeded.v1', 'notification'),
  ('payment.succeeded.v1', 'reporting'),
  ('payment.failed.v1', 'notification'),
  ('payment.failed.v1', 'reporting'),
  ('ledger.entry-posted.v1', 'reporting'),
  ('platform.sandbox-nightly-reset.v1', 'account'),
  ('platform.sandbox-nightly-reset.v1', 'ledger'),
  ('platform.sandbox-nightly-reset.v1', 'payment'),
  ('platform.sandbox-nightly-reset.v1', 'notification'),
  ('platform.sandbox-nightly-reset.v1', 'reporting');

-- One queue and one dead-letter queue per consumer group.
select pgmq.create('evt_' || consumer_group) from eventbus.consumers;
select pgmq.create('evt_' || consumer_group || '_dlq') from eventbus.consumers;

-- Publish a CloudEvents envelope to every subscribed consumer group. Runs inside the caller's
-- transaction, so a producer's outbox trigger that calls it is atomic with the business change.
create function eventbus.publish(p_event jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
  v_count integer := 0;
begin
  if jsonb_typeof(p_event) is distinct from 'object'
     or coalesce(p_event ->> 'specversion', '') = ''
     or coalesce(p_event ->> 'id', '') = ''
     or coalesce(p_event ->> 'source', '') = ''
     or coalesce(p_event ->> 'type', '') = '' then
    raise exception 'eventbus.publish: the event must be a CloudEvents object with specversion, id, source and type'
      using errcode = '22023';
  end if;

  for v_group in
    select s.consumer_group
      from eventbus.subscriptions s
     where s.event_type = p_event ->> 'type'
     order by s.consumer_group
  loop
    perform pgmq.send('evt_' || v_group, p_event);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
comment on function eventbus.publish(jsonb) is 'The only event-bus entry point granted to service roles. Returns the number of consumer groups the event was enqueued for.';

-- Privileges: nothing in this schema is reachable by default. Service roles may only publish.
revoke all on schema eventbus from public, anon, authenticated, service_role;
revoke all on all tables in schema eventbus from public, anon, authenticated, service_role;
revoke all on all sequences in schema eventbus from public, anon, authenticated, service_role;
revoke execute on all functions in schema eventbus from public, anon, authenticated, service_role;
alter default privileges in schema eventbus revoke execute on functions from public;
alter default privileges in schema eventbus revoke all on tables from public;

grant usage on schema eventbus
  to account_service, ledger_service, payment_service, notification_service, reporting_service;
grant execute on function eventbus.publish(jsonb)
  to account_service, ledger_service, payment_service, notification_service, reporting_service;
