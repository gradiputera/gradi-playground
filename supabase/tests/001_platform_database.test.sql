-- Spec: platform-database. Isolation of the per-service schemas and roles.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(32);

-- The platform layer holds no service tables (checked first, before this test creates any).
select is(
  (select count(*)::int from pg_catalog.pg_tables
    where schemaname in ('account', 'ledger', 'payment', 'notification', 'reporting')),
  0,
  'service schemas contain no tables after the platform migrations'
);

-- One schema per service, owned by its own role, with search_path set to it.
select has_schema('account');
select has_schema('ledger');
select has_schema('payment');
select has_schema('notification');
select has_schema('reporting');

select schema_owner_is('account', 'account_service');
select schema_owner_is('ledger', 'ledger_service');
select schema_owner_is('payment', 'payment_service');
select schema_owner_is('notification', 'notification_service');
select schema_owner_is('reporting', 'reporting_service');

select is(
  (select array_agg(r.rolname || ':' || s.setconfig[1] order by r.rolname)
     from pg_catalog.pg_db_role_setting s
     join pg_catalog.pg_roles r on r.oid = s.setrole
    where r.rolname like '%\_service' and r.rolname <> 'service_role'),
  array[
    'account_service:search_path=account',
    'ledger_service:search_path=ledger',
    'notification_service:search_path=notification',
    'payment_service:search_path=payment',
    'reporting_service:search_path=reporting'
  ],
  'each service role defaults search_path to its own schema'
);

select ok(
  (select bool_and(rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolbypassrls)
     from pg_catalog.pg_roles
    where rolname in ('account_service', 'ledger_service', 'payment_service',
                      'notification_service', 'reporting_service')),
  'service roles can log in and have no elevated attributes'
);

-- A service role creates its tables in its own schema and owns them.
select lives_ok(
  $$ set local role ledger_service; create table ledger.isolation_probe (id int); reset role $$,
  'ledger_service can create a table in ledger'
);
select table_owner_is('ledger', 'isolation_probe', 'ledger_service', 'the table is owned by ledger_service');

-- Service roles cannot read, write or create in another service's schema.
select throws_ok(
  $$ set local role payment_service; select * from ledger.isolation_probe $$,
  '42501', null, 'payment_service cannot read from ledger'
);
select throws_ok(
  $$ set local role payment_service; insert into ledger.isolation_probe values (1) $$,
  '42501', null, 'payment_service cannot write to ledger'
);
select throws_ok(
  $$ set local role payment_service; create table ledger.intruder (id int) $$,
  '42501', null, 'payment_service cannot create in ledger'
);
select throws_ok(
  $$ set local role account_service; create table payment.intruder (id int) $$,
  '42501', null, 'account_service cannot create in payment'
);
select throws_ok(
  $$ set local role reporting_service; select * from ledger.isolation_probe $$,
  '42501', null, 'reporting_service cannot read from ledger'
);

-- Browser client roles (and the Data API service role) have no access to any service schema.
select ok(not has_schema_privilege('anon', 'account', 'USAGE'), 'anon has no usage on account');
select ok(not has_schema_privilege('anon', 'ledger', 'USAGE'), 'anon has no usage on ledger');
select ok(not has_schema_privilege('anon', 'payment', 'USAGE'), 'anon has no usage on payment');
select ok(not has_schema_privilege('anon', 'notification', 'USAGE'), 'anon has no usage on notification');
select ok(not has_schema_privilege('anon', 'reporting', 'USAGE'), 'anon has no usage on reporting');
select ok(not has_schema_privilege('authenticated', 'account', 'USAGE'), 'authenticated has no usage on account');
select ok(not has_schema_privilege('authenticated', 'ledger', 'USAGE'), 'authenticated has no usage on ledger');
select ok(not has_schema_privilege('authenticated', 'payment', 'USAGE'), 'authenticated has no usage on payment');
select ok(not has_schema_privilege('authenticated', 'notification', 'USAGE'), 'authenticated has no usage on notification');
select ok(not has_schema_privilege('authenticated', 'reporting', 'USAGE'), 'authenticated has no usage on reporting');
select ok(not has_schema_privilege('service_role', 'account', 'USAGE'), 'service_role has no usage on account');

select throws_ok(
  $$ set local role authenticated; select * from ledger.isolation_probe $$,
  '42501', null, 'authenticated cannot read a service table'
);

select * from finish();
rollback;
