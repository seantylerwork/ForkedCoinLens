import { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import aiLogic from "./aiLogic";
import { DEFAULT_ADMIN_CODE, isAdminCodeValid, isAdminUser } from "./authLogic";
import { getCaptureStageMeta } from "./scanFlowLogic";

const { extractJSON: parseJSON, getModelCandidates, isRetryableError } = aiLogic;

// ─── Confidence meter ─────────────────────────────────────────────────────────

function ConfidenceMeter({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 75 ? GOLD : pct >= 45 ? "#FFA500" : "#FF4444";
  const label = pct >= 75 ? "High Confidence" : pct >= 45 ? "Moderate" : "Low Confidence";
  return (
    <View style={styles.resultCard}>
      <Text style={styles.resultCardTitle}>AI Confidence</Text>
      <View style={styles.meterRow}>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.meterPct, { color }]}>{pct}%</Text>
      </View>
      <Text style={[styles.meterLabel, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Gold coin component ──────────────────────────────────────────────────────

function GoldCoin({ size = 80 }) {
  return (
    <View style={[styles.goldCoin, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.goldCoinText, { fontSize: size * 0.45 }]}>$</Text>
    </View>
  );
}

// ─── Shared header ────────────────────────────────────────────────────────────

function Header({ title, onBack, onAccount, showCoin }) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.headerSide}>
          <Text style={styles.backBtn}>‹ Back</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.headerSide} />
      )}
      <View style={styles.headerTitleRow}>
        {showCoin && <GoldCoin size={28} />}
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.headerSide}>
        {onAccount && (
          <TouchableOpacity onPress={onAccount} style={styles.accountBtn}>
            <Text style={styles.accountBtnText}>👤</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function AuthScreen({ onSignIn, onSignUp, onGuest }) {
  const [tab, setTab] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [showAdminField, setShowAdminField] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [offerSignUp, setOfferSignUp] = useState(false);

  function switchToSignUp() {
    setTab("signup");
    setError("");
    setOfferSignUp(false);
    setShowAdminField(false);
    setAdminCode("");
  }

  async function handleSubmit() {
    setError("");
    setOfferSignUp(false);
    setLoading(true);
    try {
      if (tab === "signup") {
        if (!name.trim()) throw new Error("Username is required.");
        if (!email.trim()) throw new Error("Email is required.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        if (adminCode && !isAdminCodeValid(adminCode, ADMIN_CODE)) throw new Error("Invalid admin code.");
        const role = isAdminCodeValid(adminCode, ADMIN_CODE) ? "admin" : "member";
        await onSignUp(name.trim(), email.trim().toLowerCase(), password, role);
      } else {
        if (!email.trim() || !password) throw new Error("Enter your email and password.");
        await onSignIn(email.trim().toLowerCase(), password);
      }
    } catch (e) {
      setError(e.message);
      if (e.message.includes("Email not found")) setOfferSignUp(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.authLogoRow}>
            <GoldCoin size={52} />
            <Text style={styles.authAppTitle}>CoinLens</Text>
          </View>

          <View style={styles.authTabRow}>
            {["signin", "signup"].map(t => (
              <TouchableOpacity key={t} style={[styles.authTab, tab === t && styles.authTabActive]} onPress={() => { setTab(t); setError(""); setShowAdminField(false); setAdminCode(""); }}>
                <Text style={[styles.authTabText, tab === t && styles.authTabTextActive]}>{t === "signin" ? "Sign In" : "Sign Up"}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.authForm}>
            {tab === "signup" && (
              <TextInput style={styles.input} placeholder="Username" placeholderTextColor="rgba(255,215,0,0.35)" value={name} onChangeText={setName} autoCapitalize="none" />
            )}
            <TextInput style={styles.input} placeholder="Email" placeholderTextColor="rgba(255,215,0,0.35)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={styles.input} placeholder="Password" placeholderTextColor="rgba(255,215,0,0.35)" value={password} onChangeText={setPassword} secureTextEntry />
            {tab === "signup" && (
              showAdminField ? (
                <TextInput style={[styles.input, styles.inputAdmin]} placeholder="Admin code" placeholderTextColor="rgba(255,165,0,0.4)" value={adminCode} onChangeText={setAdminCode} autoCapitalize="none" />
              ) : (
                <TouchableOpacity onPress={() => setShowAdminField(true)}>
                  <Text style={styles.adminCodeToggle}>Have an admin code?</Text>
                </TouchableOpacity>
              )
            )}
            {error ? <Text style={styles.authError}>{error}</Text> : null}
            {offerSignUp ? (
              <TouchableOpacity style={styles.authRecoverBtn} onPress={switchToSignUp}>
                <Text style={styles.authRecoverText}>No account found — create one with this email?</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.primaryBtnText}>{tab === "signup" ? "Create Account" : "Sign In"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.guestBtn} onPress={onGuest}>
              <Text style={styles.guestBtnText}>Use as Guest</Text>
              <Text style={styles.guestBtnSubtext}>Scan a coin without an account — everything else requires signing in.</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HomeScreen({ navigate }) {
  const cards = [
    { label: "Scan Coin", icon: "🔍", screen: "scan", desc: "Guess your coin with AI" },
    { label: "Badges", icon: "🏅", screen: "badges", desc: "View your achievements" },
    { label: "Leaderboard", icon: "🏆", screen: "leaderboard", desc: "See top collectors" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="CoinLens" showCoin onAccount={() => navigate("account")} />
      <ScrollView contentContainerStyle={styles.homeContainer}>
        <Text style={styles.homeGreeting}>What would you like to do?</Text>
        {cards.map(card => (
          <TouchableOpacity key={card.screen} style={styles.card} onPress={() => navigate(card.screen)}>
            <Text style={styles.cardIcon}>{card.icon}</Text>
            <View style={styles.cardText}>
              <Text style={styles.cardLabel}>{card.label}</Text>
              <Text style={styles.cardDesc}>{card.desc}</Text>
            </View>
            <Text style={styles.cardArrow}>›</Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.sectionTitle}>Recently Scanned Coins</Text>
        {[
          { name: "1965 Quarter", detail: "George Washington · Silver-clad" },
          { name: "1982 Penny", detail: "Abraham Lincoln · Zinc/Copper" },
          { name: "2000 Sacagawea Dollar", detail: "Sacagawea · Gold-colored" },
        ].map((coin, i) => (
          <View key={i} style={styles.recentItem}>
            <GoldCoin size={40} />
            <View style={styles.recentText}>
              <Text style={styles.recentName}>{coin.name}</Text>
              <Text style={styles.recentDetail}>{coin.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}


// ─── API config ───────────────────────────────────────────────────────────────

const OPENAI_API_KEY    = process.env.EXPO_PUBLIC_OPENAI_API_KEY   ?? "";
const NUMISTA_API_KEY   = process.env.EXPO_PUBLIC_NUMISTA_API_KEY   ?? "";
const PCGS_BEARER_TOKEN = process.env.EXPO_PUBLIC_PCGS_BEARER_TOKEN ?? "";
const SHEETDB_URL       = process.env.EXPO_PUBLIC_SHEETDB_URL       ?? "";
const ADMIN_CODE        = process.env.EXPO_PUBLIC_ADMIN_CODE        || DEFAULT_ADMIN_CODE;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

class ScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ERROR_DISPLAY = {
  network:      { icon: "📡", title: "No Internet",           tip: "Make sure WiFi or cellular data is enabled." },
  key_invalid:  { icon: "🔑", title: "Invalid API Key",       tip: "Update EXPO_PUBLIC_OPENAI_API_KEY in your .env file." },
  key_missing:  { icon: "🔑", title: "API Key Missing",       tip: "Add EXPO_PUBLIC_OPENAI_API_KEY to your .env file." },
  rate_limit:   { icon: "⏳", title: "Rate Limit Hit",         tip: "Wait 30 seconds and try again." },
  quota:        { icon: "💳", title: "Usage Limit Reached",   tip: "Check your billing at platform.openai.com." },
  server_error: { icon: "🔧", title: "OpenAI Service Issue",  tip: "OpenAI may be down. Try again in a few minutes." },
  camera:       { icon: "📷", title: "Camera Not Ready",      tip: "Wait a moment, then try again." },
  photo:        { icon: "📷", title: "Photo Capture Failed",  tip: "Make sure nothing is blocking the camera lens." },
  ai_parse:     { icon: "🤖", title: "AI Returned Bad Data",  tip: "This is rare — try scanning again." },
  ai_empty:     { icon: "🤖", title: "AI Gave No Response",   tip: "Servers may be busy. Try again in a moment." },
  unknown:      { icon: "⚠️",  title: "Something Went Wrong", tip: "Try scanning again." },
};

function makeErrorDetail(e) {
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
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
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

async function identifyCoinFromImage(base64Image) {
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

async function identifyCoinFromImages(frontBase64, backBase64) {
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

async function getNumistaSpecs(coinData) {
  try {
    const q = `${coinData.country || ""} ${coinData.denomination || ""} ${coinData.year || ""}`.trim();
    const res = await fetch(
      `https://api.numista.com/api/v3/coins?q=${encodeURIComponent(q)}&count=1`,
      { headers: { "Numista-API-Key": NUMISTA_API_KEY } }
    );
    const data = await res.json();
    return data?.items?.[0] || null;
  } catch {
    return null;
  }
}

async function logScanToSheet(coinData, userName = "") {
  const coin = [coinData.year, coinData.country, coinData.denomination]
    .filter(v => v && v !== "Unknown")
    .join(" ");
  await fetch(SHEETDB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ Coin: coin, Time: new Date().toISOString(), User: userName }] }),
  }).catch(() => {});
}

async function getPcgsValue(pcgsNumber) {
  try {
    const res = await fetch(
      `https://api.pcgs.com/publicapi/priceguide/getpricedata/${pcgsNumber}`,
      { headers: { "Authorization": `bearer ${PCGS_BEARER_TOKEN}` } }
    );
    return await res.json();
  } catch {
    return null;
  }
}

async function estimateCoinValue(coinData, numistaData) {
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

async function generateSummary(coinData, numistaData, pcgsData) {
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

async function generateEbayListing(coinData, numistaData, valueEstimate, summary) {
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

// ─── Scanner ──────────────────────────────────────────────────────────────────

function getMockScanResult() {
  const mockResults = [
    {
      coinData: {
        country: "United States",
        denomination: "Quarter Dollar",
        year: "1965",
        mint_mark: null,
        estimated_grade: "VF-30",
        mint_errors: [],
        varieties: null,
        error_premium: false,
        special_notes: "Mock result for UI testing. This is not based on the uploaded image.",
        identifiable: true,
        confidence: 84,
        alternatives: [
          { coin: "Washington Quarter", confidence: 72 },
          { coin: "Roosevelt Dime", confidence: 41 },
          { coin: "Kennedy Half Dollar", confidence: 32 },
        ],
      },
      numistaData: {
        title: "Washington Quarter",
        composition: { text: "Copper-nickel clad copper" },
        weight: 5.67,
        size: 24.3,
      },
      pcgsData: null,
      valueEstimate: {
        low: 0.25,
        high: 1.5,
        condition_assumed: "VF-30",
        error_value_note: null,
        reasoning: "This mock estimate treats the coin as a common circulated clad quarter.",
      },
      summary:
        "This looks like a common U.S. Washington quarter in circulated condition. The portrait and denomination make it a familiar everyday coin, with most value coming from condition rather than rarity. This is a temporary mock result for checking the scan result UI.",
    },
    {
      coinData: {
        country: "United States",
        denomination: "One Cent",
        year: "1982",
        mint_mark: null,
        estimated_grade: "XF-40",
        mint_errors: [],
        varieties: "Large Date / Small Date variety possible",
        error_premium: false,
        special_notes: "Mock result for UI testing. 1982 cents can vary by date style and composition.",
        identifiable: true,
        confidence: 78,
        alternatives: [
          { coin: "Lincoln Memorial Cent", confidence: 69 },
          { coin: "Wheat Cent", confidence: 28 },
          { coin: "Jefferson Nickel", confidence: 18 },
        ],
      },
      numistaData: {
        title: "Lincoln Cent",
        composition: { text: "Copper-plated zinc or bronze, depending on variety" },
        weight: 2.5,
        size: 19,
      },
      pcgsData: null,
      valueEstimate: {
        low: 0.01,
        high: 3,
        condition_assumed: "XF-40",
        error_value_note: null,
        reasoning: "This mock estimate assumes a common 1982 Lincoln cent without a rare variety.",
      },
      summary:
        "This mock match is a 1982 Lincoln cent, a transition-year penny collectors often check more closely. Some 1982 cents differ by composition and date style, which can matter for identification. This placeholder result lets you preview the UI before the API key is ready.",
    },
  ];

  return mockResults[Math.floor(Math.random() * mockResults.length)];
}

const BOX_SIZE = 260;
const BLUR_LAYERS = [
  { offset: -20, opacity: 0.05, height: 3 },
  { offset: -11, opacity: 0.18, height: 2 },
  { offset: -5,  opacity: 0.35, height: 2 },
  { offset: 5,   opacity: 0.35, height: 2 },
  { offset: 11,  opacity: 0.18, height: 2 },
  { offset: 20,  opacity: 0.05, height: 3 },
];

function ScanScreen({ navigate, user }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState("choose"); // choose | scanning | loading | result | error | unidentifiable
  const [captureStage, setCaptureStage] = useState("front");
  const [frontImage, setFrontImage] = useState(null);
  const [backImage, setBackImage] = useState(null);
  const [loadingStep, setLoadingStep] = useState("");
  const [result, setResult] = useState(null);
  const [errorDetail, setErrorDetail] = useState(null);
  const [ebayListing, setEbayListing] = useState(null);
  const [listingLoading, setListingLoading] = useState(false);
  const [listingError, setListingError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef(null);
  const autoCaptureTimerRef = useRef(null);
  const captureMeta = getCaptureStageMeta(captureStage);

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(scanAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  function startNewScan() {
    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }
    setPhase("choose");
    setCaptureStage("front");
    setFrontImage(null);
    setBackImage(null);
    setLoadingStep("");
    setErrorDetail(null);
    setCameraReady(false);
    setEbayListing(null);
    setListingError("");
    setListingLoading(false);
    setSelectedUpload(null);
  }

  async function capturePhoto() {
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.92 });
      if (!photo?.base64) throw new ScanError("photo", "Photo was captured but contained no image data. Try again.");
      return photo;
    } catch {
      throw new ScanError("photo", "Failed to take the photo. Make sure nothing is blocking the camera.");
    }
  }

  async function capture() {
    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
      autoCaptureTimerRef.current = null;
    }
    if (!cameraRef.current) {
      setErrorDetail(makeErrorDetail(new ScanError("camera", "The camera hasn't finished initializing. Wait a moment and try again.")));
      setPhase("error");
      return;
    }
    if (!OPENAI_API_KEY) {
      setPhase("loading");
      setLoadingStep("No API key found. Loading a mock scan result...");
      setTimeout(() => {
        setResult(getMockScanResult());
        setPhase("result");
      }, 1200);
      return;
    }
    try {
      setFlashActive(true);
      if (captureStage === "front") {
        setLoadingStep("📸  Capturing the front of the coin…");
        const photo = await capturePhoto();
        setFrontImage(photo.base64);
        setCaptureStage("back");
        setLoadingStep("");
        return;
      }

      if (!frontImage) {
        throw new ScanError("photo", "The front photo is missing. Please capture the front side again.");
      }

      setPhase("loading");
      setLoadingStep("📸  Capturing the back of the coin…");
      const photo = await capturePhoto();
      setBackImage(photo.base64);

      setLoadingStep("🤖  AI is identifying the coin from both sides…");
      const coinData = await identifyCoinFromImages(frontImage, photo.base64);

      if (coinData.identifiable === false) {
        setErrorDetail({ icon: "🔍", title: "Coin Not Recognized", body: coinData.unidentifiable_reason || "The AI couldn't identify this coin.", tip: null });
        setPhase("unidentifiable");
        return;
      }

      setLoadingStep("📚  Looking up specifications…");
      const numistaData = await getNumistaSpecs(coinData);

      setLoadingStep("💰  Estimating value…");
      const pcgsNo = numistaData?.references?.find?.(r => r.type === "PCGS")?.number;
      const pcgsData = pcgsNo ? await getPcgsValue(pcgsNo) : null;
      const valueEstimate = await estimateCoinValue(coinData, numistaData);

      setLoadingStep("✍️  Generating summary…");
      const summary = await generateSummary(coinData, numistaData, pcgsData);

      logScanToSheet(coinData, user?.name);
      const coinLabel = [coinData.year, coinData.country, coinData.denomination].filter(v => v && v !== "Unknown").join(" ");
      try {
        const stored = await AsyncStorage.getItem("@coinlens_scans");
        const history = stored ? JSON.parse(stored) : [];
        const midValue = valueEstimate ? ((valueEstimate.low ?? 0) + (valueEstimate.high ?? 0)) / 2 : 0;
        history.unshift({ coin: coinLabel, time: new Date().toISOString(), value: midValue });
        await AsyncStorage.setItem("@coinlens_scans", JSON.stringify(history.slice(0, 50)));
      } catch { /* storage failure shouldn't block showing results */ }
      setEbayListing(null);
      setListingError("");
      setResult({ coinData, numistaData, pcgsData, valueEstimate, summary });
      setPhase("result");
    } catch (e) {
      setErrorDetail(makeErrorDetail(e));
      setPhase("error");
    }
  }

  useEffect(() => {
    if (!flashActive) return undefined;
    flashAnim.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    animation.start(() => setFlashActive(false));
    return () => animation.stop();
  }, [flashActive, flashAnim]);

  useEffect(() => {
    if (phase !== "scanning" || !permission?.granted || !cameraReady) return undefined;

    if (autoCaptureTimerRef.current) {
      clearTimeout(autoCaptureTimerRef.current);
    }

    autoCaptureTimerRef.current = setTimeout(() => {
      if (cameraRef.current) {
        void capture();
      }
    }, captureMeta.autoCaptureDelayMs);

    return () => {
      if (autoCaptureTimerRef.current) {
        clearTimeout(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [cameraReady, captureMeta.autoCaptureDelayMs, captureStage, permission?.granted, phase]);

  async function uploadPhoto() {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!permissionResult.granted) {
      setErrorDetail(makeErrorDetail(new ScanError(
        "permission",
        permissionResult.canAskAgain
          ? "Photo access is needed to upload a coin image. Tap Upload Photo again to retry."
          : "Photo access is blocked. Enable Photos access for CoinLens in your device settings."
      )));
      setPhase("error");
      return;
    }

    const photo = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      base64: true,
      quality: 0.92,
    });

    if (photo.canceled || !photo.assets?.[0]?.base64) {
      return;
    }

    setSelectedUpload(photo.assets[0]);
  }

  async function startUploadedPhotoScan() {
    if (!selectedUpload?.base64) {
      setErrorDetail(makeErrorDetail(new ScanError("photo", "Choose a photo before starting the scan.")));
      setPhase("error");
      return;
    }

    if (!OPENAI_API_KEY) {
      setPhase("loading");
      setLoadingStep("No API key found. Loading a mock scan result...");
      setTimeout(() => {
        setResult(getMockScanResult());
        setPhase("result");
      }, 1200);
      return;
    }

    try {
      setPhase("loading");

      setLoadingStep("Preparing uploaded photo...");
      setLoadingStep("AI is identifying the coin...");
      const coinData = await identifyCoinFromImage(selectedUpload.base64);

      if (coinData.identifiable === false) {
        setErrorDetail(makeErrorDetail(new ScanError("unidentifiable", coinData.unidentifiable_reason || "Could not identify this coin.")));
        setPhase("unidentifiable");
        return;
      }

      setLoadingStep("Looking up specifications...");
      const numistaData = await getNumistaSpecs(coinData);

      setLoadingStep("Estimating value...");
      const pcgsNo = numistaData?.references?.find?.(r => r.type === "PCGS")?.number;
      const pcgsData = pcgsNo ? await getPcgsValue(pcgsNo) : null;
      const valueEstimate = await estimateCoinValue(coinData, numistaData);

      setLoadingStep("Generating summary...");
      const summary = await generateSummary(coinData, numistaData, pcgsData);

      logScanToSheet(coinData, user?.name);
      const coinLabel = [coinData.year, coinData.country, coinData.denomination].filter(v => v && v !== "Unknown").join(" ");
      AsyncStorage.getItem("@coinlens_scans").then(data => {
        const history = data ? JSON.parse(data) : [];
        const midValue = valueEstimate ? ((valueEstimate.low ?? 0) + (valueEstimate.high ?? 0)) / 2 : 0;
        history.unshift({ coin: coinLabel, time: new Date().toISOString(), value: midValue });
        AsyncStorage.setItem("@coinlens_scans", JSON.stringify(history.slice(0, 50)));
      });
      setResult({ coinData, numistaData, pcgsData, valueEstimate, summary });
      setPhase("result");
    } catch (e) {
      setErrorDetail(makeErrorDetail(e));
      setPhase("error");
    }
  }

  if (phase === "choose") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <ScrollView contentContainerStyle={styles.scanChoiceContainer}>
          <GoldCoin size={88} />
          <Text style={styles.pageTitle}>Scan Coin</Text>
          <Text style={styles.pageSubtitle}>Choose how you want to add a coin photo.</Text>

          <View style={styles.scanChoiceOptions}>
            <TouchableOpacity style={styles.scanChoiceCard} onPress={uploadPhoto}>
              <Text style={styles.scanChoiceIcon}>+</Text>
              <View style={styles.cardText}>
                <Text style={styles.cardLabel}>Upload Photo</Text>
                <Text style={styles.cardDesc}>Pick an existing coin photo</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </TouchableOpacity>

            {selectedUpload ? (
              <View style={styles.uploadPreviewCard}>
                <Text style={styles.resultCardTitle}>Selected Photo</Text>
                <View style={styles.uploadPreviewFrame}>
                  <Image source={{ uri: selectedUpload.uri }} style={styles.uploadPreviewImage} />
                </View>
                <View style={styles.uploadPreviewActions}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={uploadPhoto}>
                    <Text style={styles.secondaryBtnText}>Choose Different</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.previewScanBtn} onPress={startUploadedPhotoScan}>
                    <Text style={styles.previewScanBtnText}>Start Scan</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <TouchableOpacity style={styles.scanChoiceCard} onPress={() => { setCaptureStage("front"); setFrontImage(null); setBackImage(null); setPhase("scanning"); }}>
              <Text style={styles.scanChoiceIcon}>[]</Text>
              <View style={styles.cardText}>
                <Text style={styles.cardLabel}>Take Photo</Text>
                <Text style={styles.cardDesc}>Use your camera for a new scan</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (phase === "scanning" && !permission) return <View style={styles.safeArea} />;

  if (phase === "scanning" && !permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => setPhase("choose")} />
        <View style={styles.center}>
          <GoldCoin size={80} />
          <Text style={styles.pageTitle}>Camera Access</Text>
          <Text style={styles.pageSubtitle}>Camera access is needed to scan your coins.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "loading") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => setPhase("choose")} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingStep}>{loadingStep}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "error") {
    const ed = errorDetail ?? { icon: "⚠️", title: "Something Went Wrong", body: "An unexpected error occurred.", tip: "Try scanning again." };
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>{ed.icon}</Text>
          <Text style={styles.pageTitle}>{ed.title}</Text>
          <Text style={styles.errorBody}>{ed.body}</Text>
          {ed.tip ? (
            <View style={styles.errorTipBox}>
              <Text style={styles.errorTipLabel}>💡 What to do</Text>
              <Text style={styles.errorTipText}>{ed.tip}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "unidentifiable") {
    const ed = errorDetail ?? { icon: "🔍", title: "Coin Not Recognized", body: "The AI couldn't identify this coin.", tip: null };
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>{ed.icon}</Text>
          <Text style={styles.pageTitle}>{ed.title}</Text>
          <Text style={styles.errorBody}>{ed.body}</Text>
          <View style={styles.unidentifiableTips}>
            <Text style={styles.tipsTitle}>Tips for a better scan</Text>
            {["Place the coin on a flat, dark surface", "Use good lighting — avoid glare", "Hold the camera steady and close", "Make sure the full coin is in frame"].map((tip, i) => (
              <Text key={i} style={styles.tipItem}>• {tip}</Text>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  async function handleCreateEbayListing() {
    if (!result) return;
    if (!OPENAI_API_KEY) {
      setListingError("OpenAI API key is not configured.");
      return;
    }

    setListingLoading(true);
    setListingError("");
    try {
      const { coinData, numistaData, valueEstimate, summary } = result;
      const listing = await generateEbayListing(coinData, numistaData, valueEstimate, summary);
      if (!listing) throw new Error("Unable to generate the listing draft right now.");
      setEbayListing(listing);
    } catch (err) {
      setListingError(err.message || "Unable to create the listing draft.");
    } finally {
      setListingLoading(false);
    }
  }

  if (phase === "result" && result) {
    const { coinData, numistaData, pcgsData, valueEstimate, summary } = result;
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Coin Identified" onBack={startNewScan} />
        <ScrollView contentContainerStyle={styles.resultContainer}>
          <GoldCoin size={72} />
          <Text style={styles.resultCoinName}>
            {coinData.year !== "Unknown" ? `${coinData.year} ` : ""}{coinData.country} {coinData.denomination}
          </Text>

          <ConfidenceMeter value={coinData.confidence} />

          {Array.isArray(coinData.alternatives) && coinData.alternatives.length > 0 && (
            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>Could Also Be</Text>
              {coinData.alternatives.map((alt, i) => (
                <View key={i} style={styles.altRow}>
                  <View style={styles.altInfo}>
                    <Text style={styles.altCoin}>{alt.coin}</Text>
                    <View style={styles.altBarTrack}>
                      <View style={[styles.altBarFill, { width: `${alt.confidence}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.altPct}>{alt.confidence}%</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>AI Identification</Text>
            {[["Country", coinData.country], ["Denomination", coinData.denomination],
              ["Year", coinData.year], ["Mint Mark", coinData.mint_mark],
              ["Grade", coinData.estimated_grade],
              ["Varieties", coinData.varieties]].map(([label, val]) =>
              val && val !== "Unknown" ? (
                <View key={label} style={styles.resultRow}>
                  <Text style={styles.resultLabel}>{label}</Text>
                  <Text style={styles.resultValue}>{val}</Text>
                </View>
              ) : null
            )}
            {coinData.special_notes ? (
              <Text style={[styles.resultSummary, { marginTop: 4 }]}>{coinData.special_notes}</Text>
            ) : null}
          </View>

          {coinData.mint_errors?.length > 0 && (
            <View style={[styles.resultCard, styles.errorCard]}>
              <Text style={[styles.resultCardTitle, { color: "#FF6B35" }]}>⚠ Mint Errors Detected</Text>
              {coinData.mint_errors.map((err, i) => (
                <View key={i} style={styles.errorRow}>
                  <Text style={styles.errorBullet}>•</Text>
                  <Text style={styles.errorText}>{err}</Text>
                </View>
              ))}
            </View>
          )}

          {numistaData && !numistaData.error && (
            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>Numista Specs</Text>
              {[["Title", numistaData.title], ["Composition", numistaData.composition?.text],
                ["Weight", numistaData.weight ? `${numistaData.weight}g` : null],
                ["Diameter", numistaData.size ? `${numistaData.size}mm` : null]].map(([label, val]) =>
                val ? (
                  <View key={label} style={styles.resultRow}>
                    <Text style={styles.resultLabel}>{label}</Text>
                    <Text style={styles.resultValue}>{val}</Text>
                  </View>
                ) : null
              )}
            </View>
          )}

          {valueEstimate && (
            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>AI Value Estimate</Text>
              <View style={styles.valueRangeRow}>
                <View style={styles.valueBox}>
                  <Text style={styles.valueBoxLabel}>Low</Text>
                  <Text style={styles.valueBoxAmount}>${valueEstimate.low?.toLocaleString() ?? "—"}</Text>
                </View>
                <Text style={styles.valueDash}>—</Text>
                <View style={styles.valueBox}>
                  <Text style={styles.valueBoxLabel}>High</Text>
                  <Text style={styles.valueBoxAmount}>${valueEstimate.high?.toLocaleString() ?? "—"}</Text>
                </View>
              </View>
              {valueEstimate.condition_assumed ? (
                <View style={styles.resultRow}>
                  <Text style={styles.resultLabel}>Condition assumed</Text>
                  <Text style={styles.resultValue}>{valueEstimate.condition_assumed}</Text>
                </View>
              ) : null}
              {valueEstimate.error_value_note ? (
                <Text style={[styles.resultSummary, { color: "#FF6B35", fontWeight: "700" }]}>⚠ {valueEstimate.error_value_note}</Text>
              ) : null}
              {valueEstimate.reasoning ? (
                <Text style={styles.resultSummary}>{valueEstimate.reasoning}</Text>
              ) : null}
            </View>
          )}

          {pcgsData && !pcgsData.error && (
            <View style={styles.resultCard}>
              <Text style={styles.resultCardTitle}>PCGS Value</Text>
              {[["Grade", pcgsData.grade], ["Price", pcgsData.price ? `$${pcgsData.price}` : null],
                ["Designation", pcgsData.designation]].map(([label, val]) =>
                val ? (
                  <View key={label} style={styles.resultRow}>
                    <Text style={styles.resultLabel}>{label}</Text>
                    <Text style={styles.resultValue}>{val}</Text>
                  </View>
                ) : null
              )}
            </View>
          )}

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>Summary</Text>
            <Text style={styles.resultSummary}>{summary}</Text>
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>eBay Listing Draft</Text>
            {ebayListing ? (
              <>
                <Text style={styles.resultSummary}><Text style={styles.resultLabel}>Title: </Text>{ebayListing.title}</Text>
                {ebayListing.subtitle ? <Text style={styles.resultSummary}><Text style={styles.resultLabel}>Subtitle: </Text>{ebayListing.subtitle}</Text> : null}
                {ebayListing.description ? <Text style={styles.resultSummary}>{ebayListing.description}</Text> : null}
                {Array.isArray(ebayListing.item_specifics) && ebayListing.item_specifics.length > 0 ? (
                  <View style={styles.listingSpecList}>
                    {ebayListing.item_specifics.map((spec, i) => (
                      <View key={`${spec.label}-${i}`} style={styles.listingSpecRow}>
                        <Text style={styles.resultLabel}>{spec.label}</Text>
                        <Text style={styles.resultValue}>{spec.value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {ebayListing.shipping_notes ? <Text style={styles.resultSummary}>Shipping notes: {ebayListing.shipping_notes}</Text> : null}
              </>
            ) : (
              <Text style={styles.resultSummary}>Create a polished eBay title, description, item specifics, and shipping notes for this coin.</Text>
            )}
            {listingError ? <Text style={styles.authError}>{listingError}</Text> : null}
            <TouchableOpacity style={[styles.secondaryBtn, listingLoading && styles.secondaryBtnDisabled]} onPress={handleCreateEbayListing} disabled={listingLoading}>
              {listingLoading ? <ActivityIndicator color="#000" /> : <Text style={styles.secondaryBtnText}>{ebayListing ? "Refresh eBay Listing" : "Create Ideal eBay Listing"}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={startNewScan}>
            <Text style={styles.primaryBtnText}>Scan Another</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Scanning view ──
  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Scan Coin" onBack={() => navigate("home")} />
      <View style={styles.scannerOuter}>
        <View style={styles.scannerBoxWrapper}>
          <View style={styles.scannerBox}>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraReady(true)} />
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {BLUR_LAYERS.map(({ offset, opacity, height }, i) => (
              <Animated.View key={i} style={{
                position: "absolute", left: 0, right: 0, height,
                backgroundColor: GOLD, opacity,
                transform: [{ translateY: scanAnim.interpolate({
                  inputRange: [0, 1], outputRange: [offset, BOX_SIZE - 3 + offset],
                })}],
              }} />
            ))}
            <Animated.View style={[styles.scanLineSolid, {
              position: "absolute", left: 0, right: 0,
              transform: [{ translateY: scanAnim.interpolate({
                inputRange: [0, 1], outputRange: [0, BOX_SIZE - 3],
              })}],
            }]} />
          </View>
        </View>
        <Text style={styles.scanHint}>{captureMeta.title}</Text>
        <Text style={styles.scanSubHint}>{captureMeta.body}</Text>
        <Animated.View style={[
          styles.captureIndicator,
          flashActive && {
            transform: [{ scale: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
            backgroundColor: flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,215,0,0.08)", GOLD] }),
            borderColor: flashAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(255,215,0,0.25)", "#fff6b0"] }),
          },
        ]} />
      </View>
    </SafeAreaView>
  );
}

function AdminScreen({ navigate }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        let rows = [];
        try {
          const response = await fetch(SHEETDB_URL);
          const data = await response.json();
          rows = Array.isArray(data) ? data.filter(r => r.Coin) : [];
        } catch {
          rows = [];
        }

        const stored = await AsyncStorage.getItem("@coinlens_scans");
        const localScans = stored ? JSON.parse(stored) : [];
        const normalizedLocal = localScans.map((scan, index) => ({
          Coin: scan.coin || `Scan ${index + 1}`,
          Time: scan.time,
          User: scan.user || "Local User",
          Value: scan.value,
        }));

        const mergedRows = [...rows, ...normalizedLocal];
        setScans(mergedRows);
      } catch {
        setError("Failed to load data.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const byUser = scans.reduce((acc, scan) => {
    const u = scan.User?.trim() || scan.user?.trim() || "Anonymous";
    if (!acc[u]) acc[u] = [];
    acc[u].push(scan);
    return acc;
  }, {});

  const userList = Object.entries(byUser).sort((a, b) => b[1].length - a[1].length);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Admin Panel" onBack={() => navigate("account")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        <View style={styles.adminBadge}>
          <Text style={styles.adminBadgeText}>🛡 Administrator</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{scans.length}</Text>
            <Text style={styles.statLabel}>Total{"\n"}Scans</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{userList.length}</Text>
            <Text style={styles.statLabel}>Unique{"\n"}Users</Text>
          </View>
        </View>

        {loading && <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />}
        {error ? <Text style={styles.authError}>{error}</Text> : null}

        {userList.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Users</Text>
            {userList.map(([userName, userScans]) => (
              <View key={userName} style={styles.adminUserCard}>
                <View style={styles.adminUserHeader}>
                  <View style={styles.adminUserAvatar}>
                    <Text style={styles.adminUserAvatarText}>{userName[0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adminUserName}>{userName}</Text>
                    <Text style={styles.adminUserCount}>{userScans.length} coin{userScans.length !== 1 ? "s" : ""} scanned</Text>
                  </View>
                </View>
                {userScans.slice(0, 3).map((s, i) => (
                  <View key={i} style={styles.adminScanRow}>
                    <Text style={styles.adminScanCoin}>{s.Coin}</Text>
                    <Text style={styles.adminScanTime}>{s.Time ? new Date(s.Time).toLocaleDateString() : ""}</Text>
                  </View>
                ))}
                {userScans.length > 3 && (
                  <Text style={styles.adminMore}>+{userScans.length - 3} more</Text>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatsScreen({ navigate }) {
  const [scans, setScans] = useState([]);

  useEffect(() => {
    AsyncStorage.getItem("@coinlens_scans")
      .then(data => { if (data) setScans(JSON.parse(data)); })
      .catch(() => {});
  }, []);

  const coinCounts = scans.reduce((acc, s) => {
    acc[s.coin] = (acc[s.coin] || { count: 0, totalValue: 0 });
    acc[s.coin].count += 1;
    acc[s.coin].totalValue += s.value ?? 0;
    return acc;
  }, {});

  const coinList = Object.entries(coinCounts).sort((a, b) => b[1].count - a[1].count);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Detailed Stats" onBack={() => navigate("account")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        {coinList.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.pageSubtitle}>No scans yet. Start scanning coins!</Text>
          </View>
        ) : coinList.map(([coin, { count, totalValue }]) => (
          <View key={coin} style={styles.statCoinRow}>
            <GoldCoin size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statCoinName}>{coin}</Text>
              <Text style={styles.statCoinSub}>
                {count}× scanned · est. ${(totalValue / count).toLocaleString(undefined, { maximumFractionDigits: 2 })} avg
              </Text>
            </View>
            <View style={styles.statCoinBadge}>
              <Text style={styles.statCoinBadgeText}>{count}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function _fakeBadges({ scanned, netWorth, memberDays }) {
  const scanTiers  = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const worthTiers = [1, 10, 50, 100, 500, 1000, 10000, 25000, 100000, 500000, 1000000];
  const dayTiers   = [0, 7, 30, 180, 365, 730, 1825];
  return (
    scanTiers.filter(t => scanned >= t).length +
    worthTiers.filter(t => netWorth >= t).length +
    dayTiers.filter(t => memberDays >= t).length
  );
}

const FAKE_USERS = [
  { name: "CoinKing99",    scanned: 312, netWorth: 4820,  memberDays: 841  },
  { name: "SilverHunter",  scanned: 274, netWorth: 11340, memberDays: 612  },
  { name: "MintErrorMike", scanned: 198, netWorth: 28900, memberDays: 390  },
  { name: "PennyCollector",scanned: 165, netWorth: 390,   memberDays: 1204 },
  { name: "AncientRome",   scanned: 143, netWorth: 7650,  memberDays: 520  },
  { name: "QuarterQueen",  scanned: 121, netWorth: 1120,  memberDays: 278  },
  { name: "BuffaloNickel", scanned: 97,  netWorth: 3200,  memberDays: 730  },
  { name: "GoldEagleFan",  scanned: 84,  netWorth: 52000, memberDays: 95   },
  { name: "WheatBackWill", scanned: 61,  netWorth: 940,   memberDays: 1560 },
  { name: "NewCollector",  scanned: 12,  netWorth: 85,    memberDays: 8    },
].map(u => ({ ...u, badges: _fakeBadges(u) }));

const LB_CATEGORIES = [
  { key: "scanned",    label: "Most Scanned",  field: "scanned",    format: v => `${v} coins`   },
  { key: "netWorth",   label: "Net Worth",     field: "netWorth",   format: v => `$${v.toLocaleString()}` },
  { key: "memberDays", label: "Longest Member",field: "memberDays", format: v => `${v} days`    },
  { key: "badges",     label: "Most Badges",   field: "badges",     format: v => `${v} badges`  },
];

function LeaderboardScreen({ navigate, user, userScans }) {
  const [cat, setCat] = useState("scanned");
  const [liveUsers, setLiveUsers] = useState(FAKE_USERS.map(u => ({ ...u })));
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [flashedName, setFlashedName] = useState(null);
  const category = LB_CATEGORIES.find(c => c.key === cat);

  useEffect(() => {
    function tick() {
      setLiveUsers(prev => {
        const next = prev.map(u => ({ ...u }));
        const count = Math.random() < 0.4 ? 2 : 1;
        const picked = [];
        while (picked.length < count) {
          const idx = Math.floor(Math.random() * next.length);
          if (!picked.includes(idx)) picked.push(idx);
        }
        picked.forEach(idx => {
          if (Math.random() < 0.7) next[idx].scanned += 1;
          next[idx].netWorth += Math.floor(Math.random() * 120);
        });
        setFlashedName(next[picked[0]].name);
        setTimeout(() => setFlashedName(null), 800);
        return next;
      });
      setLastUpdated(new Date());
    }

    const id = setInterval(tick, 7000 + Math.random() * 5000);
    return () => clearInterval(id);
  }, []);

  const myDays = user.createdAt
    ? Math.max(1, Math.floor((Date.now() - user.createdAt) / 86400000))
    : 1;

  const myEntry = {
    name: user.name,
    scanned: userScans.length,
    netWorth: userScans.reduce((s, c) => s + (c.value ?? 0), 0),
    memberDays: myDays,
    badges: BADGES.filter(b => b.check(userScans, user)).length,
    isMe: true,
  };

  const all = [...liveUsers.map(u => ({ ...u, isMe: false })), myEntry]
    .sort((a, b) => b[category.field] - a[category.field])
    .map((u, i) => ({ ...u, rank: i + 1 }));

  const medals = ["🥇", "🥈", "🥉"];
  const updatedStr = lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Leaderboard" onBack={() => navigate("home")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        <View style={styles.lbLiveRow}>
          <View style={styles.lbLiveDot} />
          <Text style={styles.lbLiveText}>LIVE</Text>
          <Text style={styles.lbUpdatedText}>  Updated {updatedStr}</Text>
        </View>

        <View style={styles.lbCatRow}>
          {LB_CATEGORIES.map(c => (
            <TouchableOpacity key={c.key} style={[styles.lbCatBtn, cat === c.key && styles.lbCatBtnActive]} onPress={() => setCat(c.key)}>
              <Text style={[styles.lbCatText, cat === c.key && styles.lbCatTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {all.map((entry) => (
          <View key={entry.name} style={[styles.lbRow, entry.isMe && styles.lbRowMe, flashedName === entry.name && styles.lbRowFlash]}>
            <Text style={styles.lbRank}>
              {entry.rank <= 3 ? medals[entry.rank - 1] : `#${entry.rank}`}
            </Text>
            <View style={styles.lbInfo}>
              <Text style={[styles.lbName, entry.isMe && styles.lbNameMe]}>
                {entry.name}{entry.isMe ? "  (you)" : ""}
              </Text>
              <Text style={styles.lbSub}>{category.format(entry[category.field])}</Text>
            </View>
            <View style={[styles.lbBadge, entry.rank === 1 && styles.lbBadgeGold]}>
              <Text style={[styles.lbBadgeText, entry.rank === 1 && styles.lbBadgeTextGold]}>
                {category.format(entry[category.field])}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function _nw(scans) { return scans.reduce((s, c) => s + (c.value ?? 0), 0); }
function _days(createdAt) { return Math.floor((Date.now() - createdAt) / 86400000); }

const BADGES = [
  // — Scanning milestones
  { id: "scan_1",     icon: "🔍", name: "First Scan",           desc: "Scan your very first coin",          category: "Scanning",  check: (s) => s.length >= 1     },
  { id: "scan_10",    icon: "🔟", name: "Getting Started",      desc: "Scan 10 coins",                      category: "Scanning",  check: (s) => s.length >= 10    },
  { id: "scan_25",    icon: "⭐", name: "Coin Enthusiast",      desc: "Scan 25 coins",                      category: "Scanning",  check: (s) => s.length >= 25    },
  { id: "scan_50",    icon: "🏆", name: "Half Century",         desc: "Scan 50 coins",                      category: "Scanning",  check: (s) => s.length >= 50    },
  { id: "scan_100",   icon: "💯", name: "Century Club",         desc: "Scan 100 coins",                     category: "Scanning",  check: (s) => s.length >= 100   },
  { id: "scan_250",   icon: "🚀", name: "Dedicated Collector",  desc: "Scan 250 coins",                     category: "Scanning",  check: (s) => s.length >= 250   },
  { id: "scan_500",   icon: "👑", name: "Master Scanner",       desc: "Scan 500 coins",                     category: "Scanning",  check: (s) => s.length >= 500   },
  { id: "scan_1000",  icon: "🔱", name: "Elite Collector",      desc: "Scan 1,000 coins",                   category: "Scanning",  check: (s) => s.length >= 1000  },
  { id: "scan_2500",  icon: "🌌", name: "Numismatic Legend",    desc: "Scan 2,500 coins",                   category: "Scanning",  check: (s) => s.length >= 2500  },
  { id: "scan_5000",  icon: "⚡", name: "Coin Overlord",        desc: "Scan 5,000 coins",                   category: "Scanning",  check: (s) => s.length >= 5000  },
  { id: "scan_10000", icon: "🌠", name: "The Archivist",        desc: "Scan 10,000 coins",                  category: "Scanning",  check: (s) => s.length >= 10000 },
  // — Net worth milestones
  { id: "worth_1",      icon: "💰", name: "First Dollar",       desc: "Reach $1 in collection value",       category: "Net Worth", check: (s) => _nw(s) >= 1       },
  { id: "worth_10",     icon: "💵", name: "Growing Stack",      desc: "Reach $10 in collection value",      category: "Net Worth", check: (s) => _nw(s) >= 10      },
  { id: "worth_50",     icon: "💸", name: "Rising Value",       desc: "Reach $50 in collection value",      category: "Net Worth", check: (s) => _nw(s) >= 50      },
  { id: "worth_100",    icon: "🤑", name: "Century Mark",       desc: "Reach $100 in collection value",     category: "Net Worth", check: (s) => _nw(s) >= 100     },
  { id: "worth_500",    icon: "💎", name: "Five Hundred",       desc: "Reach $500 in collection value",     category: "Net Worth", check: (s) => _nw(s) >= 500     },
  { id: "worth_1000",   icon: "🏦", name: "Four Figures",       desc: "Reach $1,000 in collection value",   category: "Net Worth", check: (s) => _nw(s) >= 1000    },
  { id: "worth_10000",  icon: "🌟", name: "High Roller",        desc: "Reach $10,000 in collection value",  category: "Net Worth", check: (s) => _nw(s) >= 10000   },
  { id: "worth_25000",  icon: "🔥", name: "Quarter Million",    desc: "Reach $25,000 in collection value",  category: "Net Worth", check: (s) => _nw(s) >= 25000   },
  { id: "worth_100000", icon: "🏅", name: "Six Figures",        desc: "Reach $100,000 in collection value", category: "Net Worth", check: (s) => _nw(s) >= 100000  },
  { id: "worth_500000", icon: "🦅", name: "Half Million",       desc: "Reach $500,000 in collection value", category: "Net Worth", check: (s) => _nw(s) >= 500000  },
  { id: "worth_1m",     icon: "👁️", name: "The Million",        desc: "Reach $1,000,000 in collection value",category:"Net Worth", check: (s) => _nw(s) >= 1000000 },
  // — Membership milestones
  { id: "mem_join", icon: "👋", name: "Welcome",                desc: "Join CoinLens",                      category: "Member",    check: (s, u) => !!u.createdAt                             },
  { id: "mem_7",    icon: "📅", name: "One Week",               desc: "Be a member for 7 days",             category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 7    },
  { id: "mem_30",   icon: "📆", name: "One Month",              desc: "Be a member for 30 days",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 30   },
  { id: "mem_180",  icon: "🗓️", name: "Half Year",              desc: "Be a member for 180 days",           category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 180  },
  { id: "mem_365",  icon: "🎂", name: "Veteran",                desc: "Be a member for 1 year",             category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 365  },
  { id: "mem_730",  icon: "🏛️", name: "Pillar of the Community",desc: "Be a member for 2 years",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 730  },
  { id: "mem_1825", icon: "🌐", name: "Living Legend",          desc: "Be a member for 5 years",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 1825 },
];

const BADGE_CATEGORIES = ["Scanning", "Net Worth", "Member"];

function BadgesScreen({ navigate, user, userScans }) {
  const earned = new Set(BADGES.filter(b => b.check(userScans, user)).map(b => b.id));
  const earnedCount = earned.size;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Badges" onBack={() => navigate("home")} />
      <ScrollView contentContainerStyle={styles.badgesScroll}>
        <View style={styles.badgesProgressRow}>
          <Text style={styles.badgesProgressText}>{earnedCount} / {BADGES.length} earned</Text>
          <View style={styles.badgesProgressTrack}>
            <View style={[styles.badgesProgressFill, { width: `${(earnedCount / BADGES.length) * 100}%` }]} />
          </View>
        </View>

        {BADGE_CATEGORIES.map(cat => {
          const group = BADGES.filter(b => b.category === cat);
          return (
            <View key={cat} style={styles.badgesCatSection}>
              <Text style={styles.badgesCatTitle}>{cat}</Text>
              <View style={styles.badgesGrid}>
                {group.map(badge => {
                  const isEarned = earned.has(badge.id);
                  return (
                    <View key={badge.id} style={[styles.badgeCard, isEarned && styles.badgeCardEarned]}>
                      <Text style={[styles.badgeCardIcon, !isEarned && styles.badgeCardIconLocked]}>
                        {isEarned ? badge.icon : "🔒"}
                      </Text>
                      <Text style={[styles.badgeCardName, !isEarned && styles.badgeCardNameLocked]}>
                        {badge.name}
                      </Text>
                      <Text style={styles.badgeCardDesc}>{badge.desc}</Text>
                      {isEarned
                        ? <Text style={styles.badgeEarnedTag}>✓ Earned</Text>
                        : <Text style={styles.badgeLockedTag}>Locked</Text>}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlaceholderScreen({ title, icon, navigate }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title={title} onBack={() => navigate("home")} />
      <View style={styles.center}>
        <GoldCoin size={80} />
        <Text style={styles.pageTitle}>{title}</Text>
        <Text style={styles.pageSubtitle}>Coming soon!</Text>
      </View>
    </SafeAreaView>
  );
}

function AccountScreen({ navigate, user, onSignOut }) {
  const [scans, setScans] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    AsyncStorage.getItem("@coinlens_scans")
      .then(data => { if (data) setScans(JSON.parse(data)); })
      .catch(() => {});
  }, []);

  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const filtered = query.trim()
    ? scans.filter(s => s.coin?.toLowerCase().includes(query.toLowerCase()))
    : scans;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Account" onBack={() => navigate("home")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        <View style={styles.profileSection}>
          <View style={[styles.avatarCircle, styles.avatarCircleLarge]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <View style={isAdminUser(user, ADMIN_CODE) ? styles.roleBadgeAdmin : styles.roleBadgeMember}>
            <Text style={styles.roleBadgeText}>{isAdminUser(user, ADMIN_CODE) ? "🛡 Admin" : "Member"}</Text>
          </View>
        </View>

        {(() => {
          const netWorth = scans.reduce((sum, s) => sum + (s.value ?? 0), 0);
          const timeLabel = (() => {
            if (!user.createdAt) return "New";
            const days = Math.floor((Date.now() - user.createdAt) / 86400000);
            if (days < 1) return "Today";
            if (days < 30) return `${days}d`;
            if (days < 365) return `${Math.floor(days / 30)}mo`;
            return `${Math.floor(days / 365)}yr`;
          })();
          return (
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{scans.length}</Text>
                <Text style={styles.statLabel}>Coins Scanned</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>{timeLabel}</Text>
                <Text style={styles.statLabel}>Time as Member</Text>
              </View>
              <View style={[styles.statBox, styles.statBoxWide]}>
                <Text style={styles.statNumber}>${netWorth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</Text>
                <Text style={styles.statLabel}>Est. Net Worth</Text>
              </View>
            </View>
          );
        })()}

        <TouchableOpacity style={styles.detailedStatsBtn} onPress={() => navigate("stats")}>
          <Text style={styles.detailedStatsBtnText}>Detailed Stats →</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Scanned Coins</Text>

        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search your coins…"
            placeholderTextColor="rgba(255,215,0,0.3)"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {filtered.length === 0 ? (
          <Text style={styles.searchEmpty}>
            {scans.length === 0 ? "No coins scanned yet." : "No coins match your search."}
          </Text>
        ) : filtered.slice(0, 50).map((scan, i) => (
          <View key={i} style={styles.recentItem}>
            <GoldCoin size={38} />
            <View style={styles.recentText}>
              <Text style={styles.recentName}>{scan.coin}</Text>
              <Text style={styles.recentDetail}>
                {new Date(scan.time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                {scan.value ? `  ·  ~$${scan.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}
              </Text>
            </View>
          </View>
        ))}

        {isAdminUser(user, ADMIN_CODE) && (
          <View style={styles.adminPanelGlow}>
            <TouchableOpacity style={styles.adminPanelBtn} onPress={() => navigate("admin")}>
              <Text style={styles.adminPanelBtnText}>🛡 Admin Panel</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("home");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [userScans, setUserScans] = useState([]);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const session = await AsyncStorage.getItem("@coinlens_session");
        if (session) {
          const persistedUser = JSON.parse(session);
          setUser({ ...persistedUser, role: isAdminUser(persistedUser, ADMIN_CODE) ? "admin" : (persistedUser.role || "member") });
        }
      } catch { /* corrupted session — stay logged out */ }
      setAuthReady(true);
    })();
    AsyncStorage.getItem("@coinlens_scans")
      .then(data => { if (data) setUserScans(JSON.parse(data)); })
      .catch(() => {});
  }, []);

  async function getAccounts() {
    try {
      const data = await AsyncStorage.getItem("@coinlens_accounts");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  async function saveAccounts(accounts) {
    try {
      await AsyncStorage.setItem("@coinlens_accounts", JSON.stringify(accounts));
    } catch {
      throw new Error("Failed to save account. Storage may be full.");
    }
  }

  async function signUp(name, email, password, role = "member") {
    const accounts = await getAccounts();
    if (accounts.find(a => a.email === email)) throw new Error("An account with this email already exists.");
    const userData = { name, email, password, role, createdAt: Date.now() };
    await saveAccounts([...accounts, userData]);
    await AsyncStorage.setItem("@coinlens_session", JSON.stringify(userData));
    setUser(userData);
  }

  async function signIn(email, password) {
    const accounts = await getAccounts();
    const match = accounts.find(a => a.email === email);
    if (!match) throw new Error("Email not found. Please sign up first.");
    if (match.password !== password) throw new Error("Wrong password.");
    const normalizedUser = {
      ...match,
      role: isAdminUser(match, ADMIN_CODE) ? "admin" : (match.role || "member"),
    };
    await AsyncStorage.setItem("@coinlens_session", JSON.stringify(normalizedUser));
    setUser(normalizedUser);
  }

  async function signOut() {
    await AsyncStorage.removeItem("@coinlens_session");
    setUser(null);
    setScreen("home");
  }

  function continueAsGuest() {
    setIsGuest(true);
    setScreen("scan");
  }

  function exitGuest() {
    setIsGuest(false);
    setScreen("home");
  }

  function navigate(target) { setScreen(target); }

  if (!authReady) return <View style={styles.safeArea} />;

  if (isGuest) {
    return <ScanScreen navigate={(target) => (target === "home" ? exitGuest() : navigate(target))} user={{ name: "Guest" }} />;
  }

  if (!user) return <AuthScreen onSignIn={signIn} onSignUp={signUp} onGuest={continueAsGuest} />;

  if (screen === "home") return <HomeScreen navigate={navigate} />;
  if (screen === "scan") return <ScanScreen navigate={navigate} user={user} />;
  if (screen === "badges") return <BadgesScreen navigate={navigate} user={user} userScans={userScans} />;
  if (screen === "leaderboard") return <LeaderboardScreen navigate={navigate} user={user} userScans={userScans} />;
  if (screen === "account") return <AccountScreen navigate={navigate} user={user} onSignOut={signOut} />;
  if (screen === "admin" && isAdminUser(user, ADMIN_CODE)) return <AdminScreen navigate={navigate} />;
  if (screen === "stats") return <StatsScreen navigate={navigate} />;
  return <HomeScreen navigate={navigate} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GOLD = "#FFD700";
const GOLD_DIM = "rgba(255,215,0,0.15)";
const GOLD_GLOW = {
  shadowColor: GOLD,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.75,
  shadowRadius: 12,
  elevation: 10,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  container: { padding: 24, alignItems: "center", gap: 16, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,215,0,0.2)"
  },
  headerSide: { width: 72 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: GOLD, textAlign: "center" },
  backBtn: { fontSize: 17, color: GOLD, fontWeight: "600" },
  accountBtn: {
    alignSelf: "flex-end",
    backgroundColor: GOLD_DIM,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: GOLD,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    ...GOLD_GLOW,
  },
  accountBtnText: { fontSize: 20 },

  // Home
  homeContainer: { padding: 24, gap: 16, paddingBottom: 40 },
  homeGreeting: { fontSize: 22, fontWeight: "700", color: GOLD, marginBottom: 4 },
  card: {
    backgroundColor: "#0f0f0f",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.4)",
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    ...GOLD_GLOW,
  },
  cardIcon: { fontSize: 36 },
  cardText: { flex: 1 },
  cardLabel: { fontSize: 20, fontWeight: "700", color: GOLD },
  cardDesc: { fontSize: 14, color: "rgba(255,215,0,0.6)", marginTop: 2 },
  cardArrow: { fontSize: 28, color: "rgba(255,215,0,0.4)", fontWeight: "300" },

  // Scan choice
  scanChoiceContainer: {
    flexGrow: 1,
    alignItems: "center",
    padding: 24,
    paddingTop: 44,
    paddingBottom: 40,
  },
  scanChoiceOptions: {
    width: "100%",
    maxWidth: 440,
    gap: 16,
    marginTop: 32,
  },
  scanChoiceCard: {
    backgroundColor: "#0f0f0f",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.4)",
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    ...GOLD_GLOW,
  },
  scanChoiceIcon: {
    width: 42,
    fontSize: 32,
    color: GOLD,
    fontWeight: "800",
    textAlign: "center",
  },
  uploadPreviewCard: {
    backgroundColor: "#0f0f0f",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.3)",
    padding: 16,
    gap: 12,
  },
  uploadPreviewFrame: {
    height: 220,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.25)",
    backgroundColor: "#050505",
    overflow: "hidden",
  },
  uploadPreviewImage: {
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  uploadPreviewActions: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: "rgba(255,215,0,0.8)",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  previewScanBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    ...GOLD_GLOW,
  },
  previewScanBtnText: {
    color: "#000",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },

  // Scanner
  scannerOuter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 28 },
  scannerBoxWrapper: {
    borderRadius: 12,
    ...GOLD_GLOW,
  },
  scannerBox: {
    width: BOX_SIZE,
    height: BOX_SIZE,
    borderRadius: 12,
    overflow: "hidden",
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 8,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanLineSolid: {
    height: 3,
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  scanHint: { fontSize: 15, color: "rgba(255,215,0,0.8)", fontWeight: "600", textAlign: "center" },
  scanSubHint: { fontSize: 13, color: "rgba(255,255,255,0.7)", textAlign: "center", lineHeight: 20, maxWidth: 300, marginTop: -8 },
  captureIndicator: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: "rgba(255,215,0,0.25)",
    backgroundColor: "rgba(255,215,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
    ...GOLD_GLOW,
  },

  // Loading / error
  loadingStep: { marginTop: 20, fontSize: 16, color: GOLD, fontWeight: "600", textAlign: "center" },
  errorIcon: { fontSize: 60, marginBottom: 8 },
  errorBody: { fontSize: 14, color: "rgba(255,255,255,0.6)", textAlign: "center", marginHorizontal: 24, marginTop: 6, lineHeight: 20 },
  errorTipBox: { marginTop: 18, marginHorizontal: 24, backgroundColor: "rgba(255,215,0,0.07)", borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", borderRadius: 10, padding: 14, width: "90%" },
  errorTipLabel: { fontSize: 11, fontWeight: "800", color: GOLD, letterSpacing: 0.8, marginBottom: 4 },
  errorTipText: { fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 18 },

  // Result
  resultContainer: { padding: 20, alignItems: "center", gap: 16, paddingBottom: 40 },
  resultCoinName: { fontSize: 22, fontWeight: "800", color: GOLD, textAlign: "center" },
  resultCard: {
    width: "100%", backgroundColor: "#0f0f0f",
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,215,0,0.3)",
    padding: 16, gap: 10,
  },
  resultCardTitle: { fontSize: 13, fontWeight: "700", color: "rgba(255,215,0,0.5)", letterSpacing: 1, textTransform: "uppercase" },
  resultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  resultLabel: { fontSize: 14, color: "rgba(255,215,0,0.6)" },
  resultValue: { fontSize: 14, fontWeight: "700", color: GOLD, flexShrink: 1, textAlign: "right", marginLeft: 8 },
  resultSummary: { fontSize: 15, color: "rgba(255,215,0,0.85)", lineHeight: 22 },
  altRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  altInfo: { flex: 1, gap: 4 },
  altCoin: { fontSize: 13, color: "rgba(255,215,0,0.8)", fontWeight: "600" },
  altBarTrack: { height: 5, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" },
  altBarFill: { height: "100%", backgroundColor: "rgba(255,215,0,0.4)", borderRadius: 3 },
  altPct: { fontSize: 13, fontWeight: "700", color: "rgba(255,215,0,0.6)", width: 38, textAlign: "right" },
  unidentifiableTips: { width: "100%", backgroundColor: "#0f0f0f", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", padding: 16, gap: 8, marginTop: 20, marginBottom: 4 },
  tipsTitle: { fontSize: 13, fontWeight: "700", color: "rgba(255,215,0,0.5)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  tipItem: { fontSize: 14, color: "rgba(255,215,0,0.75)", lineHeight: 22 },
  errorCard: { borderColor: "rgba(255,107,53,0.5)", backgroundColor: "rgba(255,107,53,0.06)" },
  errorRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  errorBullet: { color: "#FF6B35", fontSize: 16, lineHeight: 22 },
  errorText: { flex: 1, color: "#FF6B35", fontSize: 14, lineHeight: 22, fontWeight: "600" },
  valueRangeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, marginVertical: 10 },
  valueBox: { alignItems: "center", backgroundColor: "rgba(255,215,0,0.08)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,215,0,0.25)", paddingHorizontal: 20, paddingVertical: 10 },
  valueBoxLabel: { fontSize: 11, color: "rgba(255,215,0,0.5)", fontWeight: "600", letterSpacing: 1, textTransform: "uppercase" },
  valueBoxAmount: { fontSize: 24, fontWeight: "800", color: GOLD, marginTop: 2 },
  valueDash: { fontSize: 20, color: "rgba(255,215,0,0.4)", fontWeight: "300" },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  meterTrack: { flex: 1, height: 10, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 5, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 5 },
  meterPct: { fontSize: 15, fontWeight: "700", width: 42, textAlign: "right" },
  meterLabel: { fontSize: 12, fontWeight: "600", marginTop: 4, letterSpacing: 0.5 },

  // Recently scanned
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "rgba(255,215,0,0.5)", letterSpacing: 1, marginTop: 8 },
  recentItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#0f0f0f",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.2)",
    padding: 12,
  },
  recentText: { flex: 1 },
  recentName: { fontSize: 16, fontWeight: "700", color: GOLD },
  recentDetail: { fontSize: 13, color: "rgba(255,215,0,0.5)", marginTop: 2 },

  // Shared
  bigIcon: { fontSize: 80, textAlign: "center" },
  pageTitle: { fontSize: 32, fontWeight: "800", color: GOLD, marginTop: 8 },
  pageSubtitle: { fontSize: 17, color: "rgba(255,215,0,0.7)", textAlign: "center", marginTop: 10, lineHeight: 24 },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: GOLD,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 32,
    ...GOLD_GLOW,
  },
  primaryBtnText: { fontSize: 18, fontWeight: "700", color: "#000" },
  secondaryBtn: {
    marginTop: 12,
    backgroundColor: "rgba(255,215,0,0.12)",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.35)",
  },
  secondaryBtnDisabled: { opacity: 0.7 },
  secondaryBtnText: { fontSize: 15, fontWeight: "700", color: GOLD, textAlign: "center" },
  listingSpecList: { gap: 6, marginTop: 4 },
  listingSpecRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },

  // Gold coin
  goldCoin: {
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 16,
    borderWidth: 3,
    borderColor: "#FFF8DC",
  },
  goldCoinText: {
    fontWeight: "900",
    color: "#7A5C00",
  },

  // Auth
  authContainer: { flexGrow: 1, padding: 28, justifyContent: "center", gap: 24 },
  authLogoRow: { alignItems: "center", gap: 12 },
  authAppTitle: { fontSize: 32, fontWeight: "900", color: GOLD },
  authTabRow: { flexDirection: "row", backgroundColor: "#111", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", overflow: "hidden" },
  authTab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  authTabActive: { backgroundColor: GOLD_DIM, ...GOLD_GLOW },
  authTabText: { fontSize: 15, fontWeight: "600", color: "rgba(255,215,0,0.4)" },
  authTabTextActive: { color: GOLD },
  authForm: { gap: 14 },
  input: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,215,0,0.3)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: GOLD,
  },
  authError: { fontSize: 14, color: "#FF4444", textAlign: "center" },
  authRecoverBtn: { backgroundColor: "rgba(255,215,0,0.1)", borderWidth: 1, borderColor: "rgba(255,215,0,0.3)", borderRadius: 10, padding: 12, alignItems: "center" },
  authRecoverText: { fontSize: 13, color: GOLD, fontWeight: "600", textAlign: "center" },
  guestBtn: { marginTop: 16, alignItems: "center", padding: 8 },
  guestBtnText: { fontSize: 14, color: "rgba(255,215,0,0.7)", fontWeight: "600", textDecorationLine: "underline" },
  guestBtnSubtext: { fontSize: 11, color: "rgba(255,215,0,0.35)", textAlign: "center", marginTop: 4, paddingHorizontal: 16 },

  // Account
  accountContainer: { padding: 24, gap: 16, paddingBottom: 40 },
  profileSection: { alignItems: "center", gap: 8, paddingVertical: 8 },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: GOLD_DIM,
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    ...GOLD_GLOW,
  },
  avatarCircleLarge: { width: 90, height: 90, borderRadius: 45 },
  avatarInitials: { fontSize: 32, fontWeight: "800", color: GOLD },
  avatarText: { fontSize: 40 },
  profileName: { fontSize: 24, fontWeight: "800", color: GOLD },
  profileEmail: { fontSize: 14, color: "rgba(255,215,0,0.5)" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statBox: {
    flex: 1, minWidth: "45%", alignItems: "center",
    backgroundColor: "#0f0f0f", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.2)",
    padding: 14,
  },
  statBoxWide: { minWidth: "100%", flex: undefined, width: "100%" },
  statNumber: { fontSize: 28, fontWeight: "900", color: GOLD },
  statLabel: { fontSize: 11, color: "rgba(255,215,0,0.45)", textAlign: "center", marginTop: 4, letterSpacing: 0.5 },
  detailedStatsBtn: {
    backgroundColor: "#0f0f0f", borderWidth: 1, borderColor: "rgba(255,215,0,0.3)", borderRadius: 12,
    paddingVertical: 12, alignItems: "center", ...GOLD_GLOW,
  },
  detailedStatsBtnText: { fontSize: 14, fontWeight: "700", color: "rgba(255,215,0,0.7)" },
  statCoinRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#0f0f0f", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.15)", padding: 12,
  },
  statCoinName: { fontSize: 15, fontWeight: "700", color: GOLD },
  statCoinSub: { fontSize: 12, color: "rgba(255,215,0,0.5)", marginTop: 2 },
  statCoinBadge: { backgroundColor: GOLD_DIM, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(255,215,0,0.3)" },
  statCoinBadgeText: { fontSize: 14, fontWeight: "800", color: GOLD },
  signOutBtn: {
    marginTop: 8, borderWidth: 1, borderColor: "rgba(255,215,0,0.3)",
    borderRadius: 32, paddingVertical: 14, alignItems: "center", ...GOLD_GLOW,
  },
  signOutText: { fontSize: 16, fontWeight: "700", color: "rgba(255,215,0,0.6)" },

  // Badges screen
  badgesScroll: { padding: 20, paddingBottom: 40 },
  badgesProgressRow: { marginBottom: 24 },
  badgesProgressText: { fontSize: 13, color: GOLD, fontWeight: "700", marginBottom: 8, textAlign: "center" },
  badgesProgressTrack: { height: 6, backgroundColor: "rgba(255,215,0,0.15)", borderRadius: 3, overflow: "hidden" },
  badgesProgressFill: { height: 6, backgroundColor: GOLD, borderRadius: 3 },
  badgesCatSection: { marginBottom: 28 },
  badgesCatTitle: { fontSize: 13, fontWeight: "900", color: GOLD, letterSpacing: 1.2, marginBottom: 12, textTransform: "uppercase" },
  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badgeCard: {
    width: "47%", backgroundColor: "rgba(255,215,0,0.04)", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.12)",
    padding: 14, alignItems: "center",
  },
  badgeCardEarned: {
    backgroundColor: "rgba(255,215,0,0.09)", borderColor: GOLD,
    shadowColor: GOLD, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
  },
  badgeCardIcon: { fontSize: 34, marginBottom: 6 },
  badgeCardIconLocked: { opacity: 0.35 },
  badgeCardName: { fontSize: 13, fontWeight: "800", color: "#fff", textAlign: "center", marginBottom: 3 },
  badgeCardNameLocked: { color: "rgba(255,255,255,0.35)" },
  badgeCardDesc: { fontSize: 11, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 15, marginBottom: 8 },
  badgeEarnedTag: { fontSize: 11, fontWeight: "800", color: GOLD },
  badgeLockedTag: { fontSize: 11, color: "rgba(255,255,255,0.25)" },

  // Role badges
  roleBadgeAdmin: { marginTop: 4, backgroundColor: "rgba(255,165,0,0.15)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,165,0,0.5)", paddingHorizontal: 14, paddingVertical: 4 },
  roleBadgeMember: { marginTop: 4, backgroundColor: "rgba(255,215,0,0.08)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", paddingHorizontal: 14, paddingVertical: 4 },
  roleBadgeText: { fontSize: 12, fontWeight: "700", color: GOLD, letterSpacing: 0.5 },

  // Admin panel button on account screen
  lbCatRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  lbCatBtn: {
    width: "48%", paddingVertical: 9, alignItems: "center", borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", backgroundColor: "#0f0f0f",
  },
  lbCatBtnActive: { backgroundColor: GOLD_DIM, borderColor: GOLD, ...GOLD_GLOW },
  lbCatText: { fontSize: 11, fontWeight: "600", color: "rgba(255,215,0,0.4)", textAlign: "center" },
  lbCatTextActive: { color: GOLD },
  lbRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#0f0f0f", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.15)", padding: 14,
  },
  lbRowMe: { borderColor: GOLD, backgroundColor: "rgba(255,215,0,0.06)", ...GOLD_GLOW },
  lbRank: { fontSize: 18, fontWeight: "800", color: GOLD, width: 36, textAlign: "center" },
  lbInfo: { flex: 1 },
  lbName: { fontSize: 15, fontWeight: "700", color: "rgba(255,215,0,0.8)" },
  lbNameMe: { color: GOLD },
  lbSub: { fontSize: 12, color: "rgba(255,215,0,0.45)", marginTop: 2 },
  lbBadge: { backgroundColor: "rgba(255,215,0,0.1)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(255,215,0,0.25)" },
  lbBadgeGold: { backgroundColor: GOLD_DIM, borderColor: GOLD },
  lbBadgeText: { fontSize: 14, fontWeight: "800", color: "rgba(255,215,0,0.6)" },
  lbBadgeTextGold: { color: GOLD },
  lbRowFlash: { backgroundColor: "rgba(255,215,0,0.12)", borderColor: GOLD },
  lbLiveRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  lbLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#00e676", marginRight: 6 },
  lbLiveText: { fontSize: 11, fontWeight: "900", color: "#00e676", letterSpacing: 1.5 },
  lbUpdatedText: { fontSize: 11, color: "rgba(255,215,0,0.45)" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#111", borderWidth: 1, borderColor: "rgba(255,215,0,0.25)",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    ...GOLD_GLOW,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 15, color: GOLD },
  searchClear: { fontSize: 14, color: "rgba(255,215,0,0.4)", paddingLeft: 4 },
  searchEmpty: { fontSize: 14, color: "rgba(255,215,0,0.4)", textAlign: "center", marginTop: 8 },
  adminPanelGlow: {
    borderRadius: 16,
    backgroundColor: "#1a0f00",
    shadowColor: "#FFA500", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 12, elevation: 10,
  },
  adminPanelBtn: {
    backgroundColor: "rgba(255,165,0,0.12)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,165,0,0.5)",
    paddingVertical: 14, alignItems: "center",
  },
  adminPanelBtnText: { fontSize: 16, fontWeight: "700", color: "#FFA500" },

  // Auth extras
  inputAdmin: { borderColor: "rgba(255,165,0,0.5)" },
  adminCodeToggle: { fontSize: 13, color: "rgba(255,215,0,0.4)", textAlign: "center", textDecorationLine: "underline" },

  // Admin screen
  adminBadge: { alignSelf: "center", backgroundColor: "rgba(255,165,0,0.12)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,165,0,0.5)", paddingHorizontal: 18, paddingVertical: 6 },
  adminBadgeText: { fontSize: 13, fontWeight: "700", color: "#FFA500", letterSpacing: 0.5 },
  adminUserCard: {
    backgroundColor: "#0f0f0f", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,215,0,0.2)",
    padding: 14, gap: 8,
  },
  adminUserHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  adminUserAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: GOLD_DIM, borderWidth: 1, borderColor: GOLD, alignItems: "center", justifyContent: "center" },
  adminUserAvatarText: { fontSize: 18, fontWeight: "800", color: GOLD },
  adminUserName: { fontSize: 16, fontWeight: "700", color: GOLD },
  adminUserCount: { fontSize: 12, color: "rgba(255,215,0,0.5)", marginTop: 2 },
  adminScanRow: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 4 },
  adminScanCoin: { fontSize: 13, color: "rgba(255,215,0,0.7)", flex: 1 },
  adminScanTime: { fontSize: 12, color: "rgba(255,215,0,0.4)" },
  adminMore: { fontSize: 12, color: "rgba(255,215,0,0.35)", paddingLeft: 4 },
});
