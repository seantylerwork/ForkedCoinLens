import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";


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
  if (screen === "scan") return <PlaceholderScreen title="Scan Coin" icon="🔍" navigate={navigate} />;
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
