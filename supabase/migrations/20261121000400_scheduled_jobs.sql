-- Scheduled platform jobs (pg_cron, UTC): event dispatch, nightly sandbox reset broadcast,
-- stale guest cleanup and housekeeping that keeps the database inside the Free tier.

create extension if not exists pg_cron;

create schema if not exists platform;
comment on schema platform is 'Platform maintenance functions run by pg_cron. Operator-only; not exposed through the Data API.';

-- Broadcast the nightly sandbox reset. Each service resets its own schema when it receives the
-- event; the platform never deletes service rows (ADR 0011).
create function platform.publish_nightly_reset()
returns integer
language sql
security definer
set search_path = ''
as $$
  select eventbus.publish(jsonb_build_object(
    'specversion', '1.0',
    'id', gen_random_uuid()::text,
    'source', 'platform/cron',
    'type', 'platform.sandbox-nightly-reset.v1',
    'time', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'datacontenttype', 'application/json',
    'traceparent', '00-' || replace(gen_random_uuid()::text, '-', '')
                   || '-' || left(replace(gen_random_uuid()::text, '-', ''), 16) || '-01',
    'site', 'DC',
    'data', jsonb_build_object('reset_date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'))
  ));
$$;

-- Delete anonymous users whose last activity (creation, sign-in or session refresh) is older
-- than the threshold. Non-anonymous users are never touched.
create function platform.delete_stale_guests(p_inactive interval default interval '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.users u
   where u.is_anonymous
     and greatest(
           u.created_at,
           coalesce(u.last_sign_in_at, u.created_at),
           coalesce((select max(s.updated_at) from auth.sessions s where s.user_id = u.id), u.created_at)
         ) < now() - p_inactive;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Purge archived event messages older than 7 days and scheduler history older than 1 day.
create function platform.housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group text;
  v_rows integer;
  v_archive integer := 0;
  v_runs integer;
begin
  for v_group in select consumer_group from eventbus.consumers loop
    execute format('delete from pgmq.%I where archived_at < now() - interval ''7 days''', 'a_evt_' || v_group);
    get diagnostics v_rows = row_count;
    v_archive := v_archive + v_rows;
  end loop;

  delete from cron.job_run_details
   where coalesce(end_time, start_time) < now() - interval '1 day';
  get diagnostics v_runs = row_count;

  return jsonb_build_object('archived_messages', v_archive, 'job_run_details', v_runs);
end;
$$;

revoke all on schema platform from public, anon, authenticated, service_role;
revoke execute on all functions in schema platform from public, anon, authenticated, service_role;
alter default privileges in schema platform revoke execute on functions from public;

-- cron.schedule upserts by job name, so re-running this file is harmless.
select cron.schedule('eventbus-dispatch', '5 seconds', 'select eventbus.dispatch_tick()');
select cron.schedule('sandbox-nightly-reset', '0 0 * * *', 'select platform.publish_nightly_reset()');
select cron.schedule('stale-guest-cleanup', '30 0 * * *', 'select platform.delete_stale_guests()');
select cron.schedule('platform-housekeeping', '0 1 * * *', 'select platform.housekeeping()');
