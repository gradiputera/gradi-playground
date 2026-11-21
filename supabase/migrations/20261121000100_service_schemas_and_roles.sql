-- Platform layer: one schema and one login role per service (ADR 0004).
-- Each <svc>_service role owns its own schema, so the service's own migration tool can create its
-- tables there. No service tables are created here.
-- Role passwords are never committed: the owner sets them in the hosted project, and seed.sql sets
-- local-only values for the local stack.

do $$
declare
  svc text;
  role_name text;
begin
  foreach svc in array array['account', 'ledger', 'payment', 'notification', 'reporting'] loop
    role_name := svc || '_service';

    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'create role %I login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
        role_name
      );
    end if;

    -- The migration role needs membership to create a schema owned by the service role.
    execute format('grant %I to current_user', role_name);

    execute format('create schema if not exists %I authorization %I', svc, role_name);
    execute format('alter role %I set search_path = %I', role_name, svc);

    -- Nobody but the owning role reaches the schema; it is also not exposed through the Data API
    -- (config.toml [api].schemas lists only public and graphql_public).
    execute format('revoke all on schema %I from public, anon, authenticated, service_role', svc);
  end loop;
end
$$;
