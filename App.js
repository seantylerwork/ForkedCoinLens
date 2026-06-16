import { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";


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

const SA_EMAIL      = process.env.EXPO_PUBLIC_SA_EMAIL ?? "";
const SA_PRIV_KEY   = (process.env.EXPO_PUBLIC_SA_KEY ?? "").replace(/\\n/g, "\n");
const NUMISTA_API_KEY   = process.env.EXPO_PUBLIC_NUMISTA_API_KEY   ?? "";
const PCGS_BEARER_TOKEN = process.env.EXPO_PUBLIC_PCGS_BEARER_TOKEN ?? "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

let _cachedToken = null;
let _tokenExpiry = 0;

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGeminiToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && now < _tokenExpiry - 60) return _cachedToken;

  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim   = b64url(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/generative-language",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${claim}`;

  const pemBody = SA_PRIV_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  const binary = atob(pemBody);
  const keyBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8", keyBytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(input));
  const sigBytes = new Uint8Array(sigBuf);
  let sigBin = "";
  for (let i = 0; i < sigBytes.length; i++) sigBin += String.fromCharCode(sigBytes[i]);
  const jwt = `${input}.${b64url(sigBin)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(`Auth failed: ${JSON.stringify(tokenData)}`);

  _cachedToken = tokenData.access_token;
  _tokenExpiry = now + 3600;
  return _cachedToken;
}

async function geminiPost(body) {
  const token = await getGeminiToken();
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function identifyCoinFromImage(base64Image) {
  const data = await geminiPost({
    contents: [{
      parts: [
        { text: 'Analyze this coin image. Return ONLY a raw JSON object (no markdown) with keys: "country", "denomination", "year", "mint_mark", "estimated_grade". Use "Unknown" if unsure.' },
        { inline_data: { mime_type: "image/jpeg", data: base64Image } },
      ],
    }],
  });
  const text = data.candidates[0].content.parts[0].text.trim().replace(/```json|```/g, "");
  return JSON.parse(text);
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

async function getPcgsValue(pcgsNumber) {
  const res = await fetch(
    `https://api.pcgs.com/publicapi/priceguide/getpricedata/${pcgsNumber}`,
    { headers: { "Authorization": `bearer ${PCGS_BEARER_TOKEN}` } }
  );
  return res.json();
}

async function generateSummary(coinData, numistaData, pcgsData) {
  const data = await geminiPost({
    contents: [{
      parts: [{ text: `You are a friendly numismatist app. Write 3 exciting sentences about this coin for a beginner.
AI ID: ${JSON.stringify(coinData)}
Numista: ${JSON.stringify(numistaData)}
PCGS: ${JSON.stringify(pcgsData)}` }],
    }],
  });
  return data.candidates[0].content.parts[0].text.trim();
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

function ScanScreen({ navigate }) {
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
    if (!cameraRef.current || !SA_EMAIL) {
      setErrorMsg(!SA_EMAIL ? "Service account credentials missing from .env file." : "Camera not ready.");
      setPhase("error");
      return;
    }
    try {
      setPhase("loading");

      setLoadingStep("📸  Capturing image…");
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });

      setLoadingStep("🤖  AI is identifying the coin…");
      const coinData = await identifyCoinFromImage(photo.base64);

      setLoadingStep("📚  Looking up specifications…");
      const numistaData = await getNumistaSpecs(coinData);

      setLoadingStep("💰  Fetching value data…");
      const pcgsNo = numistaData?.references?.find?.(r => r.type === "PCGS")?.number;
      const pcgsData = pcgsNo ? await getPcgsValue(pcgsNo) : null;

      setLoadingStep("✍️  Generating summary…");
      const summary = await generateSummary(coinData, numistaData, pcgsData);

      setResult({ coinData, numistaData, pcgsData, summary });
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

  if (phase === "result" && result) {
    const { coinData, numistaData, pcgsData, summary } = result;
    return (
      <SafeAreaView style={styles.safeArea}>
        <Header title="Coin Identified" onBack={() => setPhase("scanning")} />
        <ScrollView contentContainerStyle={styles.resultContainer}>
          <GoldCoin size={72} />
          <Text style={styles.resultCoinName}>
            {coinData.year !== "Unknown" ? `${coinData.year} ` : ""}{coinData.country} {coinData.denomination}
          </Text>

          <View style={styles.resultCard}>
            <Text style={styles.resultCardTitle}>AI Identification</Text>
            {[["Country", coinData.country], ["Denomination", coinData.denomination],
              ["Year", coinData.year], ["Mint Mark", coinData.mint_mark],
              ["Grade", coinData.estimated_grade]].map(([label, val]) => (
              <View key={label} style={styles.resultRow}>
                <Text style={styles.resultLabel}>{label}</Text>
                <Text style={styles.resultValue}>{val || "Unknown"}</Text>
              </View>
            ))}
          </View>

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

function AccountScreen({ navigate }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Account" onBack={() => navigate("home")} />
      <View style={styles.center}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>👤</Text>
        </View>
        <Text style={styles.pageTitle}>My Account</Text>
        <Text style={styles.pageSubtitle}>Account features coming soon!</Text>
      </View>
    </SafeAreaView>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("home");

  function navigate(target) {
    setScreen(target);
  }

  if (screen === "home") return <HomeScreen navigate={navigate} />;
  if (screen === "scan") return <ScanScreen navigate={navigate} />;
  if (screen === "badges") return <PlaceholderScreen title="Badges" icon="🏅" navigate={navigate} />;
  if (screen === "leaderboard") return <PlaceholderScreen title="Leaderboard" icon="🏆" navigate={navigate} />;
  if (screen === "account") return <AccountScreen navigate={navigate} />;
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

  // Account
  avatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: GOLD_DIM,
    borderWidth: 2,
    borderColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    ...GOLD_GLOW,
  },
  avatarText: { fontSize: 48 },
});
