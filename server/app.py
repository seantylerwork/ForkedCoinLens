import os
import re
import base64
import binascii
import json
import logging
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from auth import require_auth
from require_user import require_user
from supabase_admin import (
    insert_scan,
    insert_api_usage,
    update_api_usage,
    count_api_usage_since,
    SupabaseAdminError,
)
from mock_openai import (
    MOCK_EBAY_LISTING,
    MOCK_MARKER,
    MOCK_NUMISTA,
    MOCK_PCGS,
    MOCK_SCAN_ROW,
    build_mock_coin_result as deterministic_mock_coin_result,
)

load_dotenv()

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
NUMISTA_API_KEY = os.environ.get("NUMISTA_API_KEY", "")
PCGS_BEARER_TOKEN = os.environ.get("PCGS_BEARER_TOKEN", "")
SHEETDB_URL = os.environ.get("SHEETDB_URL", "")
ADMIN_CODE = os.environ.get("ADMIN_CODE", "")
MOCK_MODE = os.environ.get("MOCK_MODE", "false").lower() == "true"
USE_MOCK_COIN_RESPONSE = os.environ.get("USE_MOCK_COIN_RESPONSE", "false").lower() == "true" or MOCK_MODE

# Configurable so the identification model can be changed (e.g. for cost or
# capability reasons) without a code change.
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# M6 cost protection: independent of any OpenAI-side spending limit.
DAILY_SCAN_LIMIT = int(os.environ.get("DAILY_SCAN_LIMIT", "20"))
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))

# V1: eBay listing generation is disabled by default (not part of the V1
# scope). The implementation is kept intact behind this flag so it can be
# re-enabled later without rebuilding it.
ENABLE_EBAY_LISTING = os.environ.get("ENABLE_EBAY_LISTING", "false").lower() == "true"

OPENAI_TIMEOUT = int(os.environ.get("OPENAI_TIMEOUT_SECONDS", "60"))
NUMISTA_TIMEOUT = int(os.environ.get("NUMISTA_TIMEOUT_SECONDS", "20"))
PCGS_TIMEOUT = int(os.environ.get("PCGS_TIMEOUT_SECONDS", "20"))

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
# Current OpenAI multimodal + structured-output endpoint. Used for the single
# identification call so the vision model returns schema-conformant JSON
# directly, instead of the old free-text-then-reparse approach.
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
NUMISTA_TYPES_URL = "https://api.numista.com/api/v3/types"
NUMISTA_COINS_URL = "https://api.numista.com/api/v3/coins"
PCGS_PRICE_URL = "https://api.pcgs.com/publicapi/priceguide/getpricedata/{pcgs_number}"

REQUEST_TIMEOUT = 60

US_COUNTRY_NAMES = {"united states", "usa", "u.s.", "u.s.a.", "united states of america"}
MIN_IDENTIFICATION_CONFIDENCE = 40

app = Flask(__name__)
CORS(app)
# Two coin photos as base64 JSON comfortably fit well under this; guards
# against a client accidentally posting something enormous before we ever
# get to per-image validation.
app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_CONTENT_LENGTH_BYTES", str(24 * 1024 * 1024)))

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
app.logger.handlers = logging.getLogger("gunicorn.error").handlers or app.logger.handlers
app.logger.setLevel(logging.getLogger("gunicorn.error").level or logging.INFO)


