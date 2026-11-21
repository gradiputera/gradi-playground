-- Event bus dispatcher (ADR 0005): delivers queued events as signed CloudEvents webhooks with
-- pg_net, retries with exponential backoff, dead-letters after max_attempts, plus operator
-- functions for replay and dead-letter redrive. Signature format: Standard Webhooks.

-- In-flight HTTP requests, settled on the next tick once pg_net has stored the response.
create table eventbus.deliveries (
  request_id     bigint primary key,
  consumer_group text not null references eventbus.consumers (consumer_group),
  msg_id         bigint not null,
  attempt        integer not null,
  sent_at        timestamptz not null default now()
);

-- Seconds before a message becomes visible again after attempt n: 10, 20, 40, 80, 160, then 300.
create function eventbus.backoff_seconds(p_attempt integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(300, 10 * power(2, least(greatest(p_attempt - 1, 0), 10)))::integer;
$$;

-- Standard Webhooks signature: v1,<base64(hmac_sha256(key, "<id>.<timestamp>.<body>"))>.
-- The secret uses the Standard Webhooks form whsec_<base64 key>.
create function eventbus.sign(p_secret text, p_id text, p_timestamp bigint, p_body text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_secret is null or p_secret not like 'whsec\_%' then
    raise exception 'eventbus.sign: the secret must use the whsec_<base64> form' using errcode = '22023';
  end if;

  return 'v1,' || encode(
    extensions.hmac(
      convert_to(p_id || '.' || p_timestamp::text || '.' || p_body, 'UTF8'),
      decode(substr(p_secret, 7), 'base64'),
      'sha256'
    ),
    'base64'
  );
end;
$$;

-- One dispatcher tick: settle finished requests, then send visible messages.
create function eventbus.dispatch_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived integer := 0;
  v_failed integer := 0;
  v_sent integer := 0;
  v_dead integer := 0;
  v_timestamp bigint := extract(epoch from clock_timestamp())::bigint;
  v_queue text;
  v_request_id bigint;
  d record;
  c record;
  m record;
begin
  if not pg_try_advisory_xact_lock(hashtext('eventbus.dispatch_tick')) then
    return jsonb_build_object('skipped', true);
  end if;

  -- Phase 1: settle. A 2xx response archives the message; anything else leaves it to reappear
  -- when its backoff ends.
  for d in
    select dl.request_id, dl.consumer_group, dl.msg_id, r.status_code
      from eventbus.deliveries dl
      join net._http_response r on r.id = dl.request_id
  loop
    if d.status_code between 200 and 299 then
      perform pgmq.archive('evt_' || d.consumer_group, d.msg_id);
      v_archived := v_archived + 1;
    else
      v_failed := v_failed + 1;
    end if;
    delete from eventbus.deliveries where request_id = d.request_id;
  end loop;

  -- Requests with no response after 60 seconds are lost; the message reappears anyway.
  delete from eventbus.deliveries where sent_at < now() - interval '60 seconds';

  -- Phase 2: send, for enabled consumers that have an endpoint and a well-formed secret.
  for c in
    select co.consumer_group, co.endpoint_url, co.max_attempts, s.decrypted_secret as secret
      from eventbus.consumers co
      join vault.decrypted_secrets s on s.name = 'eventbus_webhook_secret_' || co.consumer_group
     where co.enabled
       and co.endpoint_url is not null
       and s.decrypted_secret like 'whsec\_%'
     order by co.consumer_group
  loop
    v_queue := 'evt_' || c.consumer_group;

    for m in select * from pgmq.read(v_queue, 30, 10) loop
      if m.read_ct > c.max_attempts then
        perform pgmq.send(v_queue || '_dlq', m.message);
        perform pgmq.delete(v_queue, m.msg_id);
        v_dead := v_dead + 1;
        continue;
      end if;

      perform pgmq.set_vt(v_queue, m.msg_id, eventbus.backoff_seconds(m.read_ct));

      -- Queue the request exactly as net.http_post does, but with the structured CloudEvents
      -- content type, which net.http_post refuses (it only accepts application/json).
      insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
      values (
        'POST',
        c.endpoint_url,
        jsonb_build_object(
            'content-type', 'application/cloudevents+json',
            'webhook-id', m.message ->> 'id',
            'webhook-timestamp', v_timestamp::text,
            'webhook-signature', eventbus.sign(c.secret, m.message ->> 'id', v_timestamp, m.message::text)
          ) || jsonb_strip_nulls(jsonb_build_object(
            'traceparent', m.message ->> 'traceparent',
            'baggage', 'site=' || (m.message ->> 'site')
          )),
        convert_to(m.message::text, 'UTF8'),
        5000
      )
      returning id into v_request_id;

      insert into eventbus.deliveries (request_id, consumer_group, msg_id, attempt)
      values (v_request_id, c.consumer_group, m.msg_id, m.read_ct);
      v_sent := v_sent + 1;
    end loop;
  end loop;

  if v_sent > 0 then
    perform net.wake();
  end if;

  return jsonb_build_object(
    'archived', v_archived, 'failed', v_failed, 'sent', v_sent, 'dead_lettered', v_dead
  );
end;
$$;

-- Operator: re-send archived messages of a consumer group, within the 7-day archive window.
create function eventbus.replay(p_consumer_group text, p_since timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_message jsonb;
begin
  if not exists (select 1 from eventbus.consumers where consumer_group = p_consumer_group) then
    raise exception 'eventbus.replay: unknown consumer group %', p_consumer_group using errcode = '22023';
  end if;

  for v_message in execute format(
    'select message from pgmq.%I where archived_at >= $1 order by msg_id',
    'a_evt_' || p_consumer_group
  ) using greatest(p_since, now() - interval '7 days')
  loop
    perform pgmq.send('evt_' || p_consumer_group, v_message);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Operator: move every dead-lettered message of a consumer group back to its queue as a new
-- message, which resets its attempt count.
create function eventbus.redrive_dlq(p_consumer_group text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_msg_id bigint;
  v_message jsonb;
begin
  if not exists (select 1 from eventbus.consumers where consumer_group = p_consumer_group) then
    raise exception 'eventbus.redrive_dlq: unknown consumer group %', p_consumer_group using errcode = '22023';
  end if;

  for v_msg_id, v_message in execute format(
    'select msg_id, message from pgmq.%I order by msg_id',
    'q_evt_' || p_consumer_group || '_dlq'
  )
  loop
    perform pgmq.send('evt_' || p_consumer_group, v_message);
    perform pgmq.delete('evt_' || p_consumer_group || '_dlq', v_msg_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Operator view of delivery state per consumer group.
create view eventbus.delivery_status
with (security_invoker = true)
as
select
  c.consumer_group,
  c.enabled,
  c.endpoint_url is not null as has_endpoint,
  q.queue_length as queued,
  q.oldest_msg_age_sec as oldest_queued_age_seconds,
  dlq.queue_length as dead_lettered,
  (select count(*) from eventbus.deliveries d where d.consumer_group = c.consumer_group) as in_flight
from eventbus.consumers c
cross join lateral pgmq.metrics('evt_' || c.consumer_group) q
cross join lateral pgmq.metrics('evt_' || c.consumer_group || '_dlq') dlq;

-- Privileges: operator-only (postgres). Service roles keep only eventbus.publish.
revoke all on table eventbus.deliveries, eventbus.delivery_status from public, anon, authenticated, service_role;
revoke execute on function
  eventbus.backoff_seconds(integer),
  eventbus.sign(text, text, bigint, text),
  eventbus.dispatch_tick(),
  eventbus.replay(text, timestamptz),
  eventbus.redrive_dlq(text)
from public, anon, authenticated, service_role;
