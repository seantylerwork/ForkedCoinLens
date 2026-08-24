import aiLogic from "../../aiLogic";

const { extractJSON: parseJSON, getModelCandidates, isRetryableError } = aiLogic;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:5000";
export const MOCK_MODE = process.env.EXPO_PUBLIC_MOCK_MODE === "true";
const OPENAI_URL = `${API_BASE_URL}/api/openai/chat`;

export class ScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ERROR_DISPLAY = {
  network:      { icon: "📡", title: "No Internet",           tip: "Make sure WiFi or cellular data is enabled." },
  key_invalid:  { icon: "🔑", title: "Invalid API Key",       tip: "Update OPENAI_API_KEY in the server's .env file." },
  key_missing:  { icon: "🔑", title: "API Key Missing",       tip: "Add OPENAI_API_KEY to the server's .env file." },
  rate_limit:   { icon: "⏳", title: "Rate Limit Hit",         tip: "Wait 30 seconds and try again." },
  quota:        { icon: "💳", title: "Usage Limit Reached",   tip: "Check your billing at platform.openai.com." },
  server_error: { icon: "🔧", title: "OpenAI Service Issue",  tip: "OpenAI may be down. Try again in a few minutes." },
  camera:       { icon: "📷", title: "Camera Not Ready",      tip: "Wait a moment, then try again." },
  photo:        { icon: "📷", title: "Photo Capture Failed",  tip: "Make sure nothing is blocking the camera lens." },
  ai_parse:     { icon: "🤖", title: "AI Returned Bad Data",  tip: "This is rare — try scanning again." },
  ai_empty:     { icon: "🤖", title: "AI Gave No Response",   tip: "Servers may be busy. Try again in a moment." },
  unknown:      { icon: "⚠️",  title: "Something Went Wrong", tip: "Try scanning again." },
};

export function makeErrorDetail(e) {
  const code = e instanceof ScanError ? e.code : "unknown";
  const display = ERROR_DISPLAY[code] ?? ERROR_DISPLAY.unknown;
  return { ...display, body: e.message };
}

function extractJSON(text) {
  try {
    return parseJSON(text);
  } catch {
    throw new ScanError("ai_parse", "The AI returned malformed data. Try scanning again.");
  }
}

async function openaiPost(messages, maxTokens = 400, model = "gpt-4o-mini") {
  const candidates = getModelCandidates(model);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidateModel = candidates[index];
    let res;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: candidateModel, messages, max_tokens: maxTokens }),
      });
    } catch {
      if (index < candidates.length - 1) continue;
      throw new ScanError("network", "No internet connection — couldn't reach OpenAI.");
    }

    let data;
    try {
      data = await res.json();
    } catch {
      if (index < candidates.length - 1) continue;
      throw new ScanError("server_error", `OpenAI sent an unreadable response (HTTP ${res.status}).`);
    }

    if (!res.ok) {
      const msg = data?.error?.message ?? "";
      const retryable = isRetryableError({ status: res.status, message: msg });
      if (retryable && index < candidates.length - 1) continue;
      if (res.status === 401) throw new ScanError("key_invalid", msg || "OpenAI rejected the API key (401 Unauthorized).");
      if (res.status === 429) {
        const isQuota = msg.includes("quota") || msg.includes("billing");
        throw new ScanError(isQuota ? "quota" : "rate_limit", msg || "OpenAI rate limit exceeded (429).");
      }
      if (res.status === 402) throw new ScanError("quota", msg || "OpenAI billing limit reached (402).");
      if (res.status >= 500) throw new ScanError("server_error", msg || `OpenAI server error (HTTP ${res.status}).`);
      throw new ScanError("unknown", msg || `OpenAI error (HTTP ${res.status}).`);
    }

    if (!data.choices?.[0]?.message?.content) {
      if (index < candidates.length - 1) continue;
      throw new ScanError("ai_empty", "OpenAI returned an empty response.");
    }

    return data.choices[0].message.content.trim();
  }

  throw new ScanError("server_error", "OpenAI did not return a usable response.");
}