class CoinLensError(Exception):
    def __init__(self, code, message, status=500, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        # Optional extra fields merged into the error response body (e.g.
        # rate_limit's retry_after_seconds) - never used for anything
        # sensitive; see error_response().
        self.details = details or {}


def proxy_response(upstream_response):
    return Response(
        upstream_response.content,
        status=upstream_response.status_code,
        content_type=upstream_response.headers.get("Content-Type", "application/json"),
    )


def mock_coin_enabled():
    return MOCK_MODE or USE_MOCK_COIN_RESPONSE


def should_use_mock_coin_response():
    return mock_coin_enabled() or not OPENAI_API_KEY


def log_mock_response(route):
    app.logger.info("MOCK response: %s", route)


def error_response(error):
    body = {"code": error.code, "message": error.message}
    body.update(error.details)
    return jsonify({"error": body}), error.status


@app.errorhandler(CoinLensError)
def handle_coinlens_error(error):
    return error_response(error)


@app.errorhandler(413)
def handle_payload_too_large(_error):
    return error_response(CoinLensError("payload_too_large", "Upload is too large.", 413))


@app.errorhandler(HTTPException)
def handle_http_exception(error):
    # Flask/Werkzeug raise these for routing-level cases (unknown route -> 404,
    # wrong HTTP method -> 405, malformed request -> 400, etc). Without this
    # handler, the blanket Exception handler below catches them too and turns
    # every one - including a plain "wrong URL" - into a generic 500, which
    # reads as a server crash in logs when it's really just a 404/405. This
    # runs before the Exception handler because HTTPException is more specific
    # in the MRO (a still-more-specific code, like 413 above, wins over this).
    code = (error.name or "http_error").lower().replace(" ", "_")
    return error_response(CoinLensError(code, error.description or error.name or "Request failed.", error.code or 500))


@app.errorhandler(Exception)
def handle_unexpected_error(_error):
    return error_response(CoinLensError("server_error", "Unexpected server failure.", 500))


@app.route("/api/health", methods=["GET"])
def health():
    body = {
        "ok": True,
        "status": "ok",
        "mock_mode": should_use_mock_coin_response(),
        "has_openai_key": bool(OPENAI_API_KEY),
        "has_numista_key": bool(NUMISTA_API_KEY),
        "has_pcgs_token": bool(PCGS_BEARER_TOKEN),
        "has_sheetdb": bool(SHEETDB_URL),
    }
    if should_use_mock_coin_response():
        log_mock_response("/api/health")
    return jsonify(body)


@app.route("/api/me", methods=["GET"])
@require_user
def me():
    return jsonify({"id": g.user_id, "email": g.user_email})


def get_model_candidates(primary_model):
    if not primary_model:
        return [OPENAI_MODEL]
    if primary_model == OPENAI_MODEL:
        return [OPENAI_MODEL]
    return [primary_model, OPENAI_MODEL]


def is_retryable_openai_error(status, message):
    text = (message or "").lower()
    # Billing/spend-limit failures must never trigger a retry against another
    # model candidate - that just spends the same exhausted budget again.
    if status == 402 or "quota" in text or "billing" in text:
        return False
    return status in (400, 403, 404, 429) or "model" in text or "unsupported" in text or "not found" in text


def openai_chat_content(messages, max_tokens=400, model=None):
    if not OPENAI_API_KEY:
        raise CoinLensError("key_missing", "Server is missing OPENAI_API_KEY.", 500)

    candidates = get_model_candidates(model or OPENAI_MODEL)
    last_error = None
    for index, candidate_model in enumerate(candidates):
        payload = {"model": candidate_model, "messages": messages, "max_tokens": max_tokens}
        try:
            upstream = requests.post(
                OPENAI_CHAT_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                json=payload,
                timeout=OPENAI_TIMEOUT,
            )
        except requests.RequestException:
            last_error = CoinLensError("upstream_failure", "AI provider request failed.", 502)
            continue

        try:
            data = upstream.json()
        except ValueError:
            last_error = CoinLensError("upstream_failure", "AI provider returned an unreadable response.", 502)
            continue

        if not upstream.ok:
            message = data.get("error", {}).get("message", "")
            if upstream.status_code == 401:
                raise CoinLensError("key_invalid", "AI provider rejected the API key.", 401)
            if upstream.status_code == 402:
                raise CoinLensError("quota", "AI provider billing limit reached.", 402)
            if upstream.status_code == 429:
                code = "quota" if "quota" in message.lower() or "billing" in message.lower() else "rate_limit"
                if code == "quota":
                    raise CoinLensError(code, "AI provider rate or quota limit reached.", 429)
            if is_retryable_openai_error(upstream.status_code, message) and index < len(candidates) - 1:
                last_error = CoinLensError("upstream_failure", "AI provider rejected the requested model.", 502)
                continue
            if upstream.status_code == 429:
                raise CoinLensError("rate_limit", "AI provider rate limit reached.", 429)
            raise CoinLensError("upstream_failure", "AI provider request failed.", 502)

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if content:
            return content.strip()

        last_error = CoinLensError("identification_failure", "AI provider returned an empty response.", 422)

    raise last_error or CoinLensError("upstream_failure", "AI provider did not return a usable response.", 502)


def find_matching_delimiter(text, open_index):
    opening = text[open_index]
    closing = "}" if opening == "{" else "]"
    depth = 0
    in_string = False
    escape_next = False

    for index in range(open_index, len(text)):
        char = text[index]
        if escape_next:
            escape_next = False
            continue
        if char == "\\":
            escape_next = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return index
    return -1


def extract_json(text):
    if not isinstance(text, str) or not text.strip():
        raise CoinLensError("malformed_ai_response", "AI returned no recognizable data.", 502)

    trimmed = text.strip()
    starts = [index for index in (trimmed.find("{"), trimmed.find("[")) if index >= 0]
    if not starts:
        raise CoinLensError("malformed_ai_response", "AI returned no JSON data.", 502)

    start = min(starts)
    end = find_matching_delimiter(trimmed, start)
    if end < 0:
        raise CoinLensError("malformed_ai_response", "AI returned malformed JSON.", 502)

    try:
        return json.loads(trimmed[start:end + 1])
    except json.JSONDecodeError:
        raise CoinLensError("malformed_ai_response", "AI returned malformed JSON.", 502)


def guess_image_mime(image_bytes, supplied_mime=""):
    if supplied_mime in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        return supplied_mime
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    raise CoinLensError("invalid_image", "Unsupported or invalid image.", 415)


def check_image_size(image_bytes):
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise CoinLensError("image_too_large", "Image is too large. Use a smaller photo.", 413)


def decode_base64_image(value):
    if not value or not isinstance(value, str):
        raise CoinLensError("missing_image", "Front image is required.", 400)

    mime = ""
    raw = value
    if value.startswith("data:") and "," in value:
        header, raw = value.split(",", 1)
        mime = header[5:].split(";", 1)[0]

    try:
        image_bytes = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise CoinLensError("invalid_image", "Unsupported or invalid image.", 415)

    if not image_bytes:
        raise CoinLensError("invalid_image", "Unsupported or invalid image.", 415)

    check_image_size(image_bytes)
    mime = guess_image_mime(image_bytes, mime)
    return {"bytes": image_bytes, "mime": mime, "data_url": f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"}


def read_uploaded_image(file_storage, required=False):
    if not file_storage:
        if required:
            raise CoinLensError("missing_image", "Front image is required.", 400)
        return None
    image_bytes = file_storage.read()
    if not image_bytes:
        if required:
            raise CoinLensError("missing_image", "Front image is required.", 400)
        return None
    check_image_size(image_bytes)
    mime = guess_image_mime(image_bytes, file_storage.mimetype or "")
    return {"bytes": image_bytes, "mime": mime, "data_url": f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"}


def read_identification_images():
    if request.files:
        front = read_uploaded_image(request.files.get("front_image") or request.files.get("front"), required=True)
        back = read_uploaded_image(request.files.get("back_image") or request.files.get("back"), required=False)
        return front, back

    payload = request.get_json(force=True, silent=True) or {}
    front_value = payload.get("front_image") or payload.get("frontImage") or payload.get("front")
    back_value = payload.get("back_image") or payload.get("backImage") or payload.get("back")
    front = decode_base64_image(front_value)
    back = decode_base64_image(back_value) if back_value else None
    return front, back


def read_request_field(name):
    """Reads a plain (non-image) field from either a multipart or JSON body."""
    if request.files:
        return request.form.get(name)
    payload = request.get_json(force=True, silent=True) or {}
    return payload.get(name)


# ---------------------------------------------------------------------------
# Coin identification (single OpenAI call, structured output)
# ---------------------------------------------------------------------------

IDENTIFICATION_PROMPT = """You are an expert numismatist identifying a coin from one or two photos for a \
collector app. Examine the image(s) closely: obverse/front design, reverse/back design if shown, portraits, \
inscriptions and mottos, the date and mint mark exactly as visible, country and denomination text, metal color, \
surface wear and condition, and any doubling, off-center strikes, die cracks or other notable anomalies.

Set "status" to "identified" only when you are reasonably confident of the country, denomination, year, and mint \
mark (when the country/denomination normally carries one). Set it to "uncertain" whenever any of those fields is \
illegible, guessed, or unknown - even if the others are perfectly clear - or when the photo is blurry, too dark, \
cropped, glare-obscured, or otherwise not clear enough to be confident. When uncertain, explain in \
"unidentifiable_reason" what a better photo would need to show (for example: sharper focus, more even lighting, \
the full coin in frame, the reverse side, or a clearer view of the date). Never invent an identification you are \
not reasonably confident in.

"confidence" is a 0-100 self-assessment of how confident you are in the COMPLETE identification as a whole - \
country AND denomination AND year AND mint mark (when relevant) together - not just whichever parts happen to be \
clearly visible. This number is what downstream code uses to decide whether to search a coin catalog by country, \
denomination, and year, so a partial identification must score low even when some individual fields are obvious. \
For example: if the country and denomination are unmistakable but the year is worn away, cropped out, or \
otherwise not legible, confidence must be low (well under 40) and status must be "uncertain" - do not give a high \
confidence score just because part of the coin was easy to read. Only score confidence high (70 or above) when \
every field needed to look up this exact coin - country, denomination, year, and mint mark when relevant - is \
clearly legible with no guessing involved.

"estimated_grade" is your own visual estimate using the Sheldon scale (e.g. "VF-30") - make clear this is an \
estimate, not a professional certified grade.

Return ONLY the structured fields requested. Do not include any text outside the JSON object."""

IDENTIFICATION_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "status": {
            "type": "string",
            "enum": ["identified", "uncertain"],
            "description": "identified only if country, denomination, year, and mint mark (when relevant) are all legible; uncertain if any of those is illegible, guessed, or unknown.",
        },
        "coin_name": {"type": "string"},
        "country": {"type": "string"},
        "denomination": {"type": "string"},
        "year": {"type": "string"},
        "mint_mark": {"type": ["string", "null"]},
        "estimated_grade": {"type": "string"},
        "confidence": {
            "type": "integer",
            "description": "0-100 confidence in the COMPLETE identification (country + denomination + year + mint mark together), not just the clearest individual field. Must be well under 40 if any of those fields is not legible.",
        },
        "description": {"type": "string"},
        "mint_errors": {"type": "array", "items": {"type": "string"}},
        "varieties": {"type": ["string", "null"]},
        "error_premium": {"type": "boolean"},
        "special_notes": {"type": "string"},
        "unidentifiable_reason": {"type": ["string", "null"]},
        "alternatives": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "coin": {"type": "string"},
                    "confidence": {"type": "integer"},
                },
                "required": ["coin", "confidence"],
            },
        },
    },
    "required": [
        "status", "coin_name", "country", "denomination", "year", "mint_mark",
        "estimated_grade", "confidence", "description", "mint_errors", "varieties",
        "error_premium", "special_notes", "unidentifiable_reason", "alternatives",
    ],
}


