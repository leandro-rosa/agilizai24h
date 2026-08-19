"""Deterministic retail-finance calculations for autonomous-retail-cfo.

Decimal throughout — never float — because these numbers get checked by
hand against operator spreadsheets. Every function takes and returns
Decimal. Callers convert at the boundary (e.g. Decimal(str(value))).
"""

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

TWO_PLACES = Decimal("0.01")
FOUR_PLACES = Decimal("0.0001")


def _round(value: Decimal, places: Decimal = FOUR_PLACES) -> Decimal:
    return value.quantize(places, rounding=ROUND_HALF_UP)


def _require_positive(name: str, value: Decimal) -> None:
    if value <= 0:
        raise ValueError(f"{name} must be > 0, got {value}")


def gross_margin_pct(net_revenue: Decimal, cogs: Decimal) -> Decimal:
    """Gross margin % = (Net Revenue - COGS) / Net Revenue."""
    _require_positive("net_revenue", net_revenue)
    return _round((net_revenue - cogs) / net_revenue)


def contribution_margin_pct(net_revenue: Decimal, store_contribution: Decimal) -> Decimal:
    """Contribution margin % = Store Contribution / Net Revenue."""
    _require_positive("net_revenue", net_revenue)
    return _round(store_contribution / net_revenue)


def break_even_revenue(fixed_costs: Decimal, contribution_margin: Decimal) -> Decimal:
    """Break-even revenue = Fixed costs / Contribution margin %."""
    _require_positive("contribution_margin", contribution_margin)
    return _round(fixed_costs / contribution_margin, TWO_PLACES)


def break_even_transactions(break_even_rev: Decimal, average_ticket: Decimal) -> Decimal:
    """Break-even transactions = Break-even revenue / Average ticket."""
    _require_positive("average_ticket", average_ticket)
    return _round(break_even_rev / average_ticket, TWO_PLACES)


def gmroi(gross_profit: Decimal, average_inventory_cost: Decimal) -> Decimal:
    """GMROI = Gross Profit (R$, monetary) / Average Inventory Cost (R$)."""
    _require_positive("average_inventory_cost", average_inventory_cost)
    return _round(gross_profit / average_inventory_cost)


def inventory_turnover(cogs: Decimal, average_inventory_cost: Decimal) -> Decimal:
    """Inventory turnover = COGS / Average Inventory Cost, for the period."""
    _require_positive("average_inventory_cost", average_inventory_cost)
    return _round(cogs / average_inventory_cost)


def days_inventory_outstanding(turnover: Decimal, period_days: Decimal = Decimal("365")) -> Decimal:
    """DIO = period_days / turnover. Use 365 for an annualized turnover."""
    _require_positive("turnover", turnover)
    return _round(period_days / turnover, TWO_PLACES)


def cash_conversion_cycle(dio: Decimal, dso: Decimal, dpo: Decimal) -> Decimal:
    """CCC = DIO + DSO - DPO."""
    return _round(dio + dso - dpo, TWO_PLACES)


def payback_period_simple(investment: Decimal, monthly_contribution: Decimal) -> Decimal:
    """Payback (months) = Investment / Monthly contribution, flat-ramp case."""
    _require_positive("monthly_contribution", monthly_contribution)
    return _round(investment / monthly_contribution, TWO_PLACES)


def payback_period_schedule(investment: Decimal, monthly_contributions: list) -> Decimal:
    """Payback (months) from a ramping monthly-contribution schedule.

    Returns the fractional month at which cumulative contribution first
    equals or exceeds the investment. Raises ValueError if it never does
    within the supplied schedule.
    """
    cumulative = Decimal("0")
    for month_index, contribution in enumerate(monthly_contributions, start=1):
        prev_cumulative = cumulative
        cumulative += contribution
        if cumulative >= investment:
            if contribution == 0:
                return Decimal(month_index)
            remaining = investment - prev_cumulative
            fraction = remaining / contribution
            return _round(Decimal(month_index - 1) + fraction, TWO_PLACES)
    raise ValueError("investment not recovered within the supplied schedule")


def roic(nopat: Decimal, invested_capital: Decimal) -> Decimal:
    """ROIC = NOPAT / Invested Capital (CAPEX + working capital tied up)."""
    _require_positive("invested_capital", invested_capital)
    return _round(nopat / invested_capital)


def implicit_financing_rate(discount_pct: Decimal, days_early: Decimal) -> Decimal:
    """Annualized implied rate of an early/cash-payment discount.

    rate ~= [d / (1 - d)] * (365 / days_early)
    """
    if not (0 < discount_pct < 1):
        raise ValueError("discount_pct must be between 0 and 1 exclusive")
    _require_positive("days_early", days_early)
    return _round((discount_pct / (Decimal("1") - discount_pct)) * (Decimal("365") / days_early))


def to_decimal(value) -> Decimal:
    """Safe str-first conversion — never construct Decimal from a float."""
    try:
        return Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"cannot convert {value!r} to Decimal") from exc
