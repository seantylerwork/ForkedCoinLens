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
        # This app's blanket @app.errorhandler(Exception) turns Flask's normal
        # 404 for an unmatched route into a generic 500 (a pre-existing,
        # unrelated behavior) - so the route being gone shows up as a 500
        # "server_error", not a 404. Either way, the old success shape
        # (a "choices" key) must never come back.
        self._authenticate()
        response = self.client.post("/api/openai/chat", json={"messages": []}, headers=self.auth_headers)
        body = response.get_json()

        self.assertEqual(response.status_code, 500)
        self.assertNotIn("choices", body)

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


if __name__ == "__main__":
    unittest.main()