def normalize_identification(data):
    if not isinstance(data, dict):
        raise CoinLensError("malformed_ai_response", "AI identification was not an object.", 502)

    confidence = data.get("confidence", 0)
    try:
        confidence = max(0, min(100, int(confidence)))
    except (TypeError, ValueError):
        confidence = 0

    status = data.get("status")
    identifiable = status == "identified" and confidence >= MIN_IDENTIFICATION_CONFIDENCE

    if not identifiable:
        return {
            "coin_name": data.get("coin_name") or "Unidentified coin",
            "country": data.get("country") or "Unknown",
            "denomination": data.get("denomination") or "Unknown",
            "year": data.get("year") or "Unknown",
            "mint_mark": data.get("mint_mark"),
            "estimated_grade": data.get("estimated_grade") or "Unknown",
            "description": data.get("description") or data.get("special_notes") or "",
            "mint_errors": data.get("mint_errors") if isinstance(data.get("mint_errors"), list) else [],
            "varieties": data.get("varieties"),
            "error_premium": bool(data.get("error_premium")),
            "special_notes": data.get("special_notes") or "",
            "status": "uncertain",
            "identifiable": False,
            "unidentifiable_reason": data.get("unidentifiable_reason") or "The coin could not be identified confidently.",
            "confidence": confidence,
            "alternatives": data.get("alternatives") if isinstance(data.get("alternatives"), list) else [],
        }

    country = str(data.get("country") or "Unknown").strip() or "Unknown"
    denomination = str(data.get("denomination") or "Unknown").strip() or "Unknown"
    year = str(data.get("year") or "Unknown").strip() or "Unknown"
    coin_name = data.get("coin_name") or " ".join(part for part in [year, country, denomination] if part and part != "Unknown") or "Identified coin"

    return {
        "coin_name": coin_name,
        "country": country,
        "denomination": denomination,
        "year": year,
        "mint_mark": data.get("mint_mark"),
        "estimated_grade": data.get("estimated_grade") or "Unknown",
        "description": data.get("description") or data.get("special_notes") or "",
        "mint_errors": data.get("mint_errors") if isinstance(data.get("mint_errors"), list) else [],
        "varieties": data.get("varieties"),
        "error_premium": bool(data.get("error_premium")),
        "special_notes": data.get("special_notes") or "",
        "status": "identified",
        "identifiable": True,
        "confidence": confidence,
        "alternatives": data.get("alternatives") if isinstance(data.get("alternatives"), list) else [],
    }


def extract_responses_output_text(data):
    if isinstance(data, dict) and isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"].strip()
    for item in (data.get("output") or []) if isinstance(data, dict) else []:
        for piece in item.get("content") or []:
            text = piece.get("text")
            if piece.get("type") in ("output_text", "text") and text:
                return text.strip()
    return None


# Diagnostics-only for a non-2xx OpenAI response (rate limits especially -
# these carry no `usage` field at all, so without this a 429 previously
# logged nothing but the generic CoinLensError). Never touches the request
# side (headers, payload, images) - only OpenAI's own response.
OPENAI_LOG_BODY_CHARS = 1500
OPENAI_RATE_LIMIT_HEADERS = (
    "x-request-id",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
    "retry-after",
)
# Defense-in-depth beyond truncation: redacts any long base64-looking run
# before logging, in case an error body ever echoed request content back.
_BASE64_BLOB_RE = re.compile(r"[A-Za-z0-9+/]{100,}={0,2}")


def _sanitize_log_text(text, limit=OPENAI_LOG_BODY_CHARS):
    if not text:
        return text
    return _BASE64_BLOB_RE.sub("<redacted-base64>", text)[:limit]


def _log_openai_error_response(upstream):
    """Logs enough to diagnose a non-2xx OpenAI response - status, the
    standard rate-limit headers (only the ones actually present), and a
    sanitized/truncated body. Never logs the Authorization header, the API
    key, or any request payload."""
    present_headers = {
        name: upstream.headers[name] for name in OPENAI_RATE_LIMIT_HEADERS if name in upstream.headers
    }
    app.logger.warning(
        "[identify] OpenAI error response: http_status=%s headers=%s body=%s",
        upstream.status_code, present_headers, _sanitize_log_text(upstream.text),
    )


def _parse_retry_after_seconds(value):
    """Safely parses OpenAI's `retry-after` header (always sent as an
    integer number of seconds, not an HTTP-date) into a positive int.
    Returns None - never raises - for anything absent, non-numeric, or
    non-positive, so a malformed header can never fail the request."""
    if value is None:
        return None
    try:
        seconds = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return seconds if seconds > 0 else None


