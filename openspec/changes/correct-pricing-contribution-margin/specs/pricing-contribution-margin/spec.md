## ADDED Requirements

### Requirement: Each expense is classified by its behaviour and counted once

The engine SHALL classify every top-level expense of the DRE (cogs, variable and fixed sections) as `percent_of_sales`, `per_transaction`, `per_visit`, `fixed`, `other_revenue_cost` or `already_component`, from a versioned parameter. Only `percent_of_sales` and `per_transaction` SHALL enter the price. Tax, card fees, the loss account and store purchases SHALL always be `already_component` and the parameters SHALL refuse another class for them. Each account SHALL land in exactly one class. Coffee break and fruit expenses SHALL NOT enter the price of a product.

#### Scenario: A locked account cannot be counted twice

- **GIVEN** the owner maps the loss account to `percent_of_sales`
- **WHEN** the parameters are validated
- **THEN** they are refused, and a report that still carries the mapping keeps the account as a component

#### Scenario: Fixed and per-visit costs stay out of the price

- **GIVEN** Contador, Pró-labore and Deslocamento in the DRE
- **WHEN** the price is solved
- **THEN** none of them is in the percentage nor in the per-transaction cost, and they are reported as classes with their shares

### Requirement: An unclassified expense makes the calculation incomplete

An expense with no class SHALL be listed with its value, the months and the scope (store or network), SHALL stay out of the price, and, when it is above the configured relevance, SHALL mark the report and every product as not validated. The number SHALL still be shown.

#### Scenario: Marketing without a class

- **GIVEN** an account 4.2.07 above the relevance threshold with no class
- **WHEN** the report is computed
- **THEN** the report and each product say "Cálculo incompleto" with the value, months and scope, and are not validated

### Requirement: The target applies to the contribution margin

The engine SHALL solve the price as `(cost/(1−loss) + fixed payment fee + per-transaction cost per unit) ÷ (1 − tax − payment % − percent-of-sales − margin)`. The percentages SHALL come off the price; the per-transaction amount SHALL be money per sold unit added to the numerator and SHALL NOT be multiplied by the loss. When the denominator is zero or negative the engine SHALL report that the target is not reachable by the formula and SHALL NOT return a price. The result SHALL carry the contribution margin, the contribution per unit and the estimated result after allocation with its criterion, never called net profit.

#### Scenario: Unreachable target

- **GIVEN** percentages and target that add up to 100% or more
- **WHEN** the price is solved
- **THEN** no price is returned and the reason says the target is not reachable by the formula

### Requirement: A per-transaction cost is distributed by ticket and unit

The cost SHALL be shared first equally over tickets and then, inside each ticket, by quantity, in whole centavos whose sum equals the total. Without a coupon in the sales detail each line SHALL count as a ticket and the result SHALL state that hypothesis.

#### Scenario: A line with several units

- **GIVEN** one ticket of R$ 1,00 with 3 units of A and 1 unit of B
- **WHEN** it is distributed
- **THEN** A receives 75 cents and B 25 cents, 25 cents per unit each

### Requirement: Cost bases are not mixed

The result SHALL keep apart the historical cost the diagnosis used, the cost of the last received purchase (with or without an invoice, by the day it was received) and the cadastral or manual cost in force. A manual version without a received purchase SHALL NOT be labelled a confirmed purchase. A replacement quote SHALL exist only as an explicit input of the simulation.

#### Scenario: Manual cost newer than the last purchase

- **GIVEN** a received purchase on 02/10 and a manual correction on 04/10
- **WHEN** the report is computed
- **THEN** the last purchase is the 02/10 cost, the manual one is shown as cadastral or manual, and the period stays valued at the historical cost

### Requirement: The new margin is reconciled with the previous model

For each product the result SHALL show the previous economic margin, the new contribution margin and one line per difference (reclassified costs, costs of other activities removed, double counting corrected, unclassified accounts left out, change of base for per-transaction costs) and the part not explained.

#### Scenario: Monster of September

- **GIVEN** the previous model gave 16,0%
- **WHEN** the reconciliation is built
- **THEN** the sum of the lines equals the difference between the margins and "not explained" is zero

### Requirement: The fixed payment fee reaches the price per unit, not per line

The fixed fee charged per sale SHALL be spread over the units of its ticket by quantity and enter the price as the part of ONE unit. The sales service SHALL report, per payment method, the units, the tickets (distinct coupons plus each coupon-less line counted as a ticket) and how many lines had no coupon. Lines without a coupon SHALL NOT be merged by guess. The total fee SHALL be labelled an estimate (registered fee × counted tickets), never an observed charge, and an approximation SHALL be named wherever the figure is shown. The distributed amounts SHALL add up to the known total of the fees.

#### Scenario: A line of three units

- **GIVEN** one voucher sale of R$ 0,89 with a line of 3 units
- **WHEN** the fee is distributed
- **THEN** the 3 units share R$ 0,89 (about R$ 0,30 each), not R$ 0,89 each

#### Scenario: No coupon in the sales detail

- **GIVEN** no line carries a coupon
- **WHEN** the fee per unit is computed
- **THEN** each line is counted as a ticket, the basis is `line_approximation` and the note says the total is an estimate

### Requirement: Travel is an average per restocking, outside the price