export async function identifyCoinFromImage(base64Image) {
  // Step 1: pure visual description — model focuses only on what it sees
  const description = await openaiPost([{
    role: "user",
    content: [
      { type: "text", text: `You are an expert numismatist examining a coin. Describe everything you can see in exhaustive detail:
- Obverse and reverse designs, portraits, inscriptions, mottos
- Date and mint mark (exact characters visible)
- Country and denomination text
- Metal color and composition clues
- Surface condition: luster, wear, contact marks, scratches, toning
- Any doubling on letters or devices, off-center strike, planchet irregularities, die cracks, or other anomalies
- Overall grade estimate using the Sheldon scale
Be specific and literal — describe exactly what you observe, not what you assume.` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: "high" } },
    ],
  }], 800, "gpt-4o");

  // Step 2: structured extraction from the description
  const text = await openaiPost([{
    role: "user",
    content: `Based on this numismatist's description of a coin, return ONLY a raw JSON object (no markdown) with these exact keys:
- "country": string
- "denomination": string
- "year": string
- "mint_mark": string or null
- "estimated_grade": string (Sheldon scale, e.g. "MS-63", "VF-30", "PR-65 DCAM")
- "mint_errors": array of strings describing each error or anomaly observed (empty array if none)
- "varieties": string describing any known die variety, or null
- "error_premium": boolean (true if errors/varieties meaningfully increase value)
- "special_notes": string with anything a collector should know
- "identifiable": boolean — false if the image is too blurry, too dark, not a coin, or genuinely unidentifiable; true otherwise
- "unidentifiable_reason": string explaining why — only if identifiable is false (e.g. "Image is too blurry to read the date or country", "Object does not appear to be a coin")
- "confidence": integer 0-100 (how certain the identification is)
- "alternatives": array of up to 3 objects {"coin": string, "confidence": integer} — only include alternatives that are a genuinely different coin type, country, or denomination (e.g. "1921 Morgan Dollar" vs "1921 Peace Dollar", or "Canadian cent" vs "US cent"). Do NOT suggest adjacent years of the same coin as alternatives — that is not a meaningful alternative. Leave as empty array [] if the only uncertainty is the exact year.

Description:
${description}`,
  }], 600);
  return extractJSON(text);
}

export async function identifyCoinFromImages(frontBase64, backBase64) {
  const description = await openaiPost([{
    role: "user",
    content: [
      { type: "text", text: `You are an expert numismatist examining a coin. Compare both sides of the coin carefully and describe everything you can see in exhaustive detail:
- Front and back designs, portraits, inscriptions, mottos
- Date and mint mark (exact characters visible)
- Country and denomination text
- Metal color and composition clues
- Surface condition: luster, wear, contact marks, scratches, toning
- Any doubling, off-center strike, planchet irregularities, die cracks, or other anomalies
- Overall grade estimate using the Sheldon scale
Be specific and literal — describe exactly what you observe, not what you assume.` },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${frontBase64}`, detail: "high" } },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${backBase64}`, detail: "high" } },
    ],
  }], 800, "gpt-4o");

  const text = await openaiPost([{
    role: "user",
    content: `Based on this numismatist's description of both sides of a coin, return ONLY a raw JSON object (no markdown) with these exact keys:
- "country": string
- "denomination": string
- "year": string
- "mint_mark": string or null
- "estimated_grade": string (Sheldon scale, e.g. "MS-63", "VF-30", "PR-65 DCAM")
- "mint_errors": array of strings describing each error or anomaly observed (empty array if none)
- "varieties": string describing any known die variety, or null
- "error_premium": boolean (true if errors/varieties meaningfully increase value)
- "special_notes": string with anything a collector should know
- "identifiable": boolean — false if the image is too blurry, too dark, not a coin, or genuinely unidentifiable; true otherwise
- "unidentifiable_reason": string explaining why — only if identifiable is false (e.g. "Image is too blurry to read the date or country", "Object does not appear to be a coin")
- "confidence": integer 0-100 (how certain the identification is)
- "alternatives": array of up to 3 objects {"coin": string, "confidence": integer} — only include alternatives that are a genuinely different coin type, country, or denomination (e.g. "1921 Morgan Dollar" vs "1921 Peace Dollar", or "Canadian cent" vs "US cent"). Do NOT suggest adjacent years of the same coin as alternatives — that is not a meaningful alternative. Leave as empty array [] if the only uncertainty is the exact year.

Description:
${description}`,
  }], 600);
  return extractJSON(text);
}

