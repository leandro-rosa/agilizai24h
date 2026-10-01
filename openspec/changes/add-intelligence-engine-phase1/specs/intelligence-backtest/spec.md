## Purpose

Checks the engine against history before any screen shows its recommendations, so thresholds are frozen only after seeing how the engine would have behaved on data it had not yet seen.

## ADDED Requirements

### Requirement: Rolling-origin replay without look-ahead

The backtest SHALL replay the engine at successive origin dates over the available history. At each origin the engine SHALL be given only data that ended before that origin, and its results SHALL be compared with what actually happened afterwards. No datum dated after an origin SHALL influence that origin's results.

#### Scenario: Origin in the middle of the history

- **GIVEN** an origin at the start of June
- **WHEN** the engine runs for that origin
- **THEN** no visit, sale or removal dated June or later is read

### Requirement: Demand-forecast error is reported

For each origin the backtest SHALL compare the engine's predicted consumption for the following period with the consumption actually observed between visits, and SHALL report the error per Product × Store and in aggregate, excluding censored observations from the actuals and counting them separately.

#### Scenario: Censored actuals

- **GIVEN** a following period that ended in a stock-out
- **WHEN** the error is computed
- **THEN** that observation is counted as censored and excluded from the error

### Requirement: Outcomes after each recommendation are reported

The backtest SHALL report, for each Quantity and Mix recommendation, what happened in the following cycles: whether a stock-out occurred, how much expired, and how the baseline would have covered demand. These SHALL be descriptive counts and rates.

#### Scenario: A reduction followed by stock-outs

- **GIVEN** a reduce recommendation at an origin
- **WHEN** the following cycles show stock-outs
- **THEN** the report counts them against that recommendation

### Requirement: The backtest decides nothing

The backtest SHALL NOT freeze a threshold, label the engine as accepted or rejected, or change any parameter. Its output SHALL be a report to be read with the owner, stating its coverage (origins, Product × Store pairs and cycles included) next to every figure.

#### Scenario: Report states coverage

- **WHEN** the backtest report is produced
- **THEN** every aggregate shows how many origins, pairs and cycles it covers
- **AND** no figure is labelled as passing or failing

### Requirement: Backtest uses real history and writes no synthetic data

The backtest SHALL read the platform's real stored history. Tests SHALL use fixtures shaped like the real reports, and no synthetic data SHALL be written into any real database.

#### Scenario: Test isolation

- **WHEN** the test suite runs
- **THEN** it uses an isolated database and in-memory fixtures
