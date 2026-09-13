import json
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

    def test_multiple_candidates_with_matching_issues_return_unavailable_not_a_guess(self):
        """Real production scenario: several plausible UK 20p-family types
        could each turn out to have an issue for the identified year. Since
        we can't safely tell them apart, this must report unavailable
        rather than silently picking one (e.g. by score)."""
        candidate_a = {
            "id": 1, "title": "20 Pence - Elizabeth II (Type A)",
            "issuer": {"name": "United Kingdom"}, "min_year": 2008, "max_year": 2015,
        }
        candidate_b = {
            "id": 2, "title": "20 Pence - Elizabeth II (Type B)",
            "issuer": {"name": "United Kingdom"}, "min_year": 2008, "max_year": 2015,
        }

        def fake_issues(type_id):
            return [{"id": f"iss-{type_id}-2012", "year": 2012}]

        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=fake_issues):
            best, issue = coinlens_app.resolve_numista_type_and_issue(
                identification(country="United Kingdom", denomination="20 pence", year="2012"),
                [candidate_a, candidate_b],
            )
        self.assertIsNone(best)
        self.assertIsNone(issue)


class VariantDisambiguationTests(unittest.TestCase):
    """Real production case: a 2012 UK 20 pence scan returned three
    candidates that all had a valid 2012 issue - a standard circulation
    type, a non-circulating 1/10oz fine-silver type, and a silver-proof
    variant. The year/issue gate correctly refused to guess. These cover
    preferring the ordinary circulation type using only object_type/title
    fields Numista already returns - never weakening the year/issue gate
    itself, and never guessing when the AI actually flagged something
    special or when circulation candidates themselves remain tied."""

    UK_20P_CANDIDATES = [
        {
            "id": 29106, "title": "20 Pence - Elizabeth II (4th portrait; 1/10 oz Fine Silver)",
            "issuer": {"name": "United Kingdom"}, "object_type": {"id": 3, "name": "Non-circulating coins"},
        },
        {
            "id": 5628, "title": "20 Pence - Elizabeth II (4th portrait; Royal Shield)",
            "issuer": {"name": "United Kingdom"}, "object_type": {"id": 1, "name": "Standard circulation coins"},
        },
        {
            "id": 208022, "title": "20 Pence - Elizabeth II (4th portrait; Royal Shield, Silver Proof)",
            "issuer": {"name": "United Kingdom"}, "object_type": {"id": 3, "name": "Non-circulating coins"},
        },
    ]

    def _all_candidates_have_a_2012_issue(self, type_id):
        return [{"id": f"iss-{type_id}-2012", "year": 2012}]

    def test_uk_2012_20p_regression_prefers_standard_circulation_type_5628(self):
        ident = identification(
            country="United Kingdom", denomination="20 pence", year="2012",
            estimated_grade="VF-30", description="An ordinary seven-sided circulating coin.",
        )
        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=self._all_candidates_have_a_2012_issue):
            best, issue = coinlens_app.resolve_numista_type_and_issue(ident, self.UK_20P_CANDIDATES)

        self.assertIsNotNone(best)
        self.assertEqual(best["id"], 5628)
        self.assertEqual(issue["id"], "iss-5628-2012")

    def test_ai_explicitly_saying_silver_proof_does_not_auto_select_circulation(self):
        ident = identification(
            country="United Kingdom", denomination="20 pence", year="2012",
            description="This looks like a silver proof striking with mirrored fields.",
        )
        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=self._all_candidates_have_a_2012_issue):
            best, issue = coinlens_app.resolve_numista_type_and_issue(ident, self.UK_20P_CANDIDATES)

        # Must NOT silently land on the standard-circulation type just
        # because it's one of the tied candidates.
        self.assertNotEqual((best or {}).get("id"), 5628)
        self.assertIsNone(best)
        self.assertIsNone(issue)

    def test_two_standard_circulation_candidates_still_tied_remain_unavailable(self):
        candidate_a = {
            "id": 1, "title": "20 Pence - Elizabeth II (Type A)",
            "issuer": {"name": "United Kingdom"}, "object_type": {"name": "Standard circulation coins"},
        }
        candidate_b = {
            "id": 2, "title": "20 Pence - Elizabeth II (Type B)",
            "issuer": {"name": "United Kingdom"}, "object_type": {"name": "Standard circulation coins"},
        }
        ident = identification(country="United Kingdom", denomination="20 pence", year="2012")
        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=self._all_candidates_have_a_2012_issue):
            best, issue = coinlens_app.resolve_numista_type_and_issue(ident, [candidate_a, candidate_b])

        self.assertIsNone(best)
        self.assertIsNone(issue)

    def test_wrong_year_rejection_is_unaffected_by_variant_disambiguation(self):
        """The standard-circulation type itself has no 2012 issue (only the
        proof variant does) - it must still be rejected by the year check,
        not force-selected just because it's "the ordinary one"."""
        candidates = [
            {
                "id": 5628, "title": "20 Pence - Elizabeth II (4th portrait; Royal Shield)",
                "issuer": {"name": "United Kingdom"}, "object_type": {"name": "Standard circulation coins"},
            },
            {
                "id": 208022, "title": "20 Pence - Elizabeth II (4th portrait; Royal Shield, Silver Proof)",
                "issuer": {"name": "United Kingdom"}, "object_type": {"name": "Non-circulating coins"},
            },
        ]

        def fake_issues(type_id):
            if type_id == 5628:
                return [{"id": "iss-5628-2015", "year": 2015}]  # no 2012 issue
            return [{"id": "iss-208022-2012", "year": 2012}]

        ident = identification(country="United Kingdom", denomination="20 pence", year="2012")
        with mock.patch.object(coinlens_app, "fetch_numista_issues", side_effect=fake_issues):
            best, issue = coinlens_app.resolve_numista_type_and_issue(ident, candidates)

        self.assertEqual(best["id"], 208022)
        self.assertEqual(issue["id"], "iss-208022-2012")

    def test_looks_special_or_proof_classifies_by_object_type(self):
        self.assertTrue(coinlens_app.looks_special_or_proof({"title": "20 Pence", "object_type": {"name": "Non-circulating coins"}}))
        self.assertFalse(coinlens_app.looks_special_or_proof({"title": "20 Pence", "object_type": {"name": "Standard circulation coins"}}))

    def test_looks_special_or_proof_classifies_by_title_keywords(self):
        self.assertTrue(coinlens_app.looks_special_or_proof({"title": "1 Dollar - Proof"}))
        self.assertTrue(coinlens_app.looks_special_or_proof({"title": "20 Pence (1/4 oz Fine Gold)"}))
        # A bare metal word alone (no object_type given) is not enough -
        # plenty of ordinary historical circulation coins are gold/silver.
        self.assertFalse(coinlens_app.looks_special_or_proof({"title": "Sixpence - George VI (Silver)"}))

    def test_ai_indicates_special_variant_reads_description(self):
        self.assertTrue(coinlens_app.ai_indicates_special_variant(identification(description="A gold commemorative issue.")))
        self.assertTrue(coinlens_app.ai_indicates_special_variant(identification(special_notes="Appears to be a proof strike.")))
        self.assertFalse(coinlens_app.ai_indicates_special_variant(identification(description="An ordinary circulating coin.")))


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


