-- Spec: eventing. Dispatcher delivery, signature, backoff, dead-lettering, redrive and replay.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(30);

-- Hold the dispatcher lock for this whole transaction so the scheduled tick cannot interleave.
-- Advisory locks are re-entrant within a session, so the ticks called below still run.
select pg_advisory_xact_lock(hashtext('eventbus.dispatch_tick'));

-- Fixtures: only notification has an endpoint; its secret is the known key 'test-key'.
select pgmq.purge_queue('evt_' || consumer_group) from eventbus.consumers;
select pgmq.purge_queue('evt_' || consumer_group || '_dlq') from eventbus.consumers;
delete from eventbus.deliveries;
update eventbus.consumers set endpoint_url = null, enabled = true, max_attempts = 6;
update eventbus.consumers set endpoint_url = 'http://consumer.test/events' where consumer_group = 'notification';
delete from vault.secrets where name like 'eventbus\_webhook\_secret\_%';
select vault.create_secret('whsec_dGVzdC1rZXk=', 'eventbus_webhook_secret_notification', 'test');

-- Signature: Standard Webhooks vector computed independently (Python hmac) for key 'test-key'.
select is(
  eventbus.sign('whsec_dGVzdC1rZXk=', 'msg-1', 1700000000, '{"a": 1}'),
  'v1,KjcTZ5o3kQryeGGsWOnJh70gqp/G6gm/CTGl67ujNHw=',
  'sign() matches the independent test vector'
);
select throws_ok(
  $$ select eventbus.sign('not-a-whsec-secret', 'msg-1', 1700000000, '{}') $$,
  '22023', null, 'sign() rejects a secret that is not in whsec_ form'
);

-- Backoff: 10, 20, 40, 80, 160, then capped at 300 seconds.
select is(
  array(select eventbus.backoff_seconds(n) from generate_series(1, 7) n),
  array[10, 20, 40, 80, 160, 300, 300],
  'backoff grows exponentially and caps at five minutes'
);

-- Send: one event, subscribed by notification (has endpoint) and reporting (no endpoint).
select eventbus.publish(jsonb_build_object(
  'specversion', '1.0', 'id', 'evt-dispatch-1', 'source', 'payment-service',
  'type', 'payment.succeeded.v1', 'site', 'DRC',
  'traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  'data', jsonb_build_object('payment_id', 'p1')
));

select is((eventbus.dispatch_tick() ->> 'sent')::int, 1, 'the tick sends one delivery');

create temp table sent_request on commit drop as
select q.*
  from net.http_request_queue q
  join eventbus.deliveries d on d.request_id = q.id;

select is((select count(*)::int from sent_request), 1, 'one HTTP request is queued for the delivery');
select is((select url from sent_request), 'http://consumer.test/events', 'the request targets the consumer endpoint');
select is((select method::text from sent_request), 'POST', 'the request is a POST');
select is(
  (select convert_from(body, 'UTF8') from sent_request),
  (select message::text from pgmq.q_evt_notification),
  'the request body is exactly the event text'
);
select is((select headers ->> 'content-type' from sent_request), 'application/cloudevents+json', 'content-type is structured CloudEvents');
select is((select headers ->> 'traceparent' from sent_request), '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', 'traceparent is forwarded');
select is((select headers ->> 'baggage' from sent_request), 'site=DRC', 'site is forwarded as baggage');
select is((select headers ->> 'webhook-id' from sent_request), 'evt-dispatch-1', 'webhook-id is the event id');
select ok((select (headers ->> 'webhook-timestamp') ~ '^[0-9]{10}$' from sent_request), 'webhook-timestamp is Unix seconds');
select is(
  (select headers ->> 'webhook-signature' from sent_request),
  (select eventbus.sign('whsec_dGVzdC1rZXk=', 'evt-dispatch-1', (headers ->> 'webhook-timestamp')::bigint, convert_from(body, 'UTF8')) from sent_request),
  'webhook-signature verifies over id, timestamp and the exact body'
);
select is((select timeout_milliseconds from sent_request), 5000, 'the delivery times out after 5 seconds');

select ok(
  (select read_ct = 1 and vt between clock_timestamp() + interval '5 seconds' and clock_timestamp() + interval '11 seconds'
     from pgmq.q_evt_notification),
  'after the first attempt the message is hidden for the first backoff (10 seconds)'
);
select is(
  (select read_ct from pgmq.q_evt_reporting),
  0,
  'a consumer without an endpoint receives nothing and its message stays queued'
);

-- Settle: a 2xx response archives the message.
insert into net._http_response (id, status_code, created)
select request_id, 200, now() from eventbus.deliveries;

select is((eventbus.dispatch_tick() ->> 'archived')::int, 1, 'a 2xx response is settled as archived');
select is((select count(*)::int from pgmq.q_evt_notification), 0, 'the acknowledged message left the queue');
select is((select count(*)::int from pgmq.a_evt_notification where message ->> 'id' = 'evt-dispatch-1'), 1, 'the acknowledged message is archived');
select is((select count(*)::int from eventbus.deliveries), 0, 'settled deliveries are removed');

-- Settle: a 500 response leaves the message queued for a retry.
select eventbus.publish('{"specversion": "1.0", "id": "evt-dispatch-2", "source": "payment-service", "type": "payment.failed.v1"}');
select eventbus.dispatch_tick();
insert into net._http_response (id, status_code, created)
select request_id, 500, now() from eventbus.deliveries;

select is((eventbus.dispatch_tick() ->> 'failed')::int, 1, 'a 500 response is settled as failed');
select is(
  (select count(*)::int from pgmq.q_evt_notification where message ->> 'id' = 'evt-dispatch-2'),
  1,
  'the failed message stays queued for a retry'
);

-- Dead-lettering: a message read more than max_attempts times moves to the DLQ.
update pgmq.q_evt_notification set read_ct = 6, vt = clock_timestamp() - interval '1 second';
select is((eventbus.dispatch_tick() ->> 'dead_lettered')::int, 1, 'the seventh read dead-letters the message');
select is((select count(*)::int from pgmq.q_evt_notification_dlq), 1, 'the DLQ holds the message');

-- Redrive: the DLQ is emptied back into the queue with a fresh attempt count.
select is(eventbus.redrive_dlq('notification'), 1, 'redrive moves one message');
select ok(
  (select count(*) = 0 from pgmq.q_evt_notification_dlq)
  and (select read_ct = 0 from pgmq.q_evt_notification where message ->> 'id' = 'evt-dispatch-2'),
  'the DLQ is empty and the message is back with read_ct 0'
);

-- A group without a signing secret is not sent to.
delete from vault.secrets where name = 'eventbus_webhook_secret_notification';
select is((eventbus.dispatch_tick() ->> 'sent')::int, 0, 'a group without a secret is not sent to');

-- Replay: only archive rows from the last 7 days are re-sent.
select pgmq.purge_queue('evt_reporting');
delete from pgmq.a_evt_reporting;
insert into pgmq.a_evt_reporting (msg_id, read_ct, enqueued_at, archived_at, vt, message)
values
  (900001, 1, now() - interval '9 days', now() - interval '8 days', now(), '{"id": "old"}'),
  (900002, 1, now() - interval '2 days', now() - interval '1 day', now(), '{"id": "recent"}');

select is(eventbus.replay('reporting', now() - interval '30 days'), 1, 'replay re-sends only messages archived within 7 days');
select is(
  (select array_agg(message ->> 'id') from pgmq.q_evt_reporting),
  array['recent'],
  'the replayed message is the recent one'
);

select * from finish();
rollback;
