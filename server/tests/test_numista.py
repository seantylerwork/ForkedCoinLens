import os
import sys
import unittest
from unittest import mock

SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import app as coinlens_app


def identification(**overrides):
    base = {
        "identifiable": True, "country": "Canada", "denomination": "1 dollar",
        "year": "2016", "mint_mark": None, "estimated_grade": "AU-50",
    }
    base.update(overrides)
    return base


class ScoreBreakdownTests(unittest.TestCase):
    def test_country_and_denomination_match_score_higher_than_country_alone(self):
        right_denomination = {
            "id": 1, "title": "1 Dollar - Elizabeth II (Loon)",
            "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": 2016,
        }
        wrong_denomination = {
            "id": 2, "title": "1 Cent - Victoria",
            "issuer": {"name": "Canada"}, "min_year": 1858, "max_year": 1901,
        }

        right_score, right_breakdown = coinlens_app._score_numista_candidate_breakdown(identification(), right_denomination)
        wrong_score, wrong_breakdown = coinlens_app._score_numista_candidate_breakdown(identification(), wrong_denomination)

        self.assertGreater(right_score, wrong_score)
        self.assertIn("denomination_in_title", right_breakdown)
        self.assertIn("year_in_type_range", right_breakdown)
        self.assertNotIn("denomination_in_title", wrong_breakdown)

    def test_wrong_country_candidate_gets_no_country_credit(self):
        """Reproduces the real 'Canada 1 dollar' search: an Australian '1
        Dollar' type matches the denomination text but must not get the
        country bonus just because 'dollar' is a common word."""
        australian = {
            "id": 3, "title": "1 Dollar - Elizabeth II",
            "issuer": {"name": "Australia"}, "min_year": 2010, "max_year": 2010,
        }
        score, breakdown = coinlens_app._score_numista_candidate_breakdown(identification(), australian)
        self.assertNotIn("country_issuer_match", breakdown)
        self.assertIn("denomination_in_title", breakdown)
        self.assertEqual(score, 2)


class IssueMatchingTests(unittest.TestCase):
    def test_issue_matches_exact_year(self):
        self.assertTrue(coinlens_app._issue_matches_year({"year": 2012}, "2012"))

    def test_issue_matches_year_range(self):
        self.assertTrue(coinlens_app._issue_matches_year({"min_year": 2010, "max_year": 2015}, "2012"))

    def test_issue_does_not_match_other_year(self):
        self.assertFalse(coinlens_app._issue_matches_year({"year": 2011}, "2012"))

    def test_non_numeric_year_never_matches(self):
        self.assertFalse(coinlens_app._issue_matches_year({"year": 2012}, "Unknown"))

    def test_select_issue_for_year_picks_the_matching_one(self):
        issues = [{"id": "i1", "year": 2011}, {"id": "i2", "year": 2012}, {"id": "i3", "year": 2013}]
        selected = coinlens_app._select_issue_for_year(identification(year="2012"), issues)
        self.assertEqual(selected["id"], "i2")

    def test_select_issue_for_year_returns_none_when_no_year_matches(self):
        issues = [{"id": "i1", "year": 2011}, {"id": "i3", "year": 2013}]
        selected = coinlens_app._select_issue_for_year(identification(year="2012"), issues)
        self.assertIsNone(selected)

    def test_select_issue_disambiguates_by_mint_mark_when_tied_on_year(self):
        issues = [
            {"id": "philly", "year": 2012, "mint_letter": "P"},
            {"id": "denver", "year": 2012, "mint_letter": "D"},
        ]
        selected = coinlens_app._select_issue_for_year(identification(year="2012", mint_mark="D"), issues)
        self.assertEqual(selected["id"], "denver")

    def test_select_issue_falls_back_to_first_year_match_when_mint_unspecified(self):
        issues = [
            {"id": "philly", "year": 2012, "mint_letter": "P"},
            {"id": "denver", "year": 2012, "mint_letter": "D"},
        ]
        selected = coinlens_app._select_issue_for_year(identification(year="2012", mint_mark=None), issues)
        self.assertEqual(selected["id"], "philly")