class IssuerResolutionTests(unittest.TestCase):
    """Numista's /types `issuer` param expects a real issuer code, not an
    arbitrary country string - these cover resolving one from Numista's own
    /issuers list (never a hardcoded guess), the small alias map for
    obvious AI phrasing, the in-process cache, and safe failure modes."""

    def setUp(self):
        self._orig_key = coinlens_app.NUMISTA_API_KEY
        self._orig_cache = dict(coinlens_app._numista_issuer_cache)
        coinlens_app.NUMISTA_API_KEY = "test-key"
        coinlens_app._numista_issuer_cache["by_name"] = None
        coinlens_app._numista_issuer_cache["fetched_at"] = 0.0
        self.addCleanup(lambda: setattr(coinlens_app, "NUMISTA_API_KEY", self._orig_key))
        self.addCleanup(lambda: coinlens_app._numista_issuer_cache.update(self._orig_cache))

    def _issuers_response(self, issuers):
        resp = mock.Mock(status_code=200)
        resp.text = json.dumps({"issuers": issuers})
        resp.json.return_value = {"issuers": issuers}
        return resp

    def test_resolves_a_real_issuer_name_to_its_code(self):
        issuers = [{"code": "royaume-uni", "name": "United Kingdom"}, {"code": "france", "name": "France"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)):
            code = coinlens_app.resolve_numista_issuer_code("United Kingdom")
        self.assertEqual(code, "royaume-uni")

    def test_handles_uk_alias(self):
        issuers = [{"code": "royaume-uni", "name": "United Kingdom"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)):
            code = coinlens_app.resolve_numista_issuer_code("UK")
        self.assertEqual(code, "royaume-uni")

    def test_handles_usa_and_us_aliases(self):
        issuers = [{"code": "etats-unis", "name": "United States"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)):
            code_usa = coinlens_app.resolve_numista_issuer_code("USA")
            code_us = coinlens_app.resolve_numista_issuer_code("US")
        self.assertEqual(code_usa, "etats-unis")
        self.assertEqual(code_us, "etats-unis")

    def test_matches_case_insensitively(self):
        issuers = [{"code": "canada", "name": "Canada"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)):
            code = coinlens_app.resolve_numista_issuer_code("cAnAdA")
        self.assertEqual(code, "canada")

    def test_caches_issuer_list_and_does_not_refetch_on_every_call(self):
        issuers = [{"code": "canada", "name": "Canada"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)) as mock_get:
            coinlens_app.resolve_numista_issuer_code("Canada")
            coinlens_app.resolve_numista_issuer_code("Canada")
            coinlens_app.resolve_numista_issuer_code("Canada")
        self.assertEqual(mock_get.call_count, 1)

    def test_unresolvable_country_returns_none_without_raising(self):
        issuers = [{"code": "canada", "name": "Canada"}]
        with mock.patch.object(coinlens_app.requests, "get", return_value=self._issuers_response(issuers)):
            code = coinlens_app.resolve_numista_issuer_code("Atlantis")
        self.assertIsNone(code)

    def test_issuer_fetch_failure_returns_none_without_raising(self):
        with mock.patch.object(coinlens_app.requests, "get", side_effect=coinlens_app.requests.RequestException("boom")):
            code = coinlens_app.resolve_numista_issuer_code("Canada")
        self.assertIsNone(code)