def identify_coin_with_ai(front_image, back_image=None):
    if not OPENAI_API_KEY:
        raise CoinLensError("key_missing", "Server is missing OPENAI_API_KEY.", 500)

    content = [{"type": "input_text", "text": IDENTIFICATION_PROMPT}]
    content.append({"type": "input_image", "image_url": front_image["data_url"]})
    if back_image:
        content.append({"type": "input_image", "image_url": back_image["data_url"]})

    payload = {
        "model": OPENAI_MODEL,
        "input": [{"role": "user", "content": content}],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "coin_identification",
                "schema": IDENTIFICATION_JSON_SCHEMA,
                "strict": True,
            }
        },
        # Reasoning-capable models spend part of this budget on hidden
        # reasoning tokens (counted in usage.output_tokens) before emitting
        # the final JSON - too low a cap can exhaust the whole budget on
        # reasoning and leave zero visible output text. 2000 leaves headroom
        # for that while still comfortably inside a low-tier TPM limit
        # alongside the (now-resized, ~4-5K token) input images.
        "max_output_tokens": 2000,
    }

    try:
        upstream = requests.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}",
            },
            json=payload,
            timeout=OPENAI_TIMEOUT,
        )
    except requests.RequestException:
        raise CoinLensError("upstream_failure", "AI provider request failed.", 502)

    if not upstream.ok:
        _log_openai_error_response(upstream)

    try:
        data = upstream.json()
    except ValueError:
        raise CoinLensError("upstream_failure", "AI provider returned an unreadable response.", 502)

    # Logged regardless of success/failure (when present) so a 429 (real
    # per-request token cost) or an empty/truncated response (hit
    # max_output_tokens before emitting visible text - common with
    # reasoning-capable models spending the budget on hidden reasoning
    # tokens first) can both be diagnosed from Render logs instead of
    # guessing.
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        reasoning_tokens = (usage.get("output_tokens_details") or {}).get("reasoning_tokens") \
            if isinstance(usage.get("output_tokens_details"), dict) else None
        app.logger.info(
            "[identify] OpenAI usage: input_tokens=%s output_tokens=%s (reasoning=%s) "
            "total_tokens=%s response_status=%s http_status=%s",
            usage.get("input_tokens"), usage.get("output_tokens"), reasoning_tokens,
            usage.get("total_tokens"), data.get("status"), upstream.status_code,
        )

    if not upstream.ok:
        message = (data.get("error") or {}).get("message", "") if isinstance(data, dict) else ""
        if upstream.status_code == 401:
            raise CoinLensError("key_invalid", "AI provider rejected the API key.", 401)
        if upstream.status_code == 402:
            raise CoinLensError("quota", "AI provider billing limit reached.", 402)
        if upstream.status_code == 429:
            code = "quota" if "quota" in message.lower() or "billing" in message.lower() else "rate_limit"
            details = {}
            if code == "rate_limit":
                retry_after_seconds = _parse_retry_after_seconds(upstream.headers.get("retry-after"))
                if retry_after_seconds is not None:
                    details["retry_after_seconds"] = retry_after_seconds
            raise CoinLensError(code, "AI provider rate or quota limit reached.", 429, details=details)
        raise CoinLensError("upstream_failure", "AI provider request failed.", 502)

    text = extract_responses_output_text(data)
    if not text:
        app.logger.warning(
            "[identify] empty output_text: response_status=%s incomplete_details=%s",
            data.get("status") if isinstance(data, dict) else None,
            data.get("incomplete_details") if isinstance(data, dict) else None,
        )
        raise CoinLensError("identification_failure", "AI provider returned an empty response.", 422)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise CoinLensError("malformed_ai_response", "AI returned malformed JSON.", 502)

    return normalize_identification(parsed)


# ---------------------------------------------------------------------------
# Numista-first valuation
# ---------------------------------------------------------------------------

