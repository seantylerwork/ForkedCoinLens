import { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
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
import AsyncStorage from "@react-native-async-storage/async-storage";


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

function AuthScreen({ onSignIn, onSignUp }) {
  const [tab, setTab] = useState("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [showAdminField, setShowAdminField] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      if (tab === "signup") {
        if (!name.trim()) throw new Error("Username is required.");
        if (!email.trim()) throw new Error("Email is required.");
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        if (adminCode && adminCode !== ADMIN_CODE) throw new Error("Invalid admin code.");
        const role = adminCode === ADMIN_CODE ? "admin" : "member";
        await onSignUp(name.trim(), email.trim().toLowerCase(), password, role);
      } else {
        if (!email.trim() || !password) throw new Error("Enter your email and password.");
        await onSignIn(email.trim().toLowerCase(), password);
      }
    } catch (e) {
      setError(e.message);
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
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmit} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.primaryBtnText}>{tab === "signup" ? "Create Account" : "Sign In"}</Text>}
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

const OPENAI_API_KEY    = process.env.EXPO_PUBLIC_OPENAI_API_KEY    ?? "";
const NUMISTA_API_KEY   = process.env.EXPO_PUBLIC_NUMISTA_API_KEY   ?? "";
const PCGS_BEARER_TOKEN = process.env.EXPO_PUBLIC_PCGS_BEARER_TOKEN ?? "";
const SHEETDB_URL       = process.env.EXPO_PUBLIC_SHEETDB_URL       ?? "";
const ADMIN_CODE        = process.env.EXPO_PUBLIC_ADMIN_CODE        ?? "";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI response had no JSON:\n${text.slice(0, 300)}`);
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error(`JSON parse failed:\n${match[0].slice(0, 300)}`);
  }
}

async function openaiPost(messages, maxTokens = 400, model = "gpt-4o-mini") {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content.trim();
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

async function getNumistaSpecs(coinData) {
  const q = `${coinData.country || ""} ${coinData.denomination || ""} ${coinData.year || ""}`.trim();
  const res = await fetch(
    `https://api.numista.com/api/v3/coins?q=${encodeURIComponent(q)}&count=1`,
    { headers: { "Numista-API-Key": NUMISTA_API_KEY } }
  );
  const data = await res.json();
  return data?.items?.[0] || null;
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
  const res = await fetch(
    `https://api.pcgs.com/publicapi/priceguide/getpricedata/${pcgsNumber}`,
    { headers: { "Authorization": `bearer ${PCGS_BEARER_TOKEN}` } }
  );
  return res.json();
}

async function estimateCoinValue(coinData, numistaData) {
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
}

