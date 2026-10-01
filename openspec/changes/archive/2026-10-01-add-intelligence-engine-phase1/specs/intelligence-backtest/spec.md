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

### Requirement: Each recommendation is recorded with what followed

For every Product × Store with enough data at an origin, the backtest SHALL record the baseline quantity in force, the quantity and action the engine would have recommended (keep, reduce, increase, test, evaluate removal, no evidence to change), the Mix state, and what happened in the following period: units sold, units lost by reason, and the economic result (margin minus cost of units lost, with a lost unit counted once and never also netted against sold units).

#### Scenario: One recommendation, fully recorded

- **GIVEN** a Product × Store with enough history at an origin
- **WHEN** the backtest replays it
- **THEN** the report shows the baseline, the recommended quantity and action, and the sales, losses and economic result that followed

#### Scenario: Not enough data

- **GIVEN** a Product × Store without enough data at an origin
- **WHEN** the backtest replays it
- **THEN** it is not given a recommendation outcome and is counted under its coverage category instead

### Requirement: Coherence means only "compatible with the data that followed"

The backtest SHALL assess each recommendation against the data that followed and class it coherent, incoherent or inconclusive. **Coherent SHALL mean only that the following data are compatible with the recommendation under the stated criteria.** It SHALL NOT be presented, worded or counted as proof that the recommendation was correct or that it would have worked, because history cannot be replayed under another quantity. Every assessment SHALL be labelled an estimate and SHALL show the criteria used. Where the evidence points in conflicting directions, the class SHALL be inconclusive.

#### Scenario: Wording of the class

- **WHEN** the report shows a coherent recommendation
- **THEN** it states that the following data are compatible with it under the criteria shown
- **AND** nothing in the report says it was correct, validated or would have worked

#### Scenario: Conflicting evidence

- **GIVEN** a recommendation whose following data support it on one criterion and contradict it on another
- **WHEN** coherence is assessed
- **THEN** it is classed inconclusive

### Requirement: Reduction recommendations show their evidence separately

For every reduce recommendation the report SHALL show, as separate figures and never combined into one score: the losses that followed (by reason), the sales that followed, the following cycles in which demand exceeded the recommended quantity, the units of loss that were potentially avoidable, and the units of sales potentially at risk. Potentially avoidable loss SHALL be an upper bound limited by the headroom between the baseline and the recommended quantity, and potentially at-risk sales SHALL be the units consumed in a cycle above the recommended quantity.

#### Scenario: A reduction with mixed evidence

- **GIVEN** a reduce recommendation followed by expired units lost and by one cycle that consumed more than the recommended quantity
- **WHEN** the report is read
- **THEN** it shows the losses, the sales, the one cycle above the recommended quantity, the potentially avoidable units and the units potentially at risk, each separately
- **AND** the class is inconclusive because the evidence conflicts

#### Scenario: A reduction compatible with the data

- **GIVEN** a reduce recommendation followed by lost units and no cycle above the recommended quantity
- **WHEN** coherence is assessed
- **THEN** the class is coherent under the criteria shown, with zero units at risk and the potentially avoidable units labelled an estimate

### Requirement: Other actions are assessed with their own stated criteria

An increase or test SHALL be assessed on whether stock-outs or consumption above the baseline followed, with low loss. A keep SHALL be assessed on the absence of stock-outs and of recurring loss. An evaluate-removal SHALL be assessed on whether demand and the economic result stayed low afterwards. Each SHALL be classed coherent, incoherent or inconclusive with the criteria shown beside the counts, and a recommendation with fewer following cycles than the minimum needed SHALL be inconclusive.

#### Scenario: An increase not supported afterwards

- **GIVEN** an increase recommendation after which no stock-out occurred and demand fell
- **WHEN** coherence is assessed
- **THEN** it is classed incoherent

#### Scenario: Too little afterwards

- **GIVEN** a recommendation with fewer following cycles than the minimum
- **WHEN** coherence is assessed
- **THEN** it is classed inconclusive

### Requirement: The parametrized quantity of the time is stated honestly

The backtest SHALL use the baseline quantity that was in force at each origin according to the stored baseline history. When no history exists for an origin, it SHALL use the baseline of record and SHALL state, next to every figure that depends on it, that the quantity of the time is unknown.

#### Scenario: Origin before the first recorded baseline

- **GIVEN** an origin dated before the first stored baseline
- **WHEN** the backtest runs
- **THEN** it uses the baseline of record and marks the affected results as using it

### Requirement: Coverage of the analysis is reported with exclusive categories

The backtest and the engine run report SHALL classify every Product × Store into exactly one of: insufficient history, conflicting data, analysable with reliable balance, analysable with unreliable balance, analysable with not enough counts. The categories SHALL add up to the total of Product × Store considered, and the report SHALL state how many can be analysed.

#### Scenario: Categories add up

- **WHEN** the coverage is reported
- **THEN** the five categories sum to the number of Product × Store considered
- **AND** each Product × Store appears in one category only

#### Scenario: Conflicting data wins over balance status

- **GIVEN** a Product × Store with conflicting data and a balance within tolerance
- **WHEN** the coverage is reported
- **THEN** it is counted as conflicting data

### Requirement: The impact of the count rules is shown before they are definitive

The backtest SHALL produce a sensitivity report that recomputes the coverage under alternative values of the number of counts considered, the minimum number of counts, the maximum age of the last count and the tolerance, on the same data, and SHALL present the cover each combination gives. It SHALL NOT recommend or select a combination. The configured defaults SHALL be described as provisional until the owner has reviewed this report.

#### Scenario: Comparing rules

- **WHEN** the sensitivity report is produced
- **THEN** it shows, for each combination, how many Product × Store are within tolerance, outside tolerance and not verifiable
- **AND** it does not mark any combination as chosen

#### Scenario: The current defaults appear among the combinations

- **WHEN** the sensitivity report is produced
- **THEN** the currently configured values appear as one of the combinations so the owner can see their impact

### Requirement: The backtest decides nothing

The backtest SHALL NOT freeze a threshold, label the engine as accepted or rejected, or change any parameter. Its output SHALL be a report to be read with the owner, stating its coverage (origins, Product × Store pairs and cycles included) next to every figure.

#### Scenario: Report states coverage

- **WHEN** the backtest report is produced
- **THEN** every aggregate shows how many origins, pairs and cycles it covers
- **AND** no figure is labelled as passing or failing, and "coherent" is never presented as an approval or as proof

### Requirement: Backtest uses real history and writes no synthetic data

The backtest SHALL read the platform's real stored history. Tests SHALL use fixtures shaped like the real reports, and no synthetic data SHALL be written into any real database.

#### Scenario: Test isolation

- **WHEN** the test suite runs
- **THEN** it uses an isolated database and in-memory fixtures
