"""Supabase server-side client for trusted backend writes.

This client authenticates with the Supabase service-role key, which BYPASSES
Row Level Security. It must only be used for writes that the server has itself
validated. It must never be used to read data on behalf of a user: user reads
go through Expo with the user's own JWT.
"""

import logging
import os

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

REQUEST_TIMEOUT = 10

logger = logging.getLogger(__name__)


class SupabaseAdminError(RuntimeError):
    """Raised when a trusted server-side Supabase write cannot be completed."""


def _headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _require_config():
    if not SUPABASE_URL:
        raise SupabaseAdminError("SUPABASE_URL environment variable is missing.")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise SupabaseAdminError("SUPABASE_SERVICE_ROLE_KEY environment variable is missing.")


def insert_scan(payload: dict) -> dict:
    """Insert a row into the ``scans`` table and return the created row.

    Raises ``SupabaseAdminError`` if the client is not configured or if Supabase
    responds with any non-2xx status.
    """
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/scans"

    try:
        response = requests.post(
            url,
            json=payload,
            headers=_headers(),
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        logger.error("supabase insert_scan request failed: %s", error)
        raise SupabaseAdminError(f"scans insert request failed: {error}") from error

    if not response.ok:
        logger.error(
            "supabase insert_scan failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise SupabaseAdminError(
            f"scans insert failed: status={response.status_code} body={response.text[:500]}"
        )

    try:
        data = response.json()
    except ValueError as error:
        logger.error(
            "supabase insert_scan returned an unreadable body: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise SupabaseAdminError(
            f"scans insert returned an unreadable body: status={response.status_code}"
        ) from error

    if isinstance(data, list):
        if not data:
            raise SupabaseAdminError("scans insert returned no row.")
        return data[0]
    return data


def _first_row_or_dict(data, context):
    if isinstance(data, list):
        if not data:
            raise SupabaseAdminError(f"{context} returned no row.")
        return data[0]
    return data


def count_api_usage_since(user_id: str, since_iso: str) -> int:
    """Count api_usage rows for a user at/after ``since_iso`` (server-only)."""
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/api_usage"
    headers = _headers()
    headers["Prefer"] = "count=exact"

    try:
        response = requests.get(
            url,
            params={
                "user_id": f"eq.{user_id}",
                "created_at": f"gte.{since_iso}",
                "select": "id",
                "limit": "1",
            },
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as error:
        logger.error("supabase count_api_usage_since request failed: %s", error)
        raise SupabaseAdminError(f"api_usage count request failed: {error}") from error

    if not response.ok:
        logger.error(
            "supabase count_api_usage_since failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise SupabaseAdminError(
            f"api_usage count failed: status={response.status_code} body={response.text[:500]}"
        )

    content_range = response.headers.get("Content-Range", "")
    if "/" in content_range:
        total = content_range.rsplit("/", 1)[-1]
        if total.isdigit():
            return int(total)

    try:
        return len(response.json() or [])
    except ValueError:
        return 0


def insert_api_usage(payload: dict) -> dict:
    """Insert a row into ``api_usage`` and return the created row (server-only)."""
    _require_config()

    url = f"{SUPABASE_URL}/rest/v1/api_usage"
    try:
        response = requests.post(url, json=payload, headers=_headers(), timeout=REQUEST_TIMEOUT)
    except requests.RequestException as error:
        logger.error("supabase insert_api_usage request failed: %s", error)
        raise SupabaseAdminError(f"api_usage insert request failed: {error}") from error

    if not response.ok:
        logger.error(
            "supabase insert_api_usage failed: status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise SupabaseAdminError(
            f"api_usage insert failed: status={response.status_code} body={response.text[:500]}"
        )

    try:
        data = response.json()
    except ValueError as error:
        raise SupabaseAdminError("api_usage insert returned an unreadable body.") from error

    return _first_row_or_dict(data, "api_usage insert")


def update_api_usage(usage_id: str, payload: dict) -> None:
    """Best-effort update of an api_usage row's outcome. Never raises: this is
    bookkeeping for the daily quota count, not something a request should fail
    over if it can't be written."""
    if not usage_id:
        return
    try:
        _require_config()
        url = f"{SUPABASE_URL}/rest/v1/api_usage?id=eq.{usage_id}"
        response = requests.patch(url, json=payload, headers=_headers(), timeout=REQUEST_TIMEOUT)
        if not response.ok:
            logger.warning(
                "supabase update_api_usage failed: status=%s body=%s",
                response.status_code,
                response.text[:300],
            )
    except (requests.RequestException, SupabaseAdminError) as error:
        logger.warning("supabase update_api_usage failed: %s", error)
