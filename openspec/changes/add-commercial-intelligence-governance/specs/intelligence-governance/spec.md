## Purpose

The official record of how the commercial intelligence is governed: the business rules the company decides, who changed them and why, which version of the logic and which parameters produced a recommendation, what was decided about it, what happened afterwards, and which calibrations were approved.

## ADDED Requirements

### Requirement: Business rules have one value for the whole operation

The register SHALL hold exactly one current value for each business rule, shared by every user and every store: the minimum combo margin, the largest discount worth testing, the monthly impact below which an item is not listed, the monthly impact required for priority, and the number of opportunities shown on the main screen. Each rule SHALL be published with its unit, its lower and upper bounds, a version counter that grows with every change, and the user and time of its last change. A rule SHALL NOT have a per-store, per-user or per-session value.

#### Scenario: Two readers see the same value

- **GIVEN** a business rule whose current value is 30%
- **WHEN** two different users read the rules at the same time
- **THEN** both receive 30% with the same version counter

#### Scenario: The register starts with the deployment defaults

- **GIVEN** a register that has never held any rule
- **WHEN** the service starts
- **THEN** each of the five rules exists with its documented default value
- **AND** its history holds one entry attributed to the system with the reason "initial default"
- **AND** starting the service again creates no further entries

### Requirement: A rule changes only with a valid value, a reason and the version last seen

The register SHALL accept a change to a business rule only when the new value respects the rule's type and bounds, the monthly impact below which an item is not listed stays at or below the monthly impact required for priority, a non-empty reason is given, the value differs from the current one, and the version counter sent equals the current one. A rejected change SHALL leave the value, the counter and the history untouched.

#### Scenario: A valid change is applied

- **GIVEN** a rule at version 3 with value 30%
- **WHEN** an authorized user sends 35%, a reason and version 3
- **THEN** the rule becomes 35% at version 4
- **AND** the change is returned with the user and the time

#### Scenario: A value outside the bounds is refused

- **GIVEN** a rule expressed as a share that must be greater than 0% and at most 100%
- **WHEN** a change to 150% is sent
- **THEN** the change is refused with the reason
- **AND** the value stays as it was

#### Scenario: The impact rules keep their order

- **GIVEN** the priority impact at R$ 30 and the not-listed impact at R$ 10
- **WHEN** a change raises the not-listed impact to R$ 50
- **THEN** it is refused because it would exceed the impact required for priority
- **AND** both values stay as they were

#### Scenario: A change without a reason is refused

- **WHEN** a change is sent with an empty or blank reason
- **THEN** it is refused and nothing changes

#### Scenario: A stale version is refused with the current value

- **GIVEN** two users who both read the rule at version 3
- **WHEN** the first changes it and the second then sends a change carrying version 3
- **THEN** the second change is refused as a conflict
- **AND** the response carries the current value, its version and who changed it

#### Scenario: Setting the same value is refused

- **WHEN** a change sends the value the rule already has
- **THEN** it is refused as no change and no history entry is created

#### Scenario: An unknown rule is refused

- **WHEN** a change names a rule that is not one of the business rules
- **THEN** it is refused as not found

### Requirement: Every change to a rule is kept in an append-only history

The register SHALL keep, for every change of a business rule, the rule, the previous value, the new value, the acting user, the time and the reason, and SHALL list them newest first. History entries SHALL NOT be editable or removable through the service.

#### Scenario: History lists who, when and why

- **GIVEN** a rule changed twice after its initial default
- **WHEN** its history is read
- **THEN** three entries are returned, newest first, each with previous value, new value, user, time and reason

#### Scenario: A history entry cannot be altered

- **WHEN** a request tries to edit or delete an existing history entry
- **THEN** no such operation exists and the entry is unchanged

### Requirement: The actor of every write is the authenticated user

The register SHALL attribute every write to the user the gateway authenticated for that request and SHALL reject a write that arrives without one. An actor named in a request body SHALL be ignored.

#### Scenario: A write without an actor is refused

- **WHEN** a write reaches the service with no authenticated user attached
- **THEN** it is refused and nothing is stored

#### Scenario: A claimed actor is ignored

- **GIVEN** a write authenticated as user A whose body names user B
- **WHEN** it is applied
- **THEN** the stored actor is user A

### Requirement: Model parameter sets are registered by content and carry a status

The register SHALL store each distinct set of data-quality and analytic parameters, together with the logic version that uses it, identified by a hash of its content. Registering content already stored SHALL return the existing set. A set SHALL be created provisional and its content SHALL never change. Business-rule values SHALL NOT be part of a set.

#### Scenario: The same content is registered once

- **GIVEN** a set already registered
- **WHEN** the same parameters and logic version are registered again
- **THEN** the existing set is returned and no new one is created

#### Scenario: Different content is a different set

- **WHEN** parameters differing in a single value are registered
- **THEN** a new provisional set with a different identity is created

#### Scenario: Provisional until a calibration is approved

- **GIVEN** a newly registered set
- **WHEN** its status is read
- **THEN** it is provisional
- **AND** it becomes approved only through the approval of a calibration report that references it

### Requirement: Recommendation records are immutable snapshots written when a decision is made

The register SHALL create a recommendation record when a decision is first registered on a recommendation, holding what was known then: the scope (network or store), the period, the origin of the recommendation, the logic version, the model parameter set, the values of the business rules in force, a summary of the evidence (data, period, benchmark, sample size, limitations), the three impact scenarios in cents per month or an explicit statement that the impact is not estimable and why, the confidence level with its factors, the effort and the risk. Recommendations SHALL be identified by a deterministic key over their cause, scope, period, logic version, parameter set and business-rule values, so that deciding twice on the same recommendation produced by the same logic reuses the record, while the same cause produced by different logic or rules is a different record. The content of a record SHALL never change, and a later change to a rule or a parameter set SHALL NOT alter any existing record. Each record SHALL state who submitted it and that the snapshot was reported by the client, not derived by the register.

