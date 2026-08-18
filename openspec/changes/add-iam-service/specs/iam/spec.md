## Purpose

Identity and access management for the Agiliz.AI platform: who the operators are, how they
prove it, how long that proof lasts, and what each of them is allowed to see or change.
Every access decision made anywhere in the platform derives from this capability.

## ADDED Requirements

### Requirement: User accounts

The system SHALL store an account per operator, identified by a unique email address, and
SHALL record whether the account is active. Accounts are created by an administrator;
there is no public self-registration.

#### Scenario: Creating an account with a new email

- **WHEN** an administrator creates an account with an email not already in use
- **THEN** the account is persisted as active and is immediately able to authenticate

#### Scenario: Creating an account with a duplicate email

- **WHEN** an administrator creates an account with an email that already exists
- **THEN** the request is rejected with a conflict error
- **AND** the existing account is left unchanged

#### Scenario: Deactivated account cannot authenticate

- **GIVEN** an account marked inactive
- **WHEN** the correct credentials for that account are presented
- **THEN** authentication fails
- **AND** the response does not reveal that the account exists

### Requirement: Credential storage

The system SHALL store passwords only as salted one-way hashes using a memory-hard
algorithm, and SHALL NOT store, log, or return a password in plaintext or reversible form
under any circumstance.

#### Scenario: Password is never persisted in plaintext

- **WHEN** an account is created or its password changed
- **THEN** only a salted hash is written to storage
- **AND** the plaintext value appears in no log, error message, or API response

#### Scenario: Password is never returned by any endpoint

- **WHEN** any endpoint returns a representation of an account
- **THEN** the response contains no password hash and no password field

### Requirement: Login

The system SHALL exchange a valid email and password for a newly created session, and
SHALL reject invalid credentials without revealing which half was wrong.

#### Scenario: Successful login

- **WHEN** a valid email and password for an active account are submitted
- **THEN** a new session is created and its opaque token is returned
- **AND** the response includes the authenticated user's identity and permissions

#### Scenario: Wrong password

- **WHEN** a valid email is submitted with an incorrect password
- **THEN** authentication fails with a generic "invalid credentials" error
- **AND** no session is created

#### Scenario: Unknown email

- **WHEN** an email with no matching account is submitted
- **THEN** authentication fails with the same generic error and in comparable time to a
  wrong-password attempt, so accounts cannot be enumerated by response or timing

### Requirement: Session lifecycle

The system SHALL represent an authenticated login as a server-side session referenced by
an opaque, high-entropy token that carries no user data in itself. Each session SHALL have
an expiry, after which it is no longer valid.

#### Scenario: Session token is opaque

- **WHEN** a session token is issued
- **THEN** it is a high-entropy random value from which no user identity, role, or expiry
  can be derived without consulting the system

#### Scenario: Session expires

- **GIVEN** a session whose expiry has passed
- **WHEN** that session token is presented
- **THEN** it is treated as invalid
- **AND** the caller is told the session is expired rather than that it never existed

#### Scenario: Logout revokes immediately

- **GIVEN** an active session
- **WHEN** the session is logged out
- **THEN** the very next use of that token is rejected, with no grace period

#### Scenario: Deactivating an account revokes its sessions

- **GIVEN** an account with one or more active sessions
- **WHEN** the account is deactivated
- **THEN** all of its sessions stop being valid

### Requirement: Session introspection

The system SHALL expose an operation that resolves a session token into the associated
user identity and effective permissions, for use by the API gateway on each request. The
operation SHALL distinguish a valid session from an invalid or expired one.

#### Scenario: Valid session resolves

- **WHEN** the gateway presents a valid, unexpired session token
- **THEN** the response contains the user's identifier, email, roles, and effective
  permissions

#### Scenario: Invalid session is rejected

- **WHEN** the gateway presents a token that is unknown, expired, or revoked
- **THEN** the response indicates the session is not valid
- **AND** it carries no user identity

#### Scenario: Introspection does not extend the session

- **GIVEN** a session with a fixed expiry
- **WHEN** it is introspected repeatedly
- **THEN** its expiry is unchanged by introspection alone

### Requirement: Permission model

The system SHALL assign each user one or more roles, each role granting a set of named
permissions, and SHALL expose a user's effective permissions as the union of their roles'
permissions. Access decisions elsewhere in the platform SHALL be expressed in terms of
these named permissions, never in terms of role names.

#### Scenario: Effective permissions combine roles

- **GIVEN** a user holding two roles with overlapping permission sets
- **WHEN** their effective permissions are resolved
- **THEN** the result is the union of both sets, with no duplicates

#### Scenario: A user with no roles has no permissions

- **GIVEN** a user assigned no roles
- **WHEN** their effective permissions are resolved
- **THEN** the result is empty
- **AND** they can still authenticate, but are authorized for nothing

#### Scenario: Revoking a role takes effect on the next request

- **GIVEN** an authenticated user with an active session
- **WHEN** a role is removed from that user
- **THEN** the next introspection of their session reports the reduced permission set,
  without requiring them to log in again

### Requirement: Administrator bootstrap

The system SHALL provide a documented, repeatable way to create the first administrator
account on an empty database, and that mechanism SHALL NOT leave a default or
well-known password in place.

#### Scenario: Bootstrapping an empty deployment

- **GIVEN** a deployment with no accounts
- **WHEN** the documented bootstrap procedure runs with an administrator email and a
  supplied password
- **THEN** exactly one active administrator account exists, holding every permission

#### Scenario: Bootstrap is not destructive

- **GIVEN** a deployment that already has at least one account
- **WHEN** the bootstrap procedure runs again
- **THEN** it makes no change and reports that bootstrapping was already done

### Requirement: Authentication failure throttling

The system SHALL limit repeated failed authentication attempts against the same account
so that credentials cannot be brute-forced, and SHALL NOT let that limiting be used to
lock a legitimate user out permanently.

#### Scenario: Repeated failures are throttled

- **WHEN** authentication for one account fails repeatedly beyond the configured threshold
- **THEN** further attempts for that account are rejected for a cooling-off period,
  regardless of whether the credentials presented are correct

#### Scenario: Throttling clears

- **GIVEN** an account throttled after repeated failures
- **WHEN** the cooling-off period has elapsed
- **THEN** a correct credential succeeds again with no administrator intervention
