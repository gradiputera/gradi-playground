-- Specs: sandbox (nightly reset broadcast), auth (stale guest removal), eventing (housekeeping).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(16);

-- The four jobs are scheduled as designed (UTC).
select is((select schedule from cron.job where jobname = 'eventbus-dispatch'), '5 seconds', 'dispatcher runs every 5 seconds');
select is((select schedule from cron.job where jobname = 'sandbox-nightly-reset'), '0 0 * * *', 'nightly reset at 00:00 UTC');
select is((select schedule from cron.job where jobname = 'stale-guest-cleanup'), '30 0 * * *', 'guest cleanup at 00:30 UTC');
select is((select schedule from cron.job where jobname = 'platform-housekeeping'), '0 1 * * *', 'housekeeping at 01:00 UTC');

-- Nightly reset: exactly one event per service consumer group, with the full contract envelope.
select pgmq.purge_queue('evt_' || consumer_group) from eventbus.consumers;
select is(platform.publish_nightly_reset(), 5, 'the nightly reset is enqueued for five groups');
select is(
  (select array_agg(n order by n) from (
     select (select count(*)::int from pgmq.q_evt_account) as n union all
     select (select count(*)::int from pgmq.q_evt_ledger) union all
     select (select count(*)::int from pgmq.q_evt_payment) union all
     select (select count(*)::int from pgmq.q_evt_notification) union all
     select (select count(*)::int from pgmq.q_evt_reporting)
   ) t),
  array[1, 1, 1, 1, 1],
  'each service queue holds exactly one reset event'
);
select ok(
  (select message ?& array['specversion', 'id', 'source', 'type', 'time', 'datacontenttype', 'traceparent', 'site', 'data']
     from pgmq.q_evt_ledger),
  'the event carries every envelope attribute required by the contract'
);
select is((select message ->> 'type' from pgmq.q_evt_ledger), 'platform.sandbox-nightly-reset.v1', 'the event type is versioned');
select ok(
  (select message ->> 'traceparent' ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-01$' from pgmq.q_evt_ledger),
  'the event carries a valid W3C traceparent'
);
select ok(
  (select message -> 'data' ->> 'reset_date' ~ '^\d{4}-\d{2}-\d{2}$' from pgmq.q_evt_ledger),
  'data.reset_date is a date'
);

-- Stale guests: only the anonymous user inactive for more than 30 days is deleted.
insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at, last_sign_in_at)
values
  ('00000000-0000-4000-8000-000000000031', 'authenticated', 'authenticated', true,
   now() - interval '31 days', now() - interval '31 days', now() - interval '31 days'),
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', true,
   now() - interval '60 days', now() - interval '60 days', now() - interval '60 days'),
  ('00000000-0000-4000-8000-000000000090', 'authenticated', 'authenticated', false,
   now() - interval '90 days', now() - interval '90 days', now() - interval '90 days');
-- The second guest signed in 60 days ago but refreshed its session yesterday.
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001',
        now() - interval '60 days', now() - interval '1 day');

select platform.delete_stale_guests();
select ok(
  not exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000031'),
  'the guest inactive for 31 days is deleted'
);
select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000001'),
  'the guest active yesterday (session refresh) is kept'
);
select ok(
  exists (select 1 from auth.users where id = '00000000-0000-4000-8000-000000000090'),
  'the non-anonymous user inactive for 90 days is kept'
);

-- Housekeeping: archive older than 7 days and run history older than 1 day are purged.
delete from pgmq.a_evt_ledger;
insert into pgmq.a_evt_ledger (msg_id, read_ct, enqueued_at, archived_at, vt, message)
values
  (910001, 1, now() - interval '9 days', now() - interval '8 days', now(), '{"id": "old"}'),
  (910002, 1, now() - interval '2 days', now() - interval '1 day', now(), '{"id": "recent"}');
insert into cron.job_run_details (jobid, runid, status, start_time, end_time)
values
  (0, 990001, 'succeeded', now() - interval '2 days', now() - interval '2 days'),
  (0, 990002, 'succeeded', now() - interval '1 hour', now() - interval '1 hour');

select platform.housekeeping();
select is(
  (select array_agg(message ->> 'id') from pgmq.a_evt_ledger),
  array['recent'],
  'archive rows older than 7 days are purged and newer ones kept'
);
select is(
  (select count(*)::int from cron.job_run_details where jobid = 0),
  1,
  'run history older than 1 day is purged and newer history kept'
);
select ok(
  not has_function_privilege('authenticated', 'platform.delete_stale_guests(interval)', 'EXECUTE'),
  'browser clients cannot run platform jobs'
);

select * from finish();
rollback;
