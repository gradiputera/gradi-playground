# apps/web

Nuxt web application: the public main page (SSR), the CSR playground, and the backend-for-frontend (BFF) that handles OAuth callbacks, site routing, observability proxying and sandbox reset fan-out. Deploys natively on Vercel.

## Status

Planned

## Responsibilities

- Main page `/` rendered on the server; the playground `/playground/**` rendered on the client.
- BFF endpoints under the Nuxt server routes: auth callback, token/session handling, site router (DC/DRC), observability proxy, sandbox reset fan-out.
- No service keys or tokens are ever sent to the browser.

Details are added when the web app is implemented (see the route map in ADR 0008).

## Related

- [Architecture decision records](../../architecture/adr/README.md)
- [Project README](../../README.md)
