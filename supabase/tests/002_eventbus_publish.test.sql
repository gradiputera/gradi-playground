-- Spec: eventing. The platform publish entry point.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

-- Topology and queues exist.
select is(
  (select array_agg(consumer_group order by consumer_group) from eventbus.consumers),
  array['account', 'ledger', 'notification', 'payment', 'reporting'],
  'the five consumer groups exist'
);
select is(
  (select count(*)::int from pgmq.list_queues() where queue_name like 'evt\_%'),
  10,
  'each consumer group has a queue and a dead-letter queue'
);

-- Start from empty queues inside this transaction.
select pgmq.purge_queue('evt_' || consumer_group) from eventbus.consumers;

-- A subscribed event fans out to every subscribed group.
select is(
  eventbus.publish(jsonb_build_object(
    'specversion', '1.0', 'id', 'evt-test-1', 'source', 'payment-service',
    'type', 'payment.succeeded.v1', 'site', 'DC', 'data', jsonb_build_object('payment_id', 'p1')
  )),
  2,
  'payment.succeeded.v1 reports two deliveries'
);
select is((select count(*)::int from pgmq.q_evt_notification), 1, 'notification received one message');
select is((select count(*)::int from pgmq.q_evt_reporting), 1, 'reporting received one message');
select is((select count(*)::int from pgmq.q_evt_ledger), 0, 'ledger received nothing');
select is(
  (select message ->> 'id' from pgmq.q_evt_notification),
  'evt-test-1',
  'the enqueued message is the published envelope'
);

-- An invalid envelope is rejected and enqueues nothing.
select throws_ok(
  $$ select eventbus.publish('{"specversion": "1.0", "source": "payment-service", "type": "payment.succeeded.v1"}') $$,
  '22023', null, 'an envelope without id is rejected'
);
select is((select count(*)::int from pgmq.q_evt_notification), 1, 'the rejected event enqueued nothing');

-- A valid event without subscribers is accepted and enqueues nothing.
select is(
  eventbus.publish(jsonb_build_object(
    'specversion', '1.0', 'id', 'evt-test-2', 'source', 'account-service', 'type', 'account.unheard-of.v1'
  )),
  0,
  'an unsubscribed event type reports zero deliveries'
);

-- Service roles can publish but cannot touch queues directly.
select lives_ok(
  $$ set local role payment_service;
     select eventbus.publish('{"specversion": "1.0", "id": "evt-test-3", "source": "payment-service", "type": "payment.failed.v1"}');
     reset role $$,
  'payment_service can publish'
);
select throws_ok(
  $$ set local role payment_service; select * from pgmq.read('evt_notification', 30, 1) $$,
  '42501', null, 'payment_service cannot read a queue directly'
);

-- Browser client roles cannot publish.
select throws_ok(
  $$ set local role anon; select eventbus.publish('{"specversion": "1.0", "id": "x", "source": "x", "type": "payment.failed.v1"}') $$,
  '42501', null, 'anon cannot publish'
);
select throws_ok(
  $$ set local role authenticated; select eventbus.publish('{"specversion": "1.0", "id": "x", "source": "x", "type": "payment.failed.v1"}') $$,
  '42501', null, 'authenticated cannot publish'
);

select * from finish();
rollback;
