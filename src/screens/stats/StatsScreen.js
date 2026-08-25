import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import styles from "../../theme/styles";

export default function StatsScreen({ navigate }) {
  const [scans, setScans] = useState([]);
  const [query, setQuery] = useState("");

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

  const filtered = query.trim()
    ? scans.filter(s => s.coin?.toLowerCase().includes(query.toLowerCase()))
    : scans;

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
            ) : filtered.map((scan, i) => (
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
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
