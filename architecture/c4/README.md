# architecture/c4

C4 model diagrams for gradi-playground: the system context and the container view. The diagrams use Mermaid `flowchart` syntax.

## Status

Planned

## Context diagram

```mermaid
flowchart LR
    visitor["Visitor or guest"]
    google["Google (identity provider)"]
    gradi["gradi-playground"]
    supa["Supabase Free: Auth, Postgres, queues, cron"]
    grafana["Grafana Cloud Free: metrics, logs, traces"]
    gmail["Gmail SMTP"]
    recipient["Email recipient"]

    visitor -->|"browses and runs simulated payments"| gradi
    visitor -->|"signs in with Google"| google
    gradi -->|"OAuth2 / OIDC via Supabase Auth"| google
    gradi -->|"stores data and events"| supa
    gradi -->|"pushes OTLP; reads PromQL and LogQL"| grafana
    gradi -->|"sends payment outcome email"| gmail
    gmail -->|"delivers"| recipient
```

## Container diagram

```mermaid
flowchart TB
    visitor["Visitor or guest"]

    subgraph vercel["Vercel (Hobby)"]
        web["apps/web: Nuxt SSR and CSR, BFF"]
        acc["account-service: PHP 8.4 / Laravel"]
        led["ledger-service: Java 25 / Vert.x 5"]
        pay["payment-service: Go"]
        notif["notification-service: Node.js 24 / Hono"]
        rep["reporting-service: Python 3.13 / FastAPI"]
    end

    subgraph supa["Supabase Free"]
        auth["Auth (Google, anonymous)"]
        pg[("Postgres schemas: account, ledger, payment, notification, reporting")]
        mq["pgmq queues and Cron dispatcher"]
    end

    grafana["Grafana Cloud Free"]
    gmail["Gmail SMTP"]

    visitor -->|"HTTPS"| web
    web -->|"sign-in and token exchange"| auth
    web -->|"simulate payment"| pay
    web -->|"general ledger reads, sandbox reset"| led
    web -->|"sandbox reset fan-out"| acc
    web -->|"reporting reads"| rep
    web -->|"observability queries (whitelisted)"| grafana
    pay -->|"ledger posting"| led
    pay -->|"outbox"| mq
    led -->|"outbox"| mq
    mq -->|"signed webhook"| notif
    mq -->|"signed webhook"| rep
    notif -->|"send email"| gmail
    acc --- pg
    led --- pg
    pay --- pg
    notif --- pg
    rep --- pg
    acc -.->|"OTLP"| grafana
    led -.->|"OTLP"| grafana
    pay -.->|"OTLP"| grafana
    notif -.->|"OTLP"| grafana
    rep -.->|"OTLP"| grafana
```

## Notes

- Each service validates the JWT itself through JWKS (ADR 0007).
- Services integrate only through HTTP and events; there are no cross-schema joins (ADR 0004).
- The DC and DRC sites are logical; the diagram shows a single deployment (ADR 0012).

## Related

- [Architecture decision records](../adr/README.md)
- [Diagram conventions](../diagrams/README.md)
- [Project README](../../README.md)
