## Purpose

How the admin panel reads the official business rules, lets the people allowed to do so change them with a reason, shows their history and the provisional or approved state of the logic, and records decisions, outcomes and calibration reviews, without ever keeping a rule that shapes a recommendation in the browser.

## ADDED Requirements

### Requirement: The effective business rules come from the register

The Inteligência Comercial page SHALL read the business rules from the register and apply those values to everything it computes, in place of the deployment defaults. The "Regras de negócio" sheet SHALL show, for each rule, its value, unit, bounds, and the user, time and reason of its last change. The sheet SHALL no longer state that the official register is pending. No business rule SHALL be stored in the browser.

#### Scenario: Two viewers see the same rules

- **GIVEN** the register holds a minimum combo margin of 35%
- **WHEN** two users open the page
- **THEN** both see 35% in the sheet and both receive recommendations computed with 35%

#### Scenario: The sheet shows who changed a rule and why

- **GIVEN** a rule last changed by a manager with a reason
- **WHEN** the sheet is opened
- **THEN** the rule shows that manager, the time and the reason

#### Scenario: Nothing about the rules is kept in the browser

- **WHEN** the page has been used, including a rule edit
- **THEN** the browser storage holds no business-rule value

### Requirement: Only users allowed to change rules can edit them

The sheet SHALL offer editing only to users holding `intelligence:rules`; everyone else SHALL see the values read-only. Editing SHALL require a new value inside the shown bounds and a reason, and SHALL send the version the user saw. On a conflict the sheet SHALL show the current value and who changed it and SHALL ask the user to review before trying again. After a successful change the page SHALL recompute with the new value at once for that user, and every other viewer SHALL receive it on their next load of the register.

#### Scenario: A user without permission cannot edit

- **GIVEN** a user without `intelligence:rules`
- **WHEN** the sheet is opened
- **THEN** no editing control is present

#### Scenario: A change needs a reason

- **GIVEN** a user with `intelligence:rules` editing a value
- **WHEN** the reason is empty
- **THEN** the change cannot be submitted

#### Scenario: A value outside the bounds cannot be submitted

- **WHEN** the typed value is outside the bounds shown for the rule
- **THEN** the form says so and does not submit

#### Scenario: A conflict is explained, not overwritten

- **GIVEN** another manager changed the rule after the sheet was opened
- **WHEN** the edit is submitted
- **THEN** the sheet shows the current value, who set it and when
- **AND** the user's value is not applied

#### Scenario: A successful change applies immediately

- **WHEN** a change is accepted
- **THEN** the numbers and the recommendations on the page reflect the new value without reloading the page

### Requirement: The history of a rule is visible

The sheet SHALL let any user with `intelligence:read` open the history of a rule, listing every change with previous value, new value, user, time and reason, newest first.

#### Scenario: The history opens from the rule

- **WHEN** the history of a rule is opened
- **THEN** every change is listed with previous and new value, user, time and reason

### Requirement: When the register cannot be read, recommendations are withheld

If the register of business rules cannot be read, or the user lacks `intelligence:read`, the page SHALL keep showing the descriptive numbers and the data-quality indicators and SHALL NOT produce or show recommendations, opportunity rankings, the impact estimate or any decision action. It SHALL say why: unavailable, with a way to retry, or no permission. It SHALL NOT fall back silently to the deployment defaults.

#### Scenario: The register is unreachable

- **GIVEN** the register does not answer
- **WHEN** the page loads
- **THEN** the KPIs and the "Qualidade dos dados" tab are shown
- **AND** the opportunity areas say the business rules are unavailable and offer a retry

#### Scenario: The user cannot read the register

- **GIVEN** a user without `intelligence:read`
- **WHEN** the page loads
- **THEN** recommendations are withheld with a message that the permission is missing
- **AND** the deployment defaults are not used in their place

### Requirement: The provisional or approved state comes from the register

The advanced page SHALL show the logic version and, for the parameter set the running page uses, whether it is provisional or approved. It SHALL mark every data-quality and analytic parameter "provisório" unless that set is registered as approved, and for an approved set SHALL show the approving calibration report, its reviewer and time. If the register cannot be read the page SHALL show "provisório" and say the state could not be confirmed.

#### Scenario: A provisional set

- **GIVEN** a running parameter set that is not approved
- **WHEN** the advanced page is opened
- **THEN** every parameter is marked "provisório"

#### Scenario: An approved set

- **GIVEN** a running set approved by a calibration report
- **WHEN** the advanced page is opened
- **THEN** the parameters are not marked provisório
- **AND** the report, reviewer and time of approval are shown

### Requirement: A decision on a recommendation records its snapshot

A user holding `intelligence:write` SHALL be able to accept, reject (with a note) or turn into an experiment (with a planned window) any recommendation shown in the detail of an opportunity. The page SHALL send the snapshot it computed: logic version, parameter set, business-rule values, evidence summary, impact scenarios, confidence, scope and period. The detail SHALL show the trail of decisions on that recommendation with users and times. Users without the permission SHALL see the trail and no action.

#### Scenario: Accepting records the snapshot

- **GIVEN** an opportunity open in its detail
- **WHEN** an authorized user accepts it
- **THEN** the decision and the snapshot are registered
- **AND** the trail shows the decision with the user and time

#### Scenario: Rejecting needs a note

- **WHEN** the user chooses to reject
- **THEN** the form requires a note before it can be submitted

#### Scenario: A user without permission sees no actions

- **GIVEN** a user with `intelligence:read` only
- **WHEN** an opportunity is opened
- **THEN** the trail is visible and no decision control is present

### Requirement: Outcomes and the estimate comparison are shown with their base

For a decision that was accepted or turned into an experiment, an authorized user SHALL be able to record the outcome: the window observed, the impact realized per month and a note. The page SHALL show the three estimated scenarios beside the realized impact, and any aggregate SHALL state how many outcomes it rests on. The page SHALL state that outcomes do not change any threshold or premise by themselves.

#### Scenario: Outcome next to estimate

- **GIVEN** an experiment with an outcome
- **WHEN** its detail is opened
- **THEN** the conservative, expected and optimistic estimates are shown beside the realized impact

#### Scenario: An aggregate names its base

- **WHEN** an aggregate comparison is shown
- **THEN** it says how many outcomes it is built on

### Requirement: Calibration reports are saved and reviewed from the advanced page

The advanced page SHALL let an authorized user save the calibration report produced from the real months, and let a user holding `intelligence:rules` approve or reject it with a note. It SHALL show each report's status, months covered, author, reviewer and note. Approval SHALL be presented as a decision about the parameter set, never as a way to change a business rule.

#### Scenario: Saving a report

- **WHEN** an authorized user saves a generated report
- **THEN** it appears as a draft with its months, author and time

#### Scenario: Reviewing needs the right permission and a note

- **GIVEN** a draft report
- **WHEN** a user without `intelligence:rules` opens it
- **THEN** no approve or reject control is present
- **AND** for a user with the permission, the controls require a note before they submit
