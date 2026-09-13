import Constants from "expo-constants";

import { getAccessToken } from "./supabase";
import { ScanError, makeErrorDetail } from "../../scanErrorLogic";

export { ScanError, makeErrorDetail };

function resolveApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  const configUrl = Constants.expoConfig?.extra?.apiBaseUrl?.trim();
  const url = envUrl || configUrl;

  if (url) return url.replace(/\/$/, "");

  console.warn("EXPO_PUBLIC_API_BASE_URL is not set - set it to your Render URL in .env.local");
  return "http://localhost:5000";
}

export const API_BASE_URL = resolveApiBaseUrl();
console.log("CoinLens API base URL:", API_BASE_URL);

// Central fetch wrapper: every call to our Flask backend goes through here so
// the Supabase JWT is attached in one place instead of per-screen. Reads the
// current Supabase session and sends `Authorization: Bearer <access_token>`.
// Never sends user_id as proof of identity.
export async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
  return fetch(url, { ...options, headers });
}

async function readJsonResponse(res) {
  try {
    return await res.json();
  } catch {
    throw new ScanError("server_error", `Server sent an unreadable response (HTTP ${res.status}).`);
  }
}

function throwForErrorResponse(res, data) {
  if (res.ok) return;

  const code = data?.error?.code || (res.status >= 500 ? "server_error" : "unknown");
  const message = data?.error?.message || `CoinLens request failed (HTTP ${res.status}).`;
  const retryAfterSeconds = typeof data?.error?.retry_after_seconds === "number"
    ? data.error.retry_after_seconds
    : undefined;
  throw new ScanError(code, message, { retryAfterSeconds });
}

export function toLegacyScanResult(result) {
  if (!result) return null;
  return {
    coinData: result.identification || null,
    numistaData: result.numista || null,
    pcgsData: result.pcgs || null,
    valueEstimate: result.valuation?.status === "available" ? result.valuation : null,
    summary: result.summary || null,
    coinLensResult: result,
  };
}

export async function identifyCoin(frontImage, backImage = null, source = "camera") {
  const token = await getAccessToken();
  if (!token) {
    throw new ScanError("auth_required", "Sign in to identify and value coins.");
  }

  let res;
  try {
    res = await apiFetch(`/api/identify-coin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        front_image: frontImage,
        back_image: backImage || undefined,
        source,
        // Matches JS Date.getTimezoneOffset(): minutes to ADD to local time
        // to reach UTC. Flask uses this only for display grouping (seasonal/
        // time-of-day badges), never for identity or valuation.
        tz_offset_minutes: new Date().getTimezoneOffset(),
      }),
    });
  } catch {
    throw new ScanError("network", "No internet connection. Could not reach CoinLens.");
  }

  const data = await readJsonResponse(res);
  if (res.status === 422 && data?.identification?.identifiable === false) {
    return data;
  }
  throwForErrorResponse(res, data);
  return data;
}

export async function logScanToSheet(coinData, userName = "") {
  const coin = [coinData.year, coinData.country, coinData.denomination]
    .filter(v => v && v !== "Unknown")
    .join(" ");
  await apiFetch(`/api/log-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ Coin: coin, Time: new Date().toISOString(), User: userName }] }),
  }).catch(() => {});
}

export async function verifyAdminCode(code) {
  try {
    const res = await apiFetch(`/api/verify-admin-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    return !!data.valid;
  } catch {
    return false;
  }
}

export async function generateEbayListing(coinLensResultOrCoinData, numistaData, valueEstimate, summary) {
  const payload = coinLensResultOrCoinData?.identification
    ? coinLensResultOrCoinData
    : {
        identification: coinLensResultOrCoinData,
        numista: numistaData,
        valuation: valueEstimate,
        summary,
      };

  let res;
  try {
    res = await apiFetch(`/api/generate-ebay-listing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ScanError("network", "No internet connection. Could not reach CoinLens.");
  }

  const data = await readJsonResponse(res);
  throwForErrorResponse(res, data);
  return data;
}

// TEMP: verifies the full Expo -> Render -> Supabase auth flow. Calls the
// backend's Supabase-protected /api/me and returns { id, email }.
export async function getMe() {
  let res;
  try {
    res = await apiFetch(`/api/me`);
  } catch {
    throw new ScanError("network", "No internet connection. Could not reach CoinLens.");
  }
  const data = await readJsonResponse(res);
  throwForErrorResponse(res, data);
  return data;
}

// TEMP: debug-only call to the backend's Supabase-protected /api/test-scan.
// Sends no request body; the server derives user_id from the JWT and inserts
// a fixed test row. Returns the inserted row ({ id, user_id, ... }).
export async function postTestScan() {
  let res;
  try {
    res = await apiFetch(`/api/test-scan`, { method: "POST" });
  } catch {
    throw new ScanError("network", "No internet connection. Could not reach CoinLens.");
  }
  const data = await readJsonResponse(res);
  try {
    throwForErrorResponse(res, data);
  } catch (e) {
    e.status = res.status;
    throw e;
  }
  return data;
}