class StructuredSearchTests(unittest.TestCase):
    """Reproduces the real 2012 UK 20 pence case: free-text search for
    "United Kingdom 20 pence" returned mostly Isle of Man candidates, and
    every one correctly failed issue validation (1982/1983 issues only) -
    the search step itself needs to give the pipeline a fair shot via a
    structured, issuer-scoped query instead of free text."""

    def setUp(self):
        self._orig_key = coinlens_app.NUMISTA_API_KEY
        coinlens_app.NUMISTA_API_KEY = "test-key"
        self.addCleanup(lambda: setattr(coinlens_app, "NUMISTA_API_KEY", self._orig_key))

    def _search_response(self, results):
        resp = mock.Mock(status_code=200)
        resp.text = json.dumps({"types": results})
        resp.json.return_value = {"types": results}
        return resp

    def test_uk_20_pence_2012_structured_search_includes_denomination_issuer_year_category(self):
        candidates = [{"id": 10799, "title": "20 Pence - Elizabeth II", "issuer": {"name": "United Kingdom"}}]
        with mock.patch.object(coinlens_app, "resolve_numista_issuer_code", return_value="royaume-uni"), \
             mock.patch.object(coinlens_app.requests, "get", return_value=self._search_response(candidates)) as mock_get:
            results = coinlens_app.search_numista_types(
                identification(country="United Kingdom", denomination="20 pence", year="2012")
            )

        self.assertEqual(results, candidates)
        params = mock_get.call_args.kwargs["params"]
        self.assertEqual(params["q"], "20 pence")
        self.assertEqual(params["issuer"], "royaume-uni")
        self.assertEqual(params["year"], 2012)
        self.assertEqual(params["category"], "coin")

    def test_country_is_not_stuffed_into_q_when_issuer_is_available(self):
        with mock.patch.object(coinlens_app, "resolve_numista_issuer_code", return_value="royaume-uni"), \
             mock.patch.object(coinlens_app.requests, "get", return_value=self._search_response([])) as mock_get:
            coinlens_app.search_numista_types(
                identification(country="United Kingdom", denomination="20 pence", year="2012")
            )
        params = mock_get.call_args.kwargs["params"]
        self.assertNotIn("united kingdom", params["q"].lower())

    def test_issuer_resolution_failure_falls_back_to_denomination_and_year_search(self):
        fallback_candidates = [{"id": 1, "title": "20 Pence"}]
        with mock.patch.object(coinlens_app, "resolve_numista_issuer_code", return_value=None), \
             mock.patch.object(coinlens_app.requests, "get", return_value=self._search_response(fallback_candidates)) as mock_get:
            results = coinlens_app.search_numista_types(
                identification(country="United Kingdom", denomination="20 pence", year="2012")
            )

        self.assertEqual(results, fallback_candidates)
        self.assertEqual(mock_get.call_count, 1)  # no wasted structured attempt when issuer resolution already failed
        params = mock_get.call_args.kwargs["params"]
        self.assertNotIn("issuer", params)
        self.assertEqual(params["q"], "20 pence")
        self.assertEqual(params["year"], 2012)
        self.assertEqual(params["category"], "coin")

    def test_structured_search_with_no_candidates_falls_back_to_denomination_only(self):
        empty = self._search_response([])
        fallback_candidates = [{"id": 2, "title": "20 Pence"}]
        filled = self._search_response(fallback_candidates)
        with mock.patch.object(coinlens_app, "resolve_numista_issuer_code", return_value="royaume-uni"), \
             mock.patch.object(coinlens_app.requests, "get", side_effect=[empty, filled]) as mock_get:
            results = coinlens_app.search_numista_types(
                identification(country="United Kingdom", denomination="20 pence", year="2012")
            )

        self.assertEqual(results, fallback_candidates)
        self.assertEqual(mock_get.call_count, 2)
        fallback_params = mock_get.call_args_list[1].kwargs["params"]
        self.assertNotIn("issuer", fallback_params)


class MockModeUnaffectedTests(unittest.TestCase):
    def setUp(self):
        self._orig_mock_mode = coinlens_app.MOCK_MODE
        coinlens_app.MOCK_MODE = True
        self.addCleanup(lambda: setattr(coinlens_app, "MOCK_MODE", self._orig_mock_mode))

    def test_lookup_numista_mock_mode_is_unaffected_by_issuer_resolution(self):
        with mock.patch.object(coinlens_app, "search_numista_types") as mock_search, \
             mock.patch.object(coinlens_app, "resolve_numista_issuer_code") as mock_resolve:
            result = coinlens_app.lookup_numista(identification())
        mock_search.assert_not_called()
        mock_resolve.assert_not_called()
        self.assertEqual(result, dict(coinlens_app.MOCK_NUMISTA))


if __name__ == "__main__":
    unittest.main()
