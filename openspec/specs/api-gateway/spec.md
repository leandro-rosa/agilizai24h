# api-gateway Specification

## Purpose
The platform's single HTTP entrypoint and trust boundary: it decides whether a request is
authenticated and permitted, forwards it to the domain service that owns the data, and
defines what the admin panel sees when something behind it fails.

## Requirements

### Requirement: Single entrypoint

The system SHALL be the only service reachable by the admin panel, and domain services
SHALL NOT be exposed outside the internal network. Every panel request SHALL pass through
it.

#### Scenario: Domain services are not directly reachable

- **WHEN** the deployed topology is inspected
- **THEN** only the gateway publishes an externally reachable port
- **AND** every domain service is reachable solely on the internal network

### Requirement: Session authentication

The system SHALL validate the caller's session on every request to a protected route by
resolving it through the identity service, and SHALL reject requests carrying no session,
an unknown session, or an expired one.

#### Scenario: Valid session is accepted

- **GIVEN** a request carrying a valid, unexpired session
- **WHEN** it targets a protected route
- **THEN** the request proceeds to the domain service
- **AND** the resolved user identity is available to the handling logic

#### Scenario: Missing session is rejected

- **WHEN** a request to a protected route carries no session
- **THEN** it is rejected as unauthenticated
- **AND** no request is made to any domain service

#### Scenario: Expired or revoked session is rejected

- **GIVEN** a session that has expired or been logged out
- **WHEN** a request carrying it targets a protected route
- **THEN** it is rejected as unauthenticated
- **AND** no request is made to any domain service

#### Scenario: Login and health routes are not protected

- **WHEN** a request targets the login route or a health endpoint
- **THEN** it is processed without requiring an existing session

### Requirement: Identity service availability is distinguished from rejection

The system SHALL distinguish a request rejected because its session is invalid from one
that could not be validated because the identity service is unreachable, and SHALL NOT
report the latter as an authentication failure.

#### Scenario: Identity service unreachable

- **GIVEN** the identity service is not responding
- **WHEN** a request to a protected route arrives
- **THEN** the response indicates a temporary server-side failure, not invalid credentials
- **AND** the caller's session is not treated as invalid or cleared

#### Scenario: An outage does not log everyone out

- **GIVEN** users holding valid sessions
- **WHEN** the identity service becomes unreachable and later recovers
- **THEN** those sessions still work after recovery, with no re-login required

### Requirement: Permission enforcement

The system SHALL enforce, for each protected route, the named permission that route
requires, using the effective permissions resolved for the caller. Authorization decisions
SHALL be expressed in named permissions, never in role names.

#### Scenario: Caller holds the required permission

- **GIVEN** a caller whose effective permissions include the one a route requires
- **WHEN** they request that route
- **THEN** the request proceeds

#### Scenario: Caller lacks the required permission

- **GIVEN** an authenticated caller lacking the permission a route requires
- **WHEN** they request that route
- **THEN** the request is rejected as forbidden, distinctly from unauthenticated
- **AND** no request is made to the domain service

#### Scenario: Permission changes take effect without re-login

- **GIVEN** an authenticated caller with an active session
- **WHEN** a permission is revoked from them
- **THEN** their next request requiring it is rejected as forbidden, without them having to
  log in again

### Requirement: Browser session handling

The system SHALL manage the session credential in the browser itself, delivering it as an
HTTP-only cookie, and SHALL NOT require the frontend to read, store, or attach the session
token.

#### Scenario: Login establishes the session cookie

- **WHEN** valid credentials are posted to the login route
- **THEN** the response sets an HTTP-only, same-site session cookie
- **AND** the response body contains the user's identity and permissions but not the raw
  session token

#### Scenario: Session cookie is not readable by scripts

- **WHEN** the session cookie is set
- **THEN** it is marked HTTP-only, so page scripts cannot read it

#### Scenario: Logout clears the session

- **WHEN** the logout route is called
- **THEN** the session is revoked at the identity service
- **AND** the session cookie is cleared from the browser

### Requirement: Routing to domain services

The system SHALL forward each request to the domain service that owns the requested data
and return that service's result, without duplicating the domain logic itself.

#### Scenario: Request reaches the owning service

- **WHEN** an authorized request for store data arrives
- **THEN** it is forwarded to the stores service
- **AND** that service's response is returned to the caller

#### Scenario: Domain service failure is reported as such

- **GIVEN** a domain service returns an error or is unreachable
- **WHEN** a request depending on it is handled
- **THEN** the caller receives an error indicating the upstream failure
- **AND** the failure is not misreported as an authentication or permission problem

#### Scenario: Aggregated responses report partial failure

- **WHEN** a route combines data from more than one domain service and one of them fails
- **THEN** the response makes the failure explicit
- **AND** the partial data is not presented as a complete result

### Requirement: Correlation identifier propagation

The system SHALL attach a correlation identifier to every request it handles, reusing one
supplied by the caller when present and generating one otherwise, and SHALL pass it to
every downstream service call made while handling that request.

#### Scenario: Correlation identifier is generated

- **WHEN** a request arrives without a correlation identifier
- **THEN** one is generated and included in every downstream call and log line for that
  request

#### Scenario: Supplied correlation identifier is preserved

- **WHEN** a request arrives carrying a correlation identifier
- **THEN** that same value is used downstream rather than a new one

### Requirement: Published API contract

The system SHALL publish an OpenAPI document describing every route it exposes, including
the permission each route requires and the error responses it can return.

#### Scenario: Contract describes the surface

- **WHEN** the OpenAPI document is retrieved
- **THEN** it lists every exposed route with its request and response shapes
- **AND** it documents the authentication and authorization failure responses

### Requirement: Upload routes

The system SHALL expose routes for uploading each of the three operational file types,
accepting a file and the store and period it applies to, and SHALL require a named
permission to use them. These routes SHALL hand the work to the ingestion queue rather than
to a domain service.

#### Scenario: Authorized upload is accepted

- **GIVEN** a caller holding the upload permission
- **WHEN** they upload a file of a supported type
- **THEN** the request is accepted and an ingestion identifier is returned

#### Scenario: Upload requires permission

- **GIVEN** an authenticated caller lacking the upload permission
- **WHEN** they attempt an upload
- **THEN** the request is rejected as forbidden
- **AND** no file is stored and no work is queued

#### Scenario: Oversized or unsupported file is rejected at the edge

- **WHEN** an upload exceeds the configured size limit or is not a supported spreadsheet
  format
- **THEN** it is rejected with an error describing the limit or the supported formats
- **AND** no work is queued

### Requirement: Ingestion status routes

The system SHALL expose routes to retrieve the status of an ingestion by its identifier and
to list recent ingestions, subject to a named permission.

#### Scenario: Retrieving an ingestion's status

- **GIVEN** an ingestion identifier returned by an upload
- **WHEN** its status is requested by a permitted caller
- **THEN** the current status, counts of accepted and rejected rows, and any errors are
  returned

#### Scenario: Listing recent ingestions

- **WHEN** a permitted caller lists recent ingestions
- **THEN** they receive each ingestion's identifier, file type, store, period, status and
  upload time

#### Scenario: Unknown ingestion identifier

- **WHEN** the status of an identifier that does not exist is requested
- **THEN** the system reports it as not found
