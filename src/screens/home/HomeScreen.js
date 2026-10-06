import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from "react-native";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import styles from "../../theme/styles";

const RECENT_SCANS_LIMIT = 3;

export default function HomeScreen({ navigate, userScans }) {
  const cards = [
    { label: "Scan Coin", icon: "🔍", screen: "scan", desc: "Guess your coin with AI" },
    { label: "Badges", icon: "🏅", screen: "badges", desc: "View your achievements" },
    { label: "Leaderboard", icon: "🏆", screen: "leaderboard", desc: "See top collectors" },
  ];

  // userScans is oldest-first (for badge streak logic); show newest-first here.
  const recentScans = [...(userScans || [])].reverse().slice(0, RECENT_SCANS_LIMIT);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Obverse" showCoin onAccount={() => navigate("account")} />
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
        {recentScans.length === 0 ? (
          <Text style={styles.searchEmpty}>No coins scanned yet - tap Scan Coin to get started.</Text>
        ) : recentScans.map((scan) => (
          <View key={scan.id} style={styles.recentItem}>
            <GoldCoin size={40} />
            <View style={styles.recentText}>
              <Text style={styles.recentName}>{scan.coin_name}</Text>
              <Text style={styles.recentDetail}>
                {[scan.country, scan.denomination].filter(Boolean).join(" · ") || "Details unavailable"}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Reserved banner ad space - placeholder only, no ad network wired up. */}
      <View style={styles.adBanner}>
        <Text style={styles.adBannerText}>Advertisement</Text>
      </View>
    </SafeAreaView>
  );
}