#### Scenario: The first decision creates the record with its snapshot

- **GIVEN** a recommendation with no record
- **WHEN** an authorized user registers a decision on it, sending the snapshot
- **THEN** a record is created with the logic version, the parameter set, the business-rule values and the three impact scenarios exactly as sent

#### Scenario: A second decision reuses the record

- **GIVEN** a record for a recommendation
- **WHEN** another decision is registered on the same recommendation
- **THEN** no second record is created and the decision is attached to the existing one

#### Scenario: A later rule change leaves the record untouched

- **GIVEN** a record created while the minimum combo margin was 30%
- **WHEN** the margin is changed to 35%
- **THEN** the record still shows 30%

#### Scenario: The same cause under different logic is a different record

- **GIVEN** a record for a cause, scope and period produced by one logic version
- **WHEN** a decision is registered on the same cause, scope and period produced by another logic version or another rule value
- **THEN** a new record is created and the earlier one is unchanged

#### Scenario: A recommendation whose impact is not estimable can be recorded

- **WHEN** a decision arrives with the statement that the impact is not estimable and why, in place of the three scenarios
- **THEN** the record is stored with that statement and no invented figure

#### Scenario: An incomplete snapshot is refused

- **WHEN** a decision arrives whose snapshot lacks the logic version, the parameter set, or both the impact scenarios and the statement that they are not estimable
- **THEN** it is refused and neither record nor decision is stored

#### Scenario: The record says where the snapshot came from

- **WHEN** a record is read
- **THEN** it shows the user who submitted it and that the snapshot was reported by the client

### Requirement: Decisions are append-only and the latest one is current

The register SHALL keep every decision taken on a recommendation record: accepted, rejected or turned into an experiment, with the acting user and the time. A rejection SHALL carry a note; an experiment SHALL carry a planned start and end. A newer decision SHALL become the current one without deleting the earlier ones.

#### Scenario: A rejection needs a note

- **WHEN** a rejection is registered with no note
- **THEN** it is refused

#### Scenario: An experiment needs a window

- **WHEN** a decision "experiment" is registered without a planned start and end, or with an end before the start
- **THEN** it is refused

#### Scenario: The latest decision is current and the trail remains

- **GIVEN** a recommendation rejected on Monday
- **WHEN** it is turned into an experiment on Friday
- **THEN** the current decision is the experiment
- **AND** the trail lists both decisions with their users and times

### Requirement: Outcomes are recorded next to what was estimated

The register SHALL let an authorized user attach to an accepted or experiment decision the outcome that followed: the window observed, the impact realized in cents per month, how it was obtained, the user and a note. Outcomes SHALL be append-only, and a correction SHALL be a newer outcome that supersedes the earlier one. The register SHALL expose, for each record with an outcome, the three estimated scenarios beside the realized impact, and an aggregate by origin that states how many outcomes it rests on. The register SHALL NOT change any parameter, premise or threshold on its own from outcomes.

#### Scenario: An outcome sits next to its estimate

- **GIVEN** an experiment estimated at R$ 220, R$ 440 and R$ 660 per month
- **WHEN** an outcome of R$ 300 per month over four weeks is recorded
- **THEN** reading the record shows the three estimates and the R$ 300 together

#### Scenario: A correction supersedes without erasing

- **GIVEN** an outcome recorded with a wrong value
- **WHEN** a corrected outcome is recorded
- **THEN** the corrected one is current and the first remains visible as superseded

#### Scenario: An aggregate states its base

- **WHEN** the comparison of estimate and outcome is read for one origin
- **THEN** it shows how many outcomes it rests on
- **AND** it proposes no new value for any premise or threshold

### Requirement: Calibration reports are persisted and reviewed by a person

The register SHALL persist calibration reports: the months covered, the logic version, the model parameter set they evaluated, the distributions of coupon coverage, sample sizes and cost resolution, and how many stores would be excluded, how many products would lack data, how many pairs would pass the filters, how many opportunities would be generated and how many recommendations would be blocked, with who generated it and when. A report SHALL start as a draft and end approved or rejected by a reviewer who gives a note. A reviewed report SHALL NOT be edited. Approving a report SHALL mark the parameter set it references as approved and SHALL NOT change any business rule; rejecting it SHALL leave the set provisional.

#### Scenario: A generated report is saved as a draft

- **WHEN** an authorized user saves a calibration report
- **THEN** it is stored as a draft with its months, logic version, parameter set, figures, author and time

#### Scenario: Approval marks the parameter set approved

- **GIVEN** a draft report referencing a provisional set
- **WHEN** a reviewer approves it with a note
- **THEN** the report is approved with the reviewer and time
- **AND** the set becomes approved and references that report

#### Scenario: Rejection leaves the set provisional

- **WHEN** a reviewer rejects a draft report with a note
- **THEN** the report is rejected and the set stays provisional

#### Scenario: A review needs a note

- **WHEN** a review is sent without a note
- **THEN** it is refused and the report stays a draft

#### Scenario: A reviewed report is closed

- **GIVEN** an approved or rejected report
- **WHEN** a request tries to change its content or review it again
- **THEN** it is refused

#### Scenario: No other path approves a set

- **WHEN** a request tries to approve a parameter set without an approved report that references it
- **THEN** no such operation exists and the set stays provisional
