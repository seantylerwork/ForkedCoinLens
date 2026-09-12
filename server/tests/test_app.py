import base64
import os
import sys
import time
import unittest
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec


SERVER_DIR = os.path.dirname(os.path.dirname(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import app as coinlens_app
import auth as coinlens_auth
from mock_openai import MOCK_MARKER


JPEG_BASE64 = base64.b64encode(b"\xff\xd8\xff\xe0coinlens-test-image").decode("ascii")
TEST_SUPABASE_URL = "https://test.supabase.co"
TEST_ISSUER = f"{TEST_SUPABASE_URL}/auth/v1"


def make_test_token(sub="user-123", aud="authenticated", issuer=TEST_ISSUER, exp_delta=3600):
    private_key = ec.generate_private_key(ec.SECP256R1())
    now = int(time.time())
    claims = {"sub": sub, "aud": aud, "iss": issuer, "iat": now, "exp": now + exp_delta}
    token = jwt.encode(claims, private_key, algorithm="ES256")
    return token, private_key.public_key()


class CoinLensApiTests(unittest.TestCase):
    def setUp(self):
        self.client = coinlens_app.app.test_client()
        coinlens_app.MOCK_MODE = False
        coinlens_app.USE_MOCK_COIN_RESPONSE = False
        coinlens_app.OPENAI_API_KEY = ""
        coinlens_app.NUMISTA_API_KEY = ""
        coinlens_app.PCGS_BEARER_TOKEN = ""
        coinlens_app.SHEETDB_URL = ""
        coinlens_app.DAILY_SCAN_LIMIT = 20
        coinlens_app.MAX_IMAGE_BYTES = 8 * 1024 * 1024
        coinlens_app.ENABLE_EBAY_LISTING = False

    def enable_mock(self):
        coinlens_app.MOCK_MODE = True
        coinlens_app.USE_MOCK_COIN_RESPONSE = False
        self._authenticate()

    def _authenticate(self):
        """Sets up a verifiable JWT without depending on MOCK_MODE, so tests
        that exercise the real (non-mock) upstream-failure paths can still
        authenticate."""
        self._original_supabase_url = coinlens_auth.SUPABASE_URL
        coinlens_auth.SUPABASE_URL = TEST_SUPABASE_URL
        token, public_key = make_test_token()
        self.auth_headers = {"Authorization": f"Bearer {token}"}
        self._signing_key_patcher = mock.patch.object(coinlens_auth, "_get_signing_key", return_value=public_key)
        self._signing_key_patcher.start()
        self.addCleanup(self._signing_key_patcher.stop)
        self.addCleanup(lambda: setattr(coinlens_auth, "SUPABASE_URL", self._original_supabase_url))

    def mock_persisted_scan(self, **overrides):
        """Unit tests must never touch the real Supabase project even though
        server/.env has real credentials loaded - patch the insert instead."""
        row = {
            "id": "11111111-1111-1111-1111-111111111111",
            "user_id": "user-123",
            "coin_name": "1946 United States Lincoln Wheat Cent",
            "source": "camera",
            **overrides,
        }
        patcher = mock.patch.object(coinlens_app, "insert_scan", return_value=row)
        patcher.start()
        self.addCleanup(patcher.stop)
        return row

    def test_health(self):
        self.enable_mock()
        response = self.client.get("/api/health")
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["ok"], True)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["mock_mode"], True)
        self.assertEqual(body["has_openai_key"], False)
        self.assertEqual(body["has_numista_key"], False)
        self.assertEqual(body["has_pcgs_token"], False)
        self.assertEqual(body["has_sheetdb"], False)

    def test_identify_coin_missing_image(self):
        self._authenticate()
        response = self.client.post("/api/identify-coin", json={"source": "camera"}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(body["error"]["code"], "missing_image")

    def test_identify_coin_missing_source(self):
        self._authenticate()
        response = self.client.post("/api/identify-coin", json={"front_image": JPEG_BASE64}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(body["error"]["code"], "invalid_source")

    def test_identify_coin_server_mock_mode(self):
        self.enable_mock()
        self.mock_persisted_scan()

        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["meta"]["mock"])
        self.assertEqual(body["identification"]["year"], "1946")
        self.assertEqual(body["identification"]["coin_name"], "1946 United States Lincoln Wheat Cent")
        self.assertEqual(body["identification"]["estimated_grade"], "VF-30")
        self.assertEqual(body["valuation"]["status"], "available")
        self.assertEqual(body["valuation"]["estimated_value"], 12.34)
        self.assertIn(MOCK_MARKER, body["summary"])
        self.assertEqual(body["scan"]["id"], "11111111-1111-1111-1111-111111111111")

    def test_identify_coin_missing_openai_key_uses_mock_response(self):
        self._authenticate()
        self.mock_persisted_scan()

        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "gallery"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["meta"]["mock"])
        self.assertEqual(body["identification"]["year"], "1946")
        self.assertNotIn("error", body)

    def test_identify_coin_single_image_request(self):
        self.enable_mock()
        self.mock_persisted_scan()

        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["meta"]["front_image_received"])
        self.assertFalse(body["meta"]["back_image_received"])

    def test_identify_coin_two_image_request(self):
        self.enable_mock()
        self.mock_persisted_scan()

        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "back_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["meta"]["front_image_received"])
        self.assertTrue(body["meta"]["back_image_received"])

    def test_identify_coin_persists_scan_with_derived_fields(self):
        self.enable_mock()
        with mock.patch.object(coinlens_app, "insert_scan") as mock_insert:
            mock_insert.return_value = {"id": "scan-1", "user_id": "user-123"}
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "gallery"},
                headers=self.auth_headers,
            )

        self.assertEqual(response.status_code, 200)
        mock_insert.assert_called_once()
        payload = mock_insert.call_args[0][0]
        self.assertEqual(payload["user_id"], "user-123")
        self.assertEqual(payload["source"], "gallery")
        self.assertEqual(payload["year"], 1946)
        self.assertEqual(payload["denom_canonical"], "wheat-penny")
        self.assertFalse(payload["is_foreign"])
        self.assertIn("local_date", payload)
        self.assertIn("local_hour", payload)

    def test_identify_coin_uncertain_does_not_persist(self):
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"
        uncertain = {
            "coin_name": "Unidentified coin", "country": "Unknown", "denomination": "Unknown",
            "year": "Unknown", "mint_mark": None, "estimated_grade": "Unknown", "description": "",
            "mint_errors": [], "varieties": None, "error_premium": False, "special_notes": "",
            "status": "uncertain", "identifiable": False,
            "unidentifiable_reason": "Photo is too blurry.", "confidence": 10, "alternatives": [],
        }
        with mock.patch.object(coinlens_app, "identify_coin_with_ai", return_value=uncertain), \
             mock.patch.object(coinlens_app, "insert_api_usage", return_value={"id": "usage-1"}), \
             mock.patch.object(coinlens_app, "count_api_usage_since", return_value=0), \
             mock.patch.object(coinlens_app, "update_api_usage") as mock_update, \
             mock.patch.object(coinlens_app, "insert_scan") as mock_insert:
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(body["identification"]["identifiable"], False)
        mock_insert.assert_not_called()
        mock_update.assert_called_once_with("usage-1", {"status": "uncertain"})

    def test_identify_coin_quota_exceeded_returns_429(self):
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"
        coinlens_app.DAILY_SCAN_LIMIT = 5
        with mock.patch.object(coinlens_app, "count_api_usage_since", return_value=5), \
             mock.patch.object(coinlens_app, "identify_coin_with_ai") as mock_identify:
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 429)
        self.assertEqual(body["error"]["code"], "quota_exceeded")
        mock_identify.assert_not_called()

    def test_identify_coin_oversized_image_rejected(self):
        self._authenticate()
        coinlens_app.MAX_IMAGE_BYTES = 10
        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 413)
        self.assertEqual(body["error"]["code"], "image_too_large")

    def test_generate_ebay_listing_mock(self):
        self.enable_mock()
        # Underlying implementation is preserved and still testable when the
        # V1 feature flag is explicitly turned on.
        coinlens_app.ENABLE_EBAY_LISTING = True

        response = self.client.post("/api/generate-ebay-listing", json={}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertIn("1946 Lincoln Wheat Cent", body["title"])
        self.assertIn(MOCK_MARKER, body["subtitle"])
        self.assertIsInstance(body["item_specifics"], list)

    def test_generate_ebay_listing_disabled_by_default(self):
        # setUp already leaves ENABLE_EBAY_LISTING at its false default.
        self._authenticate()

        response = self.client.post("/api/generate-ebay-listing", json={}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body, {
            "feature_disabled": True,
            "feature": "ebay_listing",
            "message": "eBay listing generation is disabled in this version.",
        })

    def test_generate_ebay_listing_disabled_never_calls_openai(self):
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"
        coinlens_app.ENABLE_EBAY_LISTING = False

        with mock.patch.object(coinlens_app.requests, "post", side_effect=AssertionError("should not call OpenAI")):
            response = self.client.post(
                "/api/generate-ebay-listing",
                json={"identification": {"coin_name": "Anything"}},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["feature_disabled"])

    def test_proxy_routes_return_mock_payloads(self):
        self.enable_mock()

        numista = self.client.get("/api/numista-specs?q=cent").get_json()
        pcgs = self.client.get("/api/pcgs-value/2731").get_json()
        log_scan = self.client.post("/api/log-scan", json={}).get_json()
        scans = self.client.get("/api/scans").get_json()

        self.assertEqual(numista["items"][0]["title"], "Lincoln Cent - Wheat reverse")
        self.assertEqual(pcgs["price"], 12.34)
        self.assertEqual(log_scan, {"success": True, "marker": MOCK_MARKER})
        self.assertEqual(scans[0]["Coin"], "1946 United States Lincoln Wheat Cent")

    def test_openai_chat_route_removed(self):
        self._authenticate()
        response = self.client.post("/api/openai/chat", json={"messages": []}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 404)
        self.assertEqual(body["error"]["code"], "not_found")
        self.assertNotIn("choices", body)

    def test_unknown_route_returns_structured_404_not_500(self):
        # A stray/mistyped URL hitting the server (e.g. someone navigating to
        # /identify-coin instead of the real /api/identify-coin) must read as
        # a clean 404 in logs and to any caller, not a scary 500 that looks
        # like a server crash.
        response = self.client.get("/identify-coin")
        body = response.get_json()

        self.assertEqual(response.status_code, 404)
        self.assertEqual(body["error"]["code"], "not_found")

    def test_wrong_method_returns_structured_405(self):
        # /api/identify-coin only accepts POST.
        response = self.client.get("/api/identify-coin")
        body = response.get_json()

        self.assertEqual(response.status_code, 405)
        self.assertEqual(body["error"]["code"], "method_not_allowed")

    def test_oversized_upload_still_returns_413_not_generic_http_exception(self):
        # The more specific @app.errorhandler(413) must still win over the
        # new blanket HTTPException handler for this exact case.
        self._authenticate()
        coinlens_app.MAX_IMAGE_BYTES = 10
        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 413)
        self.assertEqual(body["error"]["code"], "image_too_large")

    def test_unexpected_server_error_still_returns_500(self):
        # Real bugs must still surface as 500, not get miscategorized by the
        # new HTTPException handler (which only catches routing-level cases).
        self.enable_mock()
        with mock.patch.object(coinlens_app, "build_coinlens_result", side_effect=RuntimeError("boom")):
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 500)
        self.assertEqual(body["error"]["code"], "server_error")

    def test_successful_response_contract(self):
        self.enable_mock()
        self.mock_persisted_scan()

        response = self.client.post(
            "/api/identify-coin",
            json={"front_image": JPEG_BASE64, "source": "camera"},
            headers=self.auth_headers,
        )
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertIn("identification", body)
        self.assertIn("valuation", body)
        self.assertIn("numista", body)
        self.assertIn("pcgs", body)
        self.assertIn("summary", body)
        self.assertIn("marker", body)
        self.assertIn("scan", body)

    def test_simulated_upstream_failure(self):
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"
        error = coinlens_app.CoinLensError("upstream_failure", "AI provider request failed.", 502)
        with mock.patch.object(coinlens_app, "identify_coin_with_ai", side_effect=error), \
             mock.patch.object(coinlens_app, "count_api_usage_since", return_value=0), \
             mock.patch.object(coinlens_app, "insert_api_usage", return_value={"id": "usage-1"}), \
             mock.patch.object(coinlens_app, "update_api_usage") as mock_update:
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 502)
        self.assertEqual(body["error"]["code"], "upstream_failure")
        mock_update.assert_called_once_with("usage-1", {"status": "error"})

    def test_malformed_ai_response(self):
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"

        with mock.patch.object(coinlens_app.requests, "post") as mock_post, \
             mock.patch.object(coinlens_app, "count_api_usage_since", return_value=0), \
             mock.patch.object(coinlens_app, "insert_api_usage", return_value={"id": "usage-1"}), \
             mock.patch.object(coinlens_app, "update_api_usage"):
            mock_post.return_value = mock.Mock(
                ok=True,
                status_code=200,
                json=lambda: {"output_text": "this is not json"},
            )
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 502)
        self.assertEqual(body["error"]["code"], "malformed_ai_response")

    # -- confidence-means-complete-identification (semantic fix) -----------
    # These exercise normalize_identification() directly with the shape a
    # real model response takes for each scenario, since the actual prompt
    # wording can't be asserted by calling a live model in a unit test.

    def test_normalize_identification_fully_identified_coin_is_high_confidence(self):
        data = {
            "status": "identified",
            "coin_name": "1965 United States Washington Quarter",
            "country": "United States",
            "denomination": "Quarter Dollar",
            "year": "1965",
            "mint_mark": "D",
            "estimated_grade": "VF-30",
            "confidence": 92,
            "description": "Clear obverse and reverse, legible date and mint mark.",
            "mint_errors": [],
            "varieties": None,
            "error_premium": False,
            "special_notes": "",
            "unidentifiable_reason": None,
            "alternatives": [],
        }

        result = coinlens_app.normalize_identification(data)

        self.assertEqual(result["status"], "identified")
        self.assertTrue(result["identifiable"])
        self.assertGreaterEqual(result["confidence"], 70)
        self.assertEqual(result["year"], "1965")
        self.assertEqual(result["mint_mark"], "D")

    def test_normalize_identification_illegible_year_is_uncertain_and_low_confidence(self):
        # Mirrors the real production case this fix addresses: country and
        # denomination were clear (Hong Kong, 10 cents) but the year could
        # not be read, so confidence must be low and status uncertain -
        # not a high number attached to an incomplete identification.
        data = {
            "status": "uncertain",
            "coin_name": "Hong Kong 10 Cents",
            "country": "Hong Kong",
            "denomination": "10 Cents",
            "year": "Not legible",
            "mint_mark": None,
            "estimated_grade": "Unknown",
            "confidence": 15,
            "description": "Country and denomination are clear but the date is worn away.",
            "mint_errors": [],
            "varieties": None,
            "error_premium": False,
            "special_notes": "",
            "unidentifiable_reason": "The date is too worn to read confidently. A sharper, well-lit photo of the date would help.",
            "alternatives": [],
        }

        result = coinlens_app.normalize_identification(data)

        self.assertEqual(result["status"], "uncertain")
        self.assertFalse(result["identifiable"])
        self.assertLess(result["confidence"], coinlens_app.MIN_IDENTIFICATION_CONFIDENCE)
        # Country/denomination are still surfaced even though the overall
        # identification isn't complete enough to proceed to Numista.
        self.assertEqual(result["country"], "Hong Kong")
        self.assertEqual(result["denomination"], "10 Cents")

    def test_normalize_identification_non_coin_is_uncertain(self):
        data = {
            "status": "uncertain",
            "coin_name": None,
            "country": None,
            "denomination": None,
            "year": None,
            "mint_mark": None,
            "estimated_grade": None,
            "confidence": 3,
            "description": "This appears to be a button, not a coin.",
            "mint_errors": [],
            "varieties": None,
            "error_premium": False,
            "special_notes": "",
            "unidentifiable_reason": "This does not appear to be a coin.",
            "alternatives": [],
        }

        result = coinlens_app.normalize_identification(data)

        self.assertEqual(result["status"], "uncertain")
        self.assertFalse(result["identifiable"])
        self.assertLess(result["confidence"], coinlens_app.MIN_IDENTIFICATION_CONFIDENCE)
        self.assertEqual(result["country"], "Unknown")
        self.assertEqual(result["denomination"], "Unknown")

    def test_identify_coin_illegible_year_returns_422_without_numista(self):
        # End-to-end version of the middle case above: the full route must
        # still 422 and never reach Numista when the model (correctly, per
        # the updated prompt) reports low confidence for an incomplete id.
        self._authenticate()
        coinlens_app.OPENAI_API_KEY = "test-key"
        uncertain = {
            "coin_name": "Hong Kong 10 Cents", "country": "Hong Kong", "denomination": "10 Cents",
            "year": "Unknown", "mint_mark": None, "estimated_grade": "Unknown", "description": "",
            "mint_errors": [], "varieties": None, "error_premium": False, "special_notes": "",
            "status": "uncertain", "identifiable": False,
            "unidentifiable_reason": "The date is too worn to read confidently.", "confidence": 15, "alternatives": [],
        }
        with mock.patch.object(coinlens_app, "identify_coin_with_ai", return_value=uncertain), \
             mock.patch.object(coinlens_app, "insert_api_usage", return_value={"id": "usage-1"}), \
             mock.patch.object(coinlens_app, "count_api_usage_since", return_value=0), \
             mock.patch.object(coinlens_app, "update_api_usage") as mock_update, \
             mock.patch.object(coinlens_app, "search_numista_types") as mock_numista_search, \
             mock.patch.object(coinlens_app, "insert_scan") as mock_insert:
            response = self.client.post(
                "/api/identify-coin",
                json={"front_image": JPEG_BASE64, "source": "camera"},
                headers=self.auth_headers,
            )
        body = response.get_json()

        self.assertEqual(response.status_code, 422)
        self.assertEqual(body["identification"]["status"], "uncertain")
        self.assertLess(body["identification"]["confidence"], coinlens_app.MIN_IDENTIFICATION_CONFIDENCE)
        mock_numista_search.assert_not_called()
        mock_insert.assert_not_called()
        mock_update.assert_called_once_with("usage-1", {"status": "uncertain"})


if __name__ == "__main__":
    unittest.main()