class ResolveTypeAndIssueTests(unittest.TestCase):
    """Core regression coverage for the real production bug: title/country
    scoring alone picked a wrong-era 'Cent' candidate over the correct
    'Dollar' type for a real Canada scan. These tests construct a candidate
    pair where the WRONG one deliberately outscores the RIGHT one (as
    happened for real, since Numista's title omits the leading '1' for the
    correct type) and assert the issue-year check still finds the correct
    one instead of trusting the raw score."""

    def test_prefers_issue_confirmed_candidate_over_a_higher_scored_wrong_one(self):
        # Deliberately scores higher than the correct candidate below (5 vs
        # 3) by having a coincidentally-overlapping year range - simulating
        # a scoring/title-format weakness, not a contrived edge case.
        higher_scored_wrong_era = {
            "id": 1, "title": "1 Cent - Victoria",
            "issuer": {"name": "Canada"}, "min_year": 2010, "max_year": 2020,
        }
        # Numista's real title for this type omits the leading "1" (just
        # "Dollar", not "1 Dollar"), so our denomination substring check
        # misses it - this is the correct type, but scores lower.
        lower_scored_right_coin = {
            "id": 999, "title": "Dollar - Elizabeth II (Loon)",
            "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": None,
        }

        def fake_issues(type_id):
            if type_id == 999:
                return [{"id": "iss-2016", "year": 2016}]
            return [{"id": "iss-2010", "year": 2010}]

        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=fake_issues):
            best, issue = coinlens_app.resolve_numista_type_and_issue(
                identification(), [higher_scored_wrong_era, lower_scored_right_coin]
            )

        self.assertEqual(best["id"], 999)
        self.assertEqual(issue["id"], "iss-2016")

    def test_returns_none_when_no_inspected_candidate_has_a_matching_issue(self):
        candidates = [{
            "id": 1, "title": "1 Dollar - Elizabeth II",
            "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": 2020,
        }]
        with mock.patch.object(coinlens_app, "fetch_numista_issues", return_value=[{"id": "iss-1990", "year": 1990}]):
            best, issue = coinlens_app.resolve_numista_type_and_issue(identification(), candidates)
        self.assertIsNone(best)
        self.assertIsNone(issue)

    def test_does_not_inspect_more_than_the_configured_candidate_cap(self):
        candidates = [
            {
                "id": i, "title": "1 Dollar - Elizabeth II",
                "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": 2020,
            }
            for i in range(10)
        ]
        with mock.patch.object(coinlens_app, "fetch_numista_issues", return_value=[]) as mock_issues:
            coinlens_app.resolve_numista_type_and_issue(identification(), candidates)
        self.assertLessEqual(mock_issues.call_count, coinlens_app.NUMISTA_MATCH_CANDIDATES_TO_INSPECT)

    def test_skips_low_scoring_candidates_without_an_issues_call(self):
        irrelevant = {
            "id": 1, "title": "Souvenir Token",
            "issuer": {"name": "France"}, "min_year": 1990, "max_year": 1990,
        }
        with mock.patch.object(coinlens_app, "fetch_numista_issues") as mock_issues:
            best, issue = coinlens_app.resolve_numista_type_and_issue(identification(), [irrelevant])
        mock_issues.assert_not_called()
        self.assertIsNone(best)


class FetchNumistaPriceTests(unittest.TestCase):
    def test_requests_the_issue_scoped_price_endpoint(self):
        """Numista v3 prices a specific issue, not a whole type - regression
        guard for the old (wrong) /types/{id}/prices path."""
        coinlens_app.NUMISTA_API_KEY = "test-key"
        response = mock.Mock(status_code=200, text='{"prices": []}')
        response.json.return_value = {"prices": []}
        with mock.patch.object(coinlens_app.requests, "get", return_value=response) as mock_get:
            coinlens_app.fetch_numista_price(999, "iss-2016", "AU-50")
        called_url = mock_get.call_args.args[0]
        self.assertEqual(called_url, f"{coinlens_app.NUMISTA_TYPES_URL}/999/issues/iss-2016/prices")


class LookupNumistaIntegrationTests(unittest.TestCase):
    def setUp(self):
        self._orig_key = coinlens_app.NUMISTA_API_KEY
        self._orig_openai_key = coinlens_app.OPENAI_API_KEY
        self._orig_mock_mode = coinlens_app.MOCK_MODE
        self._orig_use_mock = coinlens_app.USE_MOCK_COIN_RESPONSE
        coinlens_app.NUMISTA_API_KEY = "test-key"
        # should_use_mock_coin_response() also short-circuits on a missing
        # OpenAI key, independent of MOCK_MODE/USE_MOCK_COIN_RESPONSE.
        coinlens_app.OPENAI_API_KEY = "test-key"
        coinlens_app.MOCK_MODE = False
        coinlens_app.USE_MOCK_COIN_RESPONSE = False
        self.addCleanup(lambda: setattr(coinlens_app, "NUMISTA_API_KEY", self._orig_key))
        self.addCleanup(lambda: setattr(coinlens_app, "OPENAI_API_KEY", self._orig_openai_key))
        self.addCleanup(lambda: setattr(coinlens_app, "MOCK_MODE", self._orig_mock_mode))
        self.addCleanup(lambda: setattr(coinlens_app, "USE_MOCK_COIN_RESPONSE", self._orig_use_mock))

    def test_lookup_numista_sets_type_and_issue_ids_on_a_real_match(self):
        candidates = [{
            "id": 999, "title": "Dollar - Elizabeth II (Loon)",
            "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": None,
        }]
        with mock.patch.object(coinlens_app, "search_numista_types", return_value=candidates), \
             mock.patch.object(coinlens_app, "fetch_numista_issues", return_value=[{"id": "iss-2016", "year": 2016}]), \
             mock.patch.object(coinlens_app, "fetch_numista_type_detail", return_value={"composition": {"text": "Nickel"}}):
            result = coinlens_app.lookup_numista(identification())

        self.assertEqual(result["numista_type_id"], 999)
        self.assertEqual(result["numista_issue_id"], "iss-2016")
        self.assertEqual(result["composition"]["text"], "Nickel")

    def test_lookup_numista_returns_none_when_no_issue_resolves(self):
        candidates = [{
            "id": 999, "title": "1 Dollar - Elizabeth II",
            "issuer": {"name": "Canada"}, "min_year": 1987, "max_year": 2020,
        }]
        with mock.patch.object(coinlens_app, "search_numista_types", return_value=candidates), \
             mock.patch.object(coinlens_app, "fetch_numista_issues", return_value=[{"id": "iss-1990", "year": 1990}]):
            result = coinlens_app.lookup_numista(identification())
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
