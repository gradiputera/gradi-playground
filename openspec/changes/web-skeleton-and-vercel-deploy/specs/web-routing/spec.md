# Spec Delta

## ADDED Requirements

### Requirement: Unknown routes are not found
The system SHALL answer an unknown path outside `/playground` with HTTP 404 and a not-found page that links to `/`. An unknown path under `/playground` SHALL render the same not-found page in the browser.

#### Scenario: Unknown server-rendered path
- **WHEN** a visitor requests `/does-not-exist`
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