export async function getNumistaSpecs(coinData) {
  try {
    const q = `${coinData.country || ""} ${coinData.denomination || ""} ${coinData.year || ""}`.trim();
    const res = await fetch(`${API_BASE_URL}/api/numista-specs?q=${encodeURIComponent(q)}&count=1`);
    const data = await res.json();
    return data?.items?.[0] || null;
  } catch {
    return null;
  }
}

export async function logScanToSheet(coinData, userName = "") {
  const coin = [coinData.year, coinData.country, coinData.denomination]
    .filter(v => v && v !== "Unknown")
    .join(" ");
  await fetch(`${API_BASE_URL}/api/log-scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ Coin: coin, Time: new Date().toISOString(), User: userName }] }),
  }).catch(() => {});
}

export async function verifyAdminCode(code) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/verify-admin-code`, {
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

export async function getPcgsValue(pcgsNumber) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/pcgs-value/${pcgsNumber}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function estimateCoinValue(coinData, numistaData) {
  try {
    const text = await openaiPost([{
      role: "user",
      content: `You are an expert numismatist with deep knowledge of auction results and retail prices. Estimate this coin's current market value as you would if a collector walked in and showed it to you.

Coin data: ${JSON.stringify(coinData)}
Numista specs: ${JSON.stringify(numistaData)}

IMPORTANT: If mint_errors or varieties are present, value them accurately — mint errors can multiply base value dramatically. Reference real auction comparables where possible.

Return ONLY a raw JSON object (no markdown) with keys:
- "low": lowest realistic retail/auction value in USD (number, use face value for common coins)
- "high": highest realistic retail/auction value in USD (number)
- "condition_assumed": grade/condition you're basing this on (string)
- "error_value_note": if errors/varieties affect value, explain specifically how much they add (string, or null)
- "reasoning": 1-2 sentences citing what drives the value (string)`,
    }], 350, "gpt-4o");
    return extractJSON(text);
  } catch {
    return null;
  }
}

export async function generateSummary(coinData, numistaData, pcgsData) {
  try {
    return await openaiPost([{
      role: "user",
      content: `You are a friendly numismatist app. Write 3 exciting sentences about this coin for a beginner.
AI ID: ${JSON.stringify(coinData)}
Numista: ${JSON.stringify(numistaData)}
PCGS: ${JSON.stringify(pcgsData)}`,
    }], 200);
  } catch {
    return null;
  }
}

export async function generateEbayListing(coinData, numistaData, valueEstimate, summary) {
  try {
    const text = await openaiPost([{
      role: "user",
      content: `You are an expert eBay copywriter for collectible coins. Create a polished listing draft that would help this coin sell confidently and quickly.

Coin data: ${JSON.stringify(coinData)}
Numista specs: ${JSON.stringify(numistaData)}
Value estimate: ${JSON.stringify(valueEstimate)}
Summary: ${summary || "No summary available"}

Return ONLY a raw JSON object with these exact keys:
- "title": string
- "subtitle": string
- "description": string
- "item_specifics": array of objects with "label" and "value"
- "shipping_notes": string

Make the title concise, buyer-friendly, and search-friendly. The description should be professional, informative, and ideal for eBay. Include key identifying details and any notable condition or mint error information.`
    }], 800, "gpt-4o");
    return extractJSON(text);
  } catch {
    return null;
  }
}
