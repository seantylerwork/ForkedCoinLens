import { useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import styles from "../../theme/styles";

export default function StatsScreen({ navigate, userScans }) {
  const scans = userScans || [];
  const [query, setQuery] = useState("");

  const coinCounts = scans.reduce((acc, s) => {
    const key = s.coin_name || "Unknown coin";
    acc[key] = acc[key] || { count: 0, totalValue: 0 };
    acc[key].count += 1;
    acc[key].totalValue += s.estimated_value ?? 0;
    return acc;
  }, {});

  const coinList = Object.entries(coinCounts).sort((a, b) => b[1].count - a[1].count);

  // userScans is oldest-first (for badge streak logic); show newest-first here.
  const recentFirst = [...scans].reverse();
  const filtered = query.trim()
    ? recentFirst.filter(s => s.coin_name?.toLowerCase().includes(query.toLowerCase()))
    : recentFirst;

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Detailed Stats" onBack={() => navigate("account")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        {scans.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.pageSubtitle}>No scans yet. Start scanning coins!</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>By Coin Type</Text>
            {coinList.map(([coin, { count, totalValue }]) => (
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

            <Text style={styles.sectionTitle}>All Scans</Text>

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
              <Text style={styles.searchEmpty}>No coins match your search.</Text>
            ) : filtered.map((scan) => (
              <View key={scan.id} style={styles.recentItem}>
                <GoldCoin size={38} />
                <View style={styles.recentText}>
                  <Text style={styles.recentName}>{scan.coin_name}</Text>
                  <Text style={styles.recentDetail}>
                    {new Date(scan.scanned_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    {scan.estimated_value != null ? `  ·  ~$${scan.estimated_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
