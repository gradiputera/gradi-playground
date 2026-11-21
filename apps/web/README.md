# apps/web

Nuxt web application: the public main page (SSR), the CSR playground, and the backend-for-frontend (BFF) that handles OAuth callbacks, site routing, observability proxying and sandbox reset fan-out. Deploys natively on Vercel.

## Status

Planned

## Route map

| Route | Rendering | Content |
|---|---|---|
| `/` | SSR | Main page about the owner, link to the playground |
| `/playground` | CSR | Hub: Payment and Dashboards |
| `/playground/payment` | CSR | Payment form, live timeline, general ledger, DC/DRC panel, reset to seed |
| `/playground/dashboards` | CSR | Native charts, logs panel, link to Grafana |

The rendering decision is in [ADR 0008](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md).

## BFF responsibilities

- **Auth callback**: starts the PKCE sign-in, checks `state`, exchanges the code and sets session cookies. See [auth model](../../docs/security/auth.md).
- **Session**: refreshes tokens and handles logout. Tokens never reach browser JavaScript.
- **Site router**: sets the logical site (`DC` or `DRC`) and propagates it in W3C `baggage` together with `traceparent`.
- **Observability proxy**: `/api/observability/*` runs whitelisted PromQL and LogQL templates with validated parameters against Grafana Cloud, using a read-only token kept on the server.
- **Sandbox reset fan-out**: calls `POST /sandbox/reset` on every service in parallel and reports progress per service.

## Data flows

### Payment

1. The form sends the amount, currency, scenario and recipient email to the BFF.
2. The BFF calls payment-service with an idempotency key and the site.
3. The timeline is updated from the trace and the service responses: payment, ledger posting, outbox, pgmq, dispatcher, notification (email sent or bounced) and reporting.
4. The general ledger section refreshes after each transaction.

### Dashboards

1. The page requests a chart or a log query from `/api/observability/*`.
2. The BFF validates the parameters and runs the matching whitelisted template.
3. Results are cached briefly and returned as data; no Grafana iframe is used, because Grafana Cloud Free blocks embedding.

## Related

- [ADR 0008: Hybrid SSR and CSR rendering](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0010: Native observability charts via BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