async function generateSummary(coinData, numistaData, pcgsData) {
  return openaiPost([{
    role: "user",
    content: `You are a friendly numismatist app. Write 3 exciting sentences about this coin for a beginner.
AI ID: ${JSON.stringify(coinData)}
Numista: ${JSON.stringify(numistaData)}
PCGS: ${JSON.stringify(pcgsData)}`,
  }], 200);
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

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
  const [phase, setPhase] = useState("scanning"); // scanning | loading | result | error
  const [loadingStep, setLoadingStep] = useState("");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const scanAnim = useRef(new Animated.Value(0)).current;
  const cameraRef = useRef(null);

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

  async function capture() {
    if (!cameraRef.current || !OPENAI_API_KEY) {
      setErrorMsg(!OPENAI_API_KEY ? "Add your OpenAI API key to the .env file." : "Camera not ready.");
      setPhase("error");
      return;
    }
    try {
      setPhase("loading");

      setLoadingStep("📸  Capturing image…");
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.92 });

      setLoadingStep("🤖  AI is identifying the coin…");
      const coinData = await identifyCoinFromImage(photo.base64);

      if (coinData.identifiable === false) {
        setErrorMsg(coinData.unidentifiable_reason || "Could not identify this coin.");
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
      AsyncStorage.getItem("@coinlens_scans").then(data => {
        const history = data ? JSON.parse(data) : [];
        const midValue = valueEstimate ? ((valueEstimate.low ?? 0) + (valueEstimate.high ?? 0)) / 2 : 0;
        history.unshift({ coin: coinLabel, time: new Date().toISOString(), value: midValue });
        AsyncStorage.setItem("@coinlens_scans", JSON.stringify(history.slice(0, 50)));
      });
      setResult({ coinData, numistaData, pcgsData, valueEstimate, summary });
      setPhase("result");
    } catch (e) {
      setErrorMsg(e.message || "Something went wrong.");
      setPhase("error");
    }
  }

  if (!permission) return <View style={styles.safeArea} />;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
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
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={styles.loadingStep}>{loadingStep}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "error") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.pageTitle}>Oops</Text>
          <Text style={styles.pageSubtitle}>{errorMsg}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase("scanning")}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "unidentifiable") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Scan Coin" onBack={() => navigate("home")} />
        <View style={styles.center}>
          <Text style={styles.errorIcon}>🔍</Text>
          <Text style={styles.pageTitle}>Coin Not Recognized</Text>
          <Text style={styles.pageSubtitle}>{errorMsg}</Text>
          <View style={styles.unidentifiableTips}>
            <Text style={styles.tipsTitle}>Tips for a better scan</Text>
            {["Place the coin on a flat, dark surface", "Use good lighting — avoid glare", "Hold the camera steady and close", "Make sure the full coin is in frame"].map((tip, i) => (
              <Text key={i} style={styles.tipItem}>• {tip}</Text>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase("scanning")}>
            <Text style={styles.primaryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "result" && result) {
    const { coinData, numistaData, pcgsData, valueEstimate, summary } = result;
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Coin Identified" onBack={() => setPhase("scanning")} />
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

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setPhase("scanning")}>
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
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
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
        <Text style={styles.scanHint}>Scan the front and back of the coin</Text>
        <TouchableOpacity style={styles.captureBtn} onPress={capture}>
          <View style={styles.captureBtnInner} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function AdminScreen({ navigate }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(SHEETDB_URL)
      .then(r => r.json())
      .then(data => {
        const rows = Array.isArray(data) ? data.filter(r => r.Coin) : [];
        setScans(rows);
      })
      .catch(() => setError("Failed to load data."))
      .finally(() => setLoading(false));
  }, []);

  const byUser = scans.reduce((acc, scan) => {
    const u = scan.User?.trim() || "Anonymous";
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
    AsyncStorage.getItem("@coinlens_scans").then(data => {
      if (data) setScans(JSON.parse(data));
    });
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
    AsyncStorage.getItem("@coinlens_scans").then(data => {
      if (data) setScans(JSON.parse(data));
    });
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
          <View style={user.role === "admin" ? styles.roleBadgeAdmin : styles.roleBadgeMember}>
            <Text style={styles.roleBadgeText}>{user.role === "admin" ? "🛡 Admin" : "Member"}</Text>
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

        {user.role === "admin" && (
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

  useEffect(() => {
    AsyncStorage.getItem("@coinlens_session").then(data => {
      if (data) setUser(JSON.parse(data));
      setAuthReady(true);
    });
  }, []);

  async function getAccounts() {
    const data = await AsyncStorage.getItem("@coinlens_accounts");
    return data ? JSON.parse(data) : [];
  }

  async function saveAccounts(accounts) {
    await AsyncStorage.setItem("@coinlens_accounts", JSON.stringify(accounts));
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
    await AsyncStorage.setItem("@coinlens_session", JSON.stringify(match));
    setUser(match);
  }

  async function signOut() {
    await AsyncStorage.removeItem("@coinlens_session");
    setUser(null);
    setScreen("home");
  }

  function navigate(target) { setScreen(target); }

  if (!authReady) return <View style={styles.safeArea} />;
  if (!user) return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;

  if (screen === "home") return <HomeScreen navigate={navigate} />;
  if (screen === "scan") return <ScanScreen navigate={navigate} user={user} />;
  if (screen === "badges") return <PlaceholderScreen title="Badges" icon="🏅" navigate={navigate} />;
  if (screen === "leaderboard") return <PlaceholderScreen title="Leaderboard" icon="🏆" navigate={navigate} />;
  if (screen === "account") return <AccountScreen navigate={navigate} user={user} onSignOut={signOut} />;
  if (screen === "admin" && user.role === "admin") return <AdminScreen navigate={navigate} />;
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
  captureBtn: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, borderColor: GOLD,
    alignItems: "center", justifyContent: "center",
    ...GOLD_GLOW,
  },
  captureBtnInner: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: GOLD,
  },

  // Loading / error
  loadingStep: { marginTop: 20, fontSize: 16, color: GOLD, fontWeight: "600", textAlign: "center" },
  errorIcon: { fontSize: 60, marginBottom: 8 },

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

  // Role badges
  roleBadgeAdmin: { marginTop: 4, backgroundColor: "rgba(255,165,0,0.15)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,165,0,0.5)", paddingHorizontal: 14, paddingVertical: 4 },
  roleBadgeMember: { marginTop: 4, backgroundColor: "rgba(255,215,0,0.08)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,215,0,0.2)", paddingHorizontal: 14, paddingVertical: 4 },
  roleBadgeText: { fontSize: 12, fontWeight: "700", color: GOLD, letterSpacing: 0.5 },

  // Admin panel button on account screen
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
