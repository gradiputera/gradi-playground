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
The system SHALL show "guest" or the signed-in Google user in the header of `/playground/**`, together with a "Sign in with Google" action when the visitor is a guest and a "Sign out" action when the visitor is signed in with Google.

#### Scenario: Guest visits the playground
- **WHEN** a visitor without Google sign-in opens `/playground`
- **THEN** the header shows "guest" and a "Sign in with Google" action

#### Scenario: Google user visits the playground
- **WHEN** a visitor signed in with Google opens `/playground`
- **THEN** the header shows their Google name and a "Sign out" action

### Requirement: Server-only data stays on the server
The system MUST NOT send service keys, Grafana tokens or other server-only secrets to the browser in any route.

#### Scenario: Page data is inspected
- **WHEN** the rendered HTML and client bundles of any route are inspected
- **THEN** no service key, Grafana token or Supabase service role key is present

### Requirement: Unknown routes are not found
The system SHALL answer an unknown path outside `/playground` with HTTP 404 and a not-found page that links to `/`. An unknown path under `/playground` SHALL render the same not-found page in the browser.

#### Scenario: Unknown server-rendered path
- **WHEN** a browser requests `/does-not-exist`
- **THEN** the response is HTTP 404 and the page links to `/`

#### Scenario: Unknown playground path
- **WHEN** a visitor opens `/playground/does-not-exist`
- **THEN** the browser shows the not-found page with a link to `/`

### Requirement: Playground is not indexed
The system SHALL send `X-Robots-Tag: noindex` on every response under `/playground`, and SHALL NOT send it on `/`.

#### Scenario: Crawler requests the playground
- **WHEN** a crawler requests `/playground` or `/playground/payment`
- **THEN** the response includes `X-Robots-Tag: noindex`

#### Scenario: Crawler requests the main page
- **WHEN** a crawler requests `/`
- **THEN** the response does not include an `X-Robots-Tag` header

### Requirement: Main page has search metadata
The server-rendered HTML of `/` SHALL contain a non-empty `<title>` and a `<meta name="description">` with non-empty content.

#### Scenario: Main page is shared or indexed
- **WHEN** the HTML of `/` is fetched without running JavaScript
- **THEN** it contains a non-empty title and a non-empty meta description

### Requirement: Playground content waits for a session
Pages under `/playground` SHALL show their content only once the visitor has a session. While the guest session is being created they SHALL show a preparing message, and if it cannot be created they SHALL show an error message instead of the content.

#### Scenario: First visit
- **WHEN** a visitor without a session opens `/playground`
- **THEN** a preparing message is shown until the guest session exists, and then the hub content is shown