def _numista_result_list(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("types", "items", "results", "issues"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def _text_of(value):
    return str(value or "").strip().lower()


def _candidate_country_text(candidate):
    issuer = candidate.get("issuer")
    if isinstance(issuer, dict):
        return _text_of(issuer.get("name"))
    return _text_of(issuer or candidate.get("country"))


def _score_numista_candidate_breakdown(identification, candidate):
    """Same scoring as before, but returns (total, breakdown) so callers can
    log *why* a candidate gained or lost points instead of just a number -
    this is what actually lets a real search-response log line be diagnosed
    as a search problem vs. a scoring problem."""
    if not isinstance(candidate, dict):
        return 0, {}
    country = _text_of(identification.get("country"))
    denomination = _text_of(identification.get("denomination"))
    year = _text_of(identification.get("year"))
    title = _text_of(candidate.get("title"))
    cand_country = _candidate_country_text(candidate)

    breakdown = {}
    if country and country in cand_country:
        breakdown["country_issuer_match"] = 3
    if country and country in title:
        breakdown["country_in_title"] = 1
    if denomination and denomination in title:
        breakdown["denomination_in_title"] = 2
    if year and year in title:
        breakdown["year_in_title"] = 1
    min_year = candidate.get("min_year") or candidate.get("min_date")
    max_year = candidate.get("max_year") or candidate.get("max_date")
    try:
        if year.isdigit() and min_year is not None and max_year is not None:
            if int(min_year) <= int(year) <= int(max_year):
                breakdown["year_in_type_range"] = 2
    except (TypeError, ValueError):
        pass
    return sum(breakdown.values()), breakdown


def score_numista_candidate(identification, candidate):
    total, _ = _score_numista_candidate_breakdown(identification, candidate)
    return total


# Numista raw response bodies are logged truncated to this length - long
# enough to see the actual field shape (the thing we're verifying), short
# enough not to flood Render logs on every scan.
NUMISTA_LOG_BODY_CHARS = 1500


def search_numista_types(identification):
    """Returns a list of candidate Numista types, or None if the lookup
    itself failed (as opposed to succeeding with zero results)."""
    query = " ".join(filter(None, [identification.get("country"), identification.get("denomination")])).strip()
    if not query:
        app.logger.info("[numista] search skipped: no country/denomination to build a query from")
        return []
    try:
        upstream = requests.get(
            NUMISTA_TYPES_URL,
            # count=12, not 8: real search responses show Numista's own
            # free-text relevance ranking can put same-denomination coins
            # from an unrelated country ahead of the correct country's
            # match (e.g. "Canada 1 dollar" surfacing Australian "1 Dollar"
            # types first) - a slightly wider net gives the type+issue
            # resolution step below more real candidates to work with,
            # still a single search call either way.
            params={"q": query, "category": "coin", "count": 12},
            headers={"Numista-API-Key": NUMISTA_API_KEY},
            timeout=NUMISTA_TIMEOUT,
        )
    except requests.RequestException as error:
        app.logger.error("[numista] search request failed: query=%r error=%s", query, error)
        return None

    app.logger.info(
        "[numista] search response: query=%r status=%s body=%s",
        query, upstream.status_code, upstream.text[:NUMISTA_LOG_BODY_CHARS],
    )

    try:
        upstream.raise_for_status()
        results = _numista_result_list(upstream.json())
    except (requests.RequestException, ValueError) as error:
        app.logger.error("[numista] search response unusable: query=%r error=%s", query, error)
        return None

    app.logger.info("[numista] search found %d candidate(s) for query=%r", len(results), query)
    return results


def fetch_numista_type_detail(type_id):
    try:
        upstream = requests.get(
            f"{NUMISTA_TYPES_URL}/{type_id}",
            headers={"Numista-API-Key": NUMISTA_API_KEY},
            timeout=NUMISTA_TIMEOUT,
        )
        upstream.raise_for_status()
        data = upstream.json()
    except (requests.RequestException, ValueError) as error:
        app.logger.warning("[numista] type detail fetch failed: type_id=%s error=%s", type_id, error)
        return None

    app.logger.info(
        "[numista] type detail response: type_id=%s status=%s body=%s",
        type_id, upstream.status_code, upstream.text[:NUMISTA_LOG_BODY_CHARS],
    )
    return data if isinstance(data, dict) else None


# Numista v3 separates a *type* (e.g. "1 Dollar - Elizabeth II") from its
# *issues* (the specific year/mint-mark variants struck under that type).
# A type's own min_year/max_year is only the overall production range, and
# pricing is per-issue, not per-type - so a title/country score, however
# good, is not enough to call a match "confident": we require a real issue
# record for the identified year before selecting a type at all.
NUMISTA_MATCH_CANDIDATES_TO_INSPECT = 3  # how many top-scored types get an /issues lookup - keeps API usage bounded
NUMISTA_MATCH_MIN_SCORE = 2  # below this, a candidate isn't worth spending an extra HTTP call on at all


def fetch_numista_issues(type_id):
    """Returns a type's issue records (its specific year/mint-mark variants),
    or None if the request itself failed."""
    try:
        upstream = requests.get(
            f"{NUMISTA_TYPES_URL}/{type_id}/issues",
            headers={"Numista-API-Key": NUMISTA_API_KEY},
            timeout=NUMISTA_TIMEOUT,
        )
        upstream.raise_for_status()
        data = upstream.json()
    except (requests.RequestException, ValueError) as error:
        app.logger.warning("[numista] issues fetch failed: type_id=%s error=%s", type_id, error)
        return None

    app.logger.info(
        "[numista] issues response: type_id=%s status=%s body=%s",
        type_id, upstream.status_code, upstream.text[:NUMISTA_LOG_BODY_CHARS],
    )
    issues = _numista_result_list(data)
    app.logger.info(
        "[numista] issues inspected: type_id=%s count=%d years=%s",
        type_id, len(issues),
        [issue.get("year", (issue.get("min_year"), issue.get("max_year"))) for issue in issues if isinstance(issue, dict)],
    )
    return issues


def _issue_matches_year(issue, year_text):
    if not isinstance(issue, dict) or not year_text.isdigit():
        return False
    target = int(year_text)
    try:
        issue_year = issue.get("year")
        if issue_year is not None and int(issue_year) == target:
            return True
    except (TypeError, ValueError):
        pass
    try:
        min_year, max_year = issue.get("min_year"), issue.get("max_year")
        if min_year is not None and max_year is not None and int(min_year) <= target <= int(max_year):
            return True
    except (TypeError, ValueError):
        pass
    return False


def _issue_mint_text(issue):
    if not isinstance(issue, dict):
        return ""
    mint = issue.get("mint")
    if isinstance(mint, dict):
        return _text_of(mint.get("name") or mint.get("code"))
    mints = issue.get("mints")
    if isinstance(mints, list):
        return " ".join(_text_of(m.get("name") or m.get("code")) for m in mints if isinstance(m, dict))
    return _text_of(issue.get("mint_letter") or issue.get("mintmark"))


def _select_issue_for_year(identification, issues):
    """Among a type's issues, finds one matching the identified year. Mint
    mark (when the AI reported one) is used only to disambiguate between
    multiple same-year issues, never as a hard requirement - not every
    denomination/country carries one."""
    year_text = _text_of(identification.get("year"))
    year_matches = [issue for issue in (issues or []) if _issue_matches_year(issue, year_text)]
    if not year_matches:
        return None
    if len(year_matches) == 1:
        return year_matches[0]

    mint_mark = _text_of(identification.get("mint_mark"))
    if mint_mark:
        mint_matches = [issue for issue in year_matches if mint_mark in _issue_mint_text(issue)]
        if mint_matches:
            return mint_matches[0]
    return year_matches[0]


def resolve_numista_type_and_issue(identification, candidates):
    """Scores every candidate type (logging the full breakdown for each -
    not just the winner - so a real search response can be diagnosed as a
    search problem vs. a scoring problem), then inspects the top few
    candidates' real issue records and requires one to actually match the
    identified year. A well-scored title is only a hint about which
    candidates are worth an /issues lookup - it is never enough on its own
    to select a match. Returns (type_candidate, issue) or (None, None)."""
    if not candidates:
        return None, None

    scored = sorted(
        (( *_score_numista_candidate_breakdown(identification, c), c) for c in candidates),
        key=lambda entry: entry[0], reverse=True,
    )
    app.logger.info(
        "[numista] all candidates scored: %s",
        [
            (total, candidate.get("id"), candidate.get("title"), _candidate_country_text(candidate), breakdown)
            for total, breakdown, candidate in scored
        ],
    )

    to_inspect = [entry for entry in scored if entry[0] >= NUMISTA_MATCH_MIN_SCORE][:NUMISTA_MATCH_CANDIDATES_TO_INSPECT]
    if not to_inspect:
        app.logger.info(
            "[numista] no confident match: no candidate reached the minimum score of %s to justify an issues lookup",
            NUMISTA_MATCH_MIN_SCORE,
        )
        return None, None

    for total, _breakdown, candidate in to_inspect:
        type_id = candidate.get("id")
        if type_id is None:
            continue
        issues = fetch_numista_issues(type_id)
        if issues is None:
            app.logger.warning("[numista] skipping candidate id=%s: issues lookup failed", type_id)
            continue
        selected_issue = _select_issue_for_year(identification, issues)
        if selected_issue is None:
            app.logger.info(
                "[numista] rejected candidate id=%s title=%r score=%s: no issue matches year=%r",
                type_id, candidate.get("title"), total, identification.get("year"),
            )
            continue
        app.logger.info(
            "[numista] selected type+issue: type_id=%s title=%r score=%s issue_id=%s issue_year=%s",
            type_id, candidate.get("title"), total, selected_issue.get("id"), selected_issue.get("year"),
        )
        return candidate, selected_issue

    app.logger.info(
        "[numista] no confident match: none of the top %d inspected candidate(s) had a matching issue",
        len(to_inspect),
    )
    return None, None


def lookup_numista(identification):
    """Finds the strongest practical Numista type+issue match for the
    identified coin. Returns None when no confident match exists - callers
    must not treat that as an error, only as "no catalog match"."""
    if should_use_mock_coin_response():
        log_mock_response("lookup_numista")
        return dict(MOCK_NUMISTA)
    if not NUMISTA_API_KEY:
        app.logger.info("[numista] lookup skipped: no NUMISTA_API_KEY configured")
        return None
    if identification.get("identifiable") is False:
        return None

    app.logger.info(
        "[numista] lookup starting for identification: country=%r denomination=%r year=%r grade=%r",
        identification.get("country"), identification.get("denomination"),
        identification.get("year"), identification.get("estimated_grade"),
    )

    candidates = search_numista_types(identification)
    if candidates is None:
        return {"error": "Numista lookup unavailable."}

    best, issue = resolve_numista_type_and_issue(identification, candidates)
    if not best or not issue:
        return None

    type_id = best.get("id")
    detail = fetch_numista_type_detail(type_id) if type_id is not None else None
    merged = {**best, **(detail or {})}
    merged["numista_type_id"] = type_id
    merged["numista_issue_id"] = issue.get("id")
    merged["numista_issue"] = issue
    return merged


def fetch_numista_price(type_id, issue_id, grade):
    try:
        upstream = requests.get(
            f"{NUMISTA_TYPES_URL}/{type_id}/issues/{issue_id}/prices",
            params={"currency": "USD"},
            headers={"Numista-API-Key": NUMISTA_API_KEY},
            timeout=NUMISTA_TIMEOUT,
        )
    except requests.RequestException as error:
        app.logger.error("[numista] price request failed: type_id=%s issue_id=%s error=%s", type_id, issue_id, error)
        return None

    app.logger.info(
        "[numista] price response: type_id=%s issue_id=%s grade=%r status=%s body=%s",
        type_id, issue_id, grade, upstream.status_code, upstream.text[:NUMISTA_LOG_BODY_CHARS],
    )

    if upstream.status_code in (401, 402, 403, 404):
        app.logger.info("[numista] price unavailable for type_id=%s issue_id=%s (status=%s)", type_id, issue_id, upstream.status_code)
        return None
    try:
        upstream.raise_for_status()
        data = upstream.json()
    except (requests.RequestException, ValueError) as error:
        app.logger.error("[numista] price response unusable: type_id=%s issue_id=%s error=%s", type_id, issue_id, error)
        return None

    prices = data.get("prices") if isinstance(data, dict) else None
    if not isinstance(prices, list) or not prices:
        app.logger.info("[numista] price response had no usable 'prices' list: type_id=%s issue_id=%s", type_id, issue_id)
        return None

    grade_text = _text_of(grade)
    for entry in prices:
        if isinstance(entry, dict) and _text_of(entry.get("grade")) == grade_text and entry.get("price") is not None:
            app.logger.info("[numista] exact grade price match: type_id=%s issue_id=%s grade=%r price=%s", type_id, issue_id, grade, entry["price"])
            return {"value": entry["price"], "grade": entry.get("grade"), "exact_grade_match": True}

    priced = [entry for entry in prices if isinstance(entry, dict) and entry.get("price") is not None]
    if not priced:
        app.logger.info("[numista] no priced grade entries found: type_id=%s issue_id=%s", type_id, issue_id)
        return None
    middle = priced[len(priced) // 2]
    app.logger.info(
        "[numista] no exact grade match, using nearest available: type_id=%s issue_id=%s requested_grade=%r used_grade=%r price=%s",
        type_id, issue_id, grade, middle.get("grade"), middle["price"],
    )
    return {"value": middle["price"], "grade": middle.get("grade"), "exact_grade_match": False}


def lookup_pcgs(numista_data):
    if should_use_mock_coin_response():
        log_mock_response("lookup_pcgs")
        return dict(MOCK_PCGS)
    if not PCGS_BEARER_TOKEN or not isinstance(numista_data, dict):
        return None
    references = numista_data.get("references") or []
    pcgs_reference = next((ref for ref in references if ref.get("type") == "PCGS" and ref.get("number")), None)
    if not pcgs_reference:
        app.logger.info("[pcgs] skipped: no PCGS reference number in Numista match")
        return None
    try:
        upstream = requests.get(
            PCGS_PRICE_URL.format(pcgs_number=pcgs_reference["number"]),
            headers={"Authorization": f"bearer {PCGS_BEARER_TOKEN}"},
            timeout=PCGS_TIMEOUT,
        )
        upstream.raise_for_status()
        data = upstream.json()
        if isinstance(data, dict):
            data.setdefault("source_note", "PCGS priceguide lookup by Numista PCGS reference number; this is not automated grading.")
        app.logger.info("[pcgs] lookup succeeded: pcgs_number=%s price=%s", pcgs_reference["number"], data.get("price") if isinstance(data, dict) else None)
        return data
    except (requests.RequestException, ValueError) as error:
        app.logger.warning("[pcgs] lookup failed: pcgs_number=%s error=%s", pcgs_reference["number"], error)
        return {"error": "PCGS lookup unavailable."}


def estimate_value(identification, numista_data):
    """Numista is the primary valuation source. PCGS is an optional fallback.
    Never invents a number - if there's no confident catalog match or no
    usable price, valuation is reported as unavailable."""
    if should_use_mock_coin_response():
        log_mock_response("estimate_value")
        return dict(deterministic_mock_coin_result()["valuation"])

    if identification.get("identifiable") is False:
        return {"status": "unavailable", "currency": "USD", "source": "CoinLens", "reason": "Coin was not identifiable."}

    if not isinstance(numista_data, dict) or numista_data.get("error"):
        app.logger.info("[valuation] unavailable: no confident Numista catalog match")
        return {"status": "unavailable", "currency": "USD", "source": "CoinLens", "reason": "No confident Numista catalog match."}

    type_id = numista_data.get("numista_type_id") or numista_data.get("id")
    issue_id = numista_data.get("numista_issue_id")
    if type_id is None or issue_id is None:
        app.logger.info("[valuation] unavailable: Numista match had no usable type/issue id")
        return {"status": "unavailable", "currency": "USD", "source": "CoinLens", "reason": "No confident Numista catalog match."}

    price = fetch_numista_price(type_id, issue_id, identification.get("estimated_grade"))
    if not price:
        app.logger.info("[valuation] unavailable: Numista match found (type_id=%s issue_id=%s) but no usable price", type_id, issue_id)
        return {"status": "unavailable", "currency": "USD", "source": "Numista", "reason": "Numista match found but no usable price for this grade."}

    app.logger.info("[valuation] available from Numista: type_id=%s issue_id=%s value=%s", type_id, issue_id, price["value"])
    return {
        "status": "available",
        "estimated_value": round(float(price["value"]), 2),
        "currency": "USD",
        "source": "Numista",
        "condition_assumed": price.get("grade") or identification.get("estimated_grade"),
        "grade_matched_exactly": price.get("exact_grade_match", False),
    }


def build_coin_summary(identification, valuation):
    """Templated, not AI-generated - keeps the scan pipeline to a single
    OpenAI call while still giving the UI a human-readable summary."""
    label = " ".join(
        part for part in [identification.get("year"), identification.get("country"), identification.get("denomination")]
        if part and part != "Unknown"
    ) or identification.get("coin_name") or "This coin"

    sentences = [f"This looks like a {label}."]

    grade = identification.get("estimated_grade")
    if grade and grade != "Unknown":
        sentences.append(f"Estimated grade: {grade} (AI visual estimate, not a professional certified grade).")

    if valuation.get("status") == "available" and valuation.get("estimated_value") is not None:
        sentences.append(
            f"Numista-based estimated value: ${valuation['estimated_value']:.2f} {valuation.get('currency', 'USD')}."
        )
    else:
        sentences.append("A reliable market value wasn't available for this specific coin and grade.")

    if identification.get("mint_errors"):
        sentences.append("Possible mint errors were noted - see the details below.")

    return " ".join(sentences)


def build_mock_coin_result(front_image_present=True, back_image_present=False):
    return deterministic_mock_coin_result(front_image_present, back_image_present)


def build_coinlens_result(front_image, back_image=None):
    if should_use_mock_coin_response():
        log_mock_response("/api/identify-coin")
        return build_mock_coin_result(True, back_image is not None)

    identification = identify_coin_with_ai(front_image, back_image)
    app.logger.info(
        "[identify] OpenAI result: status=%s confidence=%s country=%r denomination=%r year=%r grade=%r",
        identification.get("status"), identification.get("confidence"),
        identification.get("country"), identification.get("denomination"),
        identification.get("year"), identification.get("estimated_grade"),
    )
    if identification.get("identifiable") is False:
        return {
            "identification": identification,
            "valuation": {"status": "unavailable", "currency": "USD", "source": "CoinLens", "reason": "Coin was not identifiable."},
            "summary": identification.get("unidentifiable_reason"),
        }

    numista_data = lookup_numista(identification)
    pcgs_data = lookup_pcgs(numista_data)
    valuation = estimate_value(identification, numista_data)
    if valuation.get("status") != "available" and isinstance(pcgs_data, dict) and pcgs_data.get("price") is not None:
        app.logger.info("[valuation] promoted to PCGS fallback: price=%s", pcgs_data["price"])
        valuation = {
            "status": "available",
            "estimated_value": round(float(pcgs_data["price"]), 2),
            "currency": "USD",
            "source": "PCGS",
            "condition_assumed": pcgs_data.get("grade") or identification.get("estimated_grade"),
        }
    app.logger.info(
        "[identify] final valuation: status=%s source=%s value=%s",
        valuation.get("status"), valuation.get("source"), valuation.get("estimated_value"),
    )
    summary = build_coin_summary(identification, valuation)
    return {
        "identification": identification,
        "valuation": valuation,
        "numista": numista_data,
        "pcgs": pcgs_data,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# Authoritative persistence (M3)
# ---------------------------------------------------------------------------

def canonicalize_denomination(denomination, coin_name):
    text = f"{denomination or ''} {coin_name or ''}".lower()
    if "wheat" in text:
        return "wheat-penny"
    if "cent" in text or "penny" in text:
        return "penny"
    if "nickel" in text or "five cent" in text:
        return "nickel"
    if "dime" in text or "ten cent" in text:
        return "dime"
    if "quarter" in text or "twenty-five cent" in text or "twenty five cent" in text:
        return "quarter"
    if "half dollar" in text or "half-dollar" in text:
        return "half-dollar"
    if "dollar" in text:
        return "dollar"
    slug = re.sub(r"[^a-z0-9]+", "-", (denomination or "").lower()).strip("-")
    return slug or None


def is_foreign_country(country):
    text = _text_of(country)
    if not text:
        return False
    return text not in US_COUNTRY_NAMES


def compute_local_date_hour(tz_offset_minutes):
    """tz_offset_minutes matches JS Date.getTimezoneOffset(): minutes to ADD
    to local time to reach UTC. Falls back to UTC (offset 0) if the client
    didn't send one."""
    try:
        offset = int(tz_offset_minutes)
    except (TypeError, ValueError):
        offset = 0
    offset = max(-14 * 60, min(14 * 60, offset))
    local_dt = datetime.now(timezone.utc) - timedelta(minutes=offset)
    return local_dt.date().isoformat(), local_dt.hour


def parse_year(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def persist_scan(user_id, identification, valuation, source, tz_offset_minutes):
    local_date, local_hour = compute_local_date_hour(tz_offset_minutes)
    payload = {
        "user_id": user_id,
        "coin_name": identification.get("coin_name"),
        "country": identification.get("country"),
        "denomination": identification.get("denomination"),
        "year": parse_year(identification.get("year")),
        "mint_mark": identification.get("mint_mark"),
        "estimated_grade": identification.get("estimated_grade"),
        "estimated_value": valuation.get("estimated_value") if valuation.get("status") == "available" else None,
        "source": source,
        "denom_canonical": canonicalize_denomination(identification.get("denomination"), identification.get("coin_name")),
        "is_foreign": is_foreign_country(identification.get("country")),
        "local_date": local_date,
        "local_hour": local_hour,
    }
    return insert_scan(payload)


# ---------------------------------------------------------------------------
# M6: daily AI-attempt quota (Supabase-backed, survives restarts/multi-worker)
# ---------------------------------------------------------------------------

def daily_window_start_iso():
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def check_and_reserve_quota(user_id):
    """Counts today's AI attempts (successful or not) and, if under the
    limit, reserves this attempt immediately - before OpenAI is called - so a
    burst of concurrent requests can't blow past the limit while each request
    is still waiting on its own OpenAI call."""
    since = daily_window_start_iso()
    try:
        count = count_api_usage_since(user_id, since)
    except SupabaseAdminError as error:
        app.logger.error("quota count failed for user_id=%s: %s", user_id, error)
        raise CoinLensError("quota_check_failed", "Could not verify your usage limit. Try again shortly.", 503)

    if count >= DAILY_SCAN_LIMIT:
        raise CoinLensError(
            "quota_exceeded",
            f"Daily scan limit of {DAILY_SCAN_LIMIT} reached. Try again tomorrow.",
            429,
        )

    try:
        usage_row = insert_api_usage({"user_id": user_id, "endpoint": "identify-coin", "status": "attempted"})
    except SupabaseAdminError as error:
        app.logger.error("quota reserve failed for user_id=%s: %s", user_id, error)
        raise CoinLensError("quota_check_failed", "Could not reserve a scan attempt. Try again shortly.", 503)

    remaining = max(0, DAILY_SCAN_LIMIT - count - 1)
    return usage_row.get("id"), remaining


@app.route("/api/identify-coin", methods=["POST"])
@require_auth
def identify_coin():
    source = read_request_field("source")
    if source not in ("camera", "gallery"):
        return error_response(CoinLensError("invalid_source", "source must be 'camera' or 'gallery'.", 400))

    front_image, back_image = read_identification_images()
    tz_offset_minutes = read_request_field("tz_offset_minutes")

    mock = should_use_mock_coin_response()
    usage_id, remaining = (None, None)
    if not mock:
        usage_id, remaining = check_and_reserve_quota(g.user_id)

    try:
        result = build_coinlens_result(front_image, back_image)
    except CoinLensError:
        update_api_usage(usage_id, {"status": "error"})
        raise

    identification = result.get("identification", {})
    if identification.get("identifiable") is False:
        update_api_usage(usage_id, {"status": "uncertain"})
        body = dict(result)
        if remaining is not None:
            body["remaining_today"] = remaining
        return jsonify(body), 422

    try:
        scan_row = persist_scan(g.user_id, identification, result.get("valuation") or {}, source, tz_offset_minutes)
    except SupabaseAdminError as error:
        app.logger.error("scan insert failed for user_id=%s: %s", g.user_id, error)
        update_api_usage(usage_id, {"status": "error"})
        return error_response(CoinLensError("scan_insert_failed", "Identification succeeded but the scan could not be saved.", 500))

    app.logger.info("[identify] scan persisted: id=%s user_id=%s source=%s", scan_row.get("id"), g.user_id, source)
    update_api_usage(usage_id, {"status": "identified", "scan_id": scan_row.get("id")})

    body = dict(result)
    body["scan"] = scan_row
    if remaining is not None:
        body["remaining_today"] = remaining
    return jsonify(body)


@app.route("/api/generate-ebay-listing", methods=["POST"])
@require_auth
def generate_ebay_listing():
    if not ENABLE_EBAY_LISTING:
        return jsonify({
            "feature_disabled": True,
            "feature": "ebay_listing",
            "message": "eBay listing generation is disabled in this version.",
        }), 200

    payload = request.get_json(force=True, silent=True) or {}
    if should_use_mock_coin_response():
        log_mock_response("/api/generate-ebay-listing")
        return jsonify(dict(MOCK_EBAY_LISTING))

    try:
        prompt = f"""You are an expert eBay copywriter for collectible coins. Create a polished listing draft.

Coin data: {json.dumps(payload.get("identification") or payload.get("coinData"))}
Numista specs: {json.dumps(payload.get("numista") or payload.get("numistaData"))}
Value estimate: {json.dumps(payload.get("valuation") or payload.get("valueEstimate"))}
Summary: {payload.get("summary") or "No summary available"}

Return ONLY a raw JSON object with these exact keys:
- "title": string
- "subtitle": string
- "description": string
- "item_specifics": array of objects with "label" and "value"
- "shipping_notes": string"""
        return jsonify(extract_json(openai_chat_content([{"role": "user", "content": prompt}], 800)))
    except CoinLensError as error:
        return error_response(error)


@app.route("/api/numista-specs", methods=["GET"])
def numista_specs():
    if should_use_mock_coin_response():
        log_mock_response("/api/numista-specs")
        return jsonify({"items": [dict(MOCK_NUMISTA)], "marker": MOCK_MARKER})

    if not NUMISTA_API_KEY:
        return jsonify({"items": []})

    upstream = requests.get(
        NUMISTA_COINS_URL,
        params={"q": request.args.get("q", ""), "count": request.args.get("count", 1)},
        headers={"Numista-API-Key": NUMISTA_API_KEY},
        timeout=NUMISTA_TIMEOUT,
    )
    return proxy_response(upstream)


@app.route("/api/pcgs-value/<pcgs_number>", methods=["GET"])
def pcgs_value(pcgs_number):
    if should_use_mock_coin_response():
        log_mock_response("/api/pcgs-value")
        payload = dict(MOCK_PCGS)
        payload["pcgs_number"] = pcgs_number
        return jsonify(payload)

    if not PCGS_BEARER_TOKEN:
        return jsonify(None)

    upstream = requests.get(
        PCGS_PRICE_URL.format(pcgs_number=pcgs_number),
        headers={"Authorization": f"bearer {PCGS_BEARER_TOKEN}"},
        timeout=PCGS_TIMEOUT,
    )
    return proxy_response(upstream)


@app.route("/api/log-scan", methods=["POST"])
def log_scan():
    if should_use_mock_coin_response():
        log_mock_response("/api/log-scan")
        return jsonify({"success": True, "marker": MOCK_MARKER})

    if not SHEETDB_URL:
        return jsonify({"skipped": True})

    payload = request.get_json(force=True, silent=True) or {}
    upstream = requests.post(SHEETDB_URL, json=payload, timeout=REQUEST_TIMEOUT)
    return proxy_response(upstream)


@app.route("/api/scans", methods=["GET"])
def get_scans():
    if should_use_mock_coin_response():
        log_mock_response("/api/scans")
        return jsonify([dict(MOCK_SCAN_ROW)])

    if not SHEETDB_URL:
        return jsonify([])

    upstream = requests.get(SHEETDB_URL, timeout=REQUEST_TIMEOUT)
    return proxy_response(upstream)


@app.route("/api/test-scan", methods=["POST"])
@require_user
def test_scan():
    payload = {
        "user_id": g.user_id,
        "coin_name": "Lincoln Wheat Cent",
        "year": 1946,
        "estimated_value": 0.20,
        "source": "camera",
    }
    try:
        row = insert_scan(payload)
    except SupabaseAdminError as error:
        app.logger.error("test_scan insert failed for user_id=%s: %s", g.user_id, error)
        return jsonify({"error": {"code": "scan_insert_failed", "message": "Could not save scan."}}), 500

    app.logger.info("test_scan created scan id=%s for user_id=%s", row.get("id"), g.user_id)
    return jsonify(row), 201


@app.route("/api/verify-admin-code", methods=["POST"])
def verify_admin_code():
    payload = request.get_json(force=True, silent=True) or {}
    submitted = str(payload.get("code", "")).strip()
    valid = bool(ADMIN_CODE) and submitted == ADMIN_CODE
    return jsonify({"valid": valid})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
