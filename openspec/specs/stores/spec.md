# stores Specification

## Purpose
The registry of physical Agiliz.AI locations. It defines what a store is, how it is
identified both internally and in the operational reports exported by the POS platform,
and how a store's lifecycle is handled without breaking the historical records that
reference it.

## Requirements

### Requirement: Store record

The system SHALL store, for each location, a stable internal identifier, a display name,
an address, a city, a store type distinguishing a company site from a condominium, and a
lifecycle status. The display name SHALL NOT be used as an identifier anywhere.

#### Scenario: Creating a store

- **WHEN** a store is created with a name, address, city and type
- **THEN** it is persisted with a stable internal identifier and an active status
- **AND** it is immediately available to be referenced by other domains

#### Scenario: Two stores may share a display name

- **GIVEN** an existing store named "Agiliz TechPark"
- **WHEN** another store is created with the same name at a different address
- **THEN** both exist independently, distinguished by their internal identifiers

### Requirement: External store code

The system SHALL record, for each store, the external code under which the POS platform
identifies that store in its exported reports. The code SHALL be unique across stores, and
SHALL be resolvable to exactly one store.

#### Scenario: Resolving an uploaded report to a store

- **GIVEN** a store registered with external code "TP-001"
- **WHEN** a caller resolves the external code "TP-001"
- **THEN** exactly one store is returned

#### Scenario: Duplicate external code is rejected

- **WHEN** a store is created or updated with an external code already used by another store
- **THEN** the request is rejected with a conflict error
- **AND** neither store is modified

#### Scenario: Unknown external code is reported, not guessed

- **WHEN** a caller resolves an external code that matches no store
- **THEN** the system reports that no store matches
- **AND** it SHALL NOT fall back to matching on display name or return an arbitrary store

#### Scenario: A store may exist before its code is known

- **WHEN** a store is created without an external code
- **THEN** it is persisted successfully
- **AND** it cannot be resolved by external code until one is assigned

### Requirement: Store lifecycle

The system SHALL support marking a store as active, under maintenance, or inactive, and
SHALL NOT permit a store to be permanently deleted once it exists.

#### Scenario: Deactivating a store

- **GIVEN** an active store
- **WHEN** it is marked inactive
- **THEN** it stops appearing in the default active-store listing
- **AND** it remains retrievable by its identifier

#### Scenario: Historical references keep resolving

- **GIVEN** an inactive store referenced by past sales and reconciliation records
- **WHEN** those records are read
- **THEN** the store still resolves, with its name and attributes intact

#### Scenario: Deletion is refused

- **WHEN** a caller attempts to permanently delete a store
- **THEN** the operation is refused
- **AND** the caller is directed to deactivate it instead

### Requirement: Listing and retrieval

The system SHALL expose a listing of stores that can be filtered by status, type and city,
and SHALL expose retrieval of a single store by its identifier. Listings SHALL be ordered
deterministically so that repeated identical requests return records in the same order.

#### Scenario: Listing defaults to active stores

- **WHEN** stores are listed without an explicit status filter
- **THEN** only active stores are returned

#### Scenario: Listing all statuses explicitly

- **WHEN** stores are listed with a status filter naming every status
- **THEN** active, maintenance and inactive stores are all returned

#### Scenario: Retrieving an unknown store

- **WHEN** a store is retrieved by an identifier that does not exist
- **THEN** the system reports it as not found
- **AND** returns no store data

#### Scenario: Listing order is stable

- **WHEN** the same listing request is issued twice with no data change in between
- **THEN** both responses contain the same records in the same order

### Requirement: Updating a store

The system SHALL allow a store's name, address, city, type, status and external code to be
updated, and SHALL NOT allow its internal identifier to change.

#### Scenario: Updating mutable attributes

- **WHEN** a store's name and address are updated
- **THEN** the new values are persisted
- **AND** its internal identifier is unchanged

#### Scenario: Identifier is immutable

- **WHEN** an update attempts to change a store's internal identifier
- **THEN** the request is rejected
- **AND** the stored record is unchanged