The report SHALL state the estimated average travel cost per restocking as the month's spend on the per-visit account divided by the restocking visits of the SAME month and scope, with the months and values used. Months with no spend figure, with no visit record or with zero visits SHALL be excluded with their reason (no division by zero, no cost of zero assumed), and numerator and denominator SHALL cover the same months. A per-store figure SHALL exist only from real per-store visit counts and SHALL be labelled an estimated apportionment. The figure SHALL state that it is an average, that the account does not separate the activity and so is not exclusive to the minimarket, and SHALL NOT enter the contribution margin nor be counted again after being distributed.

#### Scenario: A month without visit records

- **GIVEN** September has spend but no visit row
- **WHEN** the average is computed
- **THEN** September is excluded with its reason and its spend is not in the numerator

### Requirement: A previous report keeps its metric and every calculation is preserved

A stored report SHALL keep the name and definition of the margin it was computed with: a report of an engine before `pricing-4` is the economic margin and SHALL NOT be shown as the contribution margin. The screen SHALL show the engine version, the rules version, the period and the bases of the report in view. Recalculating SHALL create a new run and leave every earlier one unchanged and readable.

#### Scenario: Recalculating

- **GIVEN** a completed `pricing-3` run
- **WHEN** the owner recalculates
- **THEN** a new run exists, the earlier report is byte-for-byte as before and is still listed and readable

### Requirement: A received line that received no unit is not a purchase

A line of a received purchase whose received quantity is zero SHALL NOT create a cost and SHALL be marked `skipped_not_received`; a pending order SHALL NOT appear as a received purchase; a manual cost without a received purchase SHALL stay a cadastral or manual cost.

#### Scenario: Partial receipt

- **GIVEN** an order of two lines, one received 40 of 100 and one received 0 of 50
- **WHEN** the costs are synchronised
- **THEN** the first creates a cost over 40 units and the second creates none

### Requirement: A ticket is a purchase, identified by evidence

The fixed payment fee SHALL be counted once per ticket, where a ticket is identified by the coupon, else the transaction code, else the acquirer code. A line carrying none of them SHALL NOT be assumed to be a ticket of its own: its tickets SHALL be estimated from the tickets-per-line ratio of the identified lines, and labelled an approximation, or SHALL be unknown (and the fixed fee not distributed, with the cost marked incomplete) when too few lines are identified.

#### Scenario: Real sales
- **GIVEN** 21.403 lines whose transaction codes form 17.370 purchases
- **WHEN** the fixed fee is distributed
- **THEN** it is charged on 17.370 tickets, not on 21.403 lines

#### Scenario: Almost no line is identified
- **WHEN** fewer lines than the configured share carry an identifier
- **THEN** the tickets are unknown, the fixed fee is not distributed and the reason is stated

### Requirement: The payment mix is the product's, the category's or the network's, else no price

The percentage payment fees and the voucher share SHALL be weighted by the product's own payment mix when it has at least the configured receipt lines, else by its category's, else by the network's with the same minimum. With no reliable mix at any level the system SHALL NOT recommend a price and SHALL name the missing data. A product without history SHALL start at the category level. The result SHALL say which level was used.

#### Scenario: A product with little data of its own
- **GIVEN** a product with fewer lines than the minimum and a category with more
- **THEN** the category's mix weighs its fees and the result says "category"

### Requirement: The loss rate states its denominator

The loss rate SHALL be the units removed as loss divided by the units supplied to the stores in the window, and the result SHALL show the lost, supplied and sold units and the supplied units that were neither sold nor lost. The unit cost SHALL be the cost divided by one minus that rate.

#### Scenario: The units behind a rate
- **GIVEN** 1814 units removed as loss and 20190 supplied
- **THEN** the rate is 9,0% and the result lists the sold units and the supplied units that were neither sold nor lost

### Requirement: A maximum-increase limit is stated, never silent

When the maximum-increase limit stops the price short of the target margin, the result SHALL show the limited price, the margin it gives and the statement "Margem abaixo da meta devido ao limite máximo de aumento configurado.". The minimum-margin price SHALL be labelled the floor price (the price needed for the minimum margin).

#### Scenario: Target out of reach under the limit
- **GIVEN** a target price of R$ 17,30 and a ceiling of R$ 17,20
- **THEN** the recommended price is R$ 17,20, the margin it gives is shown and the statement is displayed

### Requirement: An incomplete classification is shown as not validated, with what is missing

When a relevant expense of the income statement has no class, the calculation SHALL be shown marked "Precificação não validada" and SHALL list exactly which accounts are missing, with value, months and scope.

#### Scenario: Marketing without a class
- **WHEN** account 4.2.07 has no class and exceeds the relevance limit
- **THEN** every price is shown, marked as not validated, naming 4.2.07 and its value

### Requirement: The historical margin keeps its cost

A period report SHALL NOT be recomputed with today's cost: a newer cost SHALL be shown apart and the margin of the period SHALL stay as computed.

#### Scenario: A cost bought after the period
- **GIVEN** a September report at a cost of R$ 5,70 and a cost of R$ 6,20 registered on 05/10
- **THEN** the report keeps R$ 5,70 and 38,6%, and shows R$ 6,20 apart as a newer cost
