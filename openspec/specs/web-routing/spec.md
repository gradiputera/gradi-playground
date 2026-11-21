# web-routing Specification

## Purpose
Defines the route map of the Nuxt web application and which routes are server-rendered (SSR) and which are client-rendered (CSR), as decided in ADR 0008.

## Requirements

### Requirement: Main page is server-rendered
The system SHALL render the route `/` on the server and hydrate it into client-side navigation.

#### Scenario: Visitor opens the main page
- **WHEN** a visitor requests `/`
- **THEN** the server returns fully rendered HTML containing the owner's introduction and a link to `/playground`

### Requirement: Playground routes are client-rendered
The system SHALL render every route under `/playground` on the client only, with server-side rendering disabled for that route group.

#### Scenario: Visitor opens the playground hub
- **WHEN** a visitor requests `/playground`
- **THEN** the server returns the application shell and the hub content is rendered in the browser

### Requirement: Playground hub offers two destinations
The system SHALL show, on `/playground`, two prominent links: Payment (`/playground/payment`) and Dashboards (`/playground/dashboards`).

#### Scenario: Visitor chooses a destination
- **WHEN** a visitor selects the Payment link on the hub
- **THEN** the application navigates to `/playground/payment` without a full page reload

### Requirement: Header shows the current identity
The system SHALL show "guest" or the signed-in Google user in the header of `/playground/**`, together with a "Sign in with Google" action when the visitor is a guest.

#### Scenario: Guest visits the playground
- **WHEN** a visitor without Google sign-in opens `/playground`
- **THEN** the header shows "guest" and a "Sign in with Google" action

### Requirement: Server-only data stays on the server
The system MUST NOT send service keys, Grafana tokens or other server-only secrets to the browser in any route.

#### Scenario: Page data is inspected
- **WHEN** the rendered HTML and client bundles of any route are inspected
- **THEN** no service key, Grafana token or Supabase service role key is present
