import unittest
from decimal import Decimal

import retail_finance as rf


D = Decimal


class TestGrossAndContributionMargin(unittest.TestCase):
    def test_gross_margin_pct(self):
        # Test A fixture: Revenue 42000, COGS 27300 -> gross profit 14700
        margin = rf.gross_margin_pct(D("42000"), D("27300"))
        self.assertEqual(margin, D("0.3500"))

    def test_gross_margin_requires_positive_revenue(self):
        with self.assertRaises(ValueError):
            rf.gross_margin_pct(D("0"), D("100"))

    def test_contribution_margin_pct(self):
        margin = rf.contribution_margin_pct(D("42000"), D("7560"))
        self.assertEqual(margin, D("0.1800"))


class TestBreakEven(unittest.TestCase):
    def test_break_even_revenue(self):
        result = rf.break_even_revenue(D("5000"), D("0.18"))
        self.assertEqual(result, D("27777.78"))

    def test_break_even_transactions(self):
        result = rf.break_even_transactions(D("27777.78"), D("15.50"))
        self.assertEqual(result, D("1792.11"))

    def test_break_even_zero_contribution_margin_raises(self):
        with self.assertRaises(ValueError):
            rf.break_even_revenue(D("5000"), D("0"))


class TestInventoryMetrics(unittest.TestCase):
    def test_gmroi_monetary(self):
        # SKU A: high margin, low turnover
        result = rf.gmroi(D("3000"), D("12000"))
        self.assertEqual(result, D("0.2500"))

    def test_gmroi_high_turnover_sku(self):
        # SKU B: lower margin, high turnover, much better GMROI
        result = rf.gmroi(D("1800"), D("1500"))
        self.assertEqual(result, D("1.2000"))

    def test_inventory_turnover(self):
        result = rf.inventory_turnover(D("27300"), D("9100"))
        self.assertEqual(result, D("3.0000"))

    def test_days_inventory_outstanding(self):
        result = rf.days_inventory_outstanding(D("3"), D("30"))
        self.assertEqual(result, D("10.00"))

    def test_dio_zero_turnover_raises(self):
        with self.assertRaises(ValueError):
            rf.days_inventory_outstanding(D("0"))


class TestCashConversionCycle(unittest.TestCase):
    def test_ccc_no_ar(self):
        result = rf.cash_conversion_cycle(D("18.5"), D("0"), D("30"))
        self.assertEqual(result, D("-11.50"))


class TestPayback(unittest.TestCase):
    def test_payback_period_simple(self):
        # Test B fixture: CAPEX 35000 + initial inventory 15000 = 50000
        # revenue 38000 * contribution margin 18% = 6840/month
        investment = D("35000") + D("15000")
        monthly_contribution = D("38000") * D("0.18")
        result = rf.payback_period_simple(investment, monthly_contribution)
        self.assertEqual(result, D("7.31"))

    def test_payback_period_schedule_flat(self):
        result = rf.payback_period_schedule(D("6000"), [D("2000")] * 5)
        self.assertEqual(result, D("3.00"))

    def test_payback_period_schedule_ramping(self):
        result = rf.payback_period_schedule(
            D("10000"), [D("1000"), D("2000"), D("3000"), D("4000"), D("5000")]
        )
        # cumulative: 1000, 3000, 6000, 10000 -> hits exactly at month 4
        self.assertEqual(result, D("4"))

    def test_payback_period_never_recovered_raises(self):
        with self.assertRaises(ValueError):
            rf.payback_period_schedule(D("100000"), [D("100")] * 3)


class TestRoic(unittest.TestCase):
    def test_roic(self):
        result = rf.roic(D("12000"), D("50000"))
        self.assertEqual(result, D("0.2400"))


class TestImplicitFinancingRate(unittest.TestCase):
    def test_supplier_discount_example(self):
        # Test C fixture: 4% discount for paying 45 days early
        result = rf.implicit_financing_rate(D("0.04"), D("45"))
        self.assertEqual(result, D("0.3380"))

    def test_discount_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            rf.implicit_financing_rate(D("1.5"), D("30"))
        with self.assertRaises(ValueError):
            rf.implicit_financing_rate(D("0"), D("30"))


class TestToDecimal(unittest.TestCase):
    def test_from_string(self):
        self.assertEqual(rf.to_decimal("42000.50"), D("42000.50"))

    def test_from_int(self):
        self.assertEqual(rf.to_decimal(100), D("100"))

    def test_invalid_raises(self):
        with self.assertRaises(ValueError):
            rf.to_decimal("not-a-number")


if __name__ == "__main__":
    unittest.main()
