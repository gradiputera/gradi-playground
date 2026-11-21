-- LOCAL ONLY. Runs on `supabase start` and `supabase db reset` against the local stack; it is never
-- applied to the hosted project. Every value below is a deliberately low-entropy, prefixed,
-- non-secret placeholder for local development, like the local stack's own default passwords.
-- Hosted values are set by the owner (see supabase/README.md, "Hosted setup").

-- Local port convention for services: account 8081, ledger 8082, payment 8083,
-- notification 8084, reporting 8085. The database container reaches the host via
-- host.docker.internal (on some Linux setups, use the Docker gateway IP instead).
update eventbus.consumers c
   set endpoint_url = format('http://host.docker.internal:%s/events', v.port)
  from (values
    ('account', 8081),
    ('ledger', 8082),
    ('payment', 8083),
    ('notification', 8084),
    ('reporting', 8085)
  ) as v (consumer_group, port)
 where c.consumer_group = v.consumer_group;

-- Local dispatcher signing secrets, in the Standard Webhooks form whsec_<base64 key>.
-- The key is the literal text 'local-dev-only-<group>'.
select vault.create_secret(
  'whsec_' || encode(convert_to('local-dev-only-' || consumer_group, 'UTF8'), 'base64'),
  'eventbus_webhook_secret_' || consumer_group,
  'Local-only dispatcher signing secret. Not a real credential.'
)
from eventbus.consumers;

-- Local service role passwords, so services can connect to the local database as their own role.
alter role account_service password 'local-dev-only-account';
alter role ledger_service password 'local-dev-only-ledger';
alter role payment_service password 'local-dev-only-payment';
alter role notification_service password 'local-dev-only-notification';
alter role reporting_service password 'local-dev-only-reporting';
