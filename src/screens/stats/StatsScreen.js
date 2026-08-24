import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import styles from "../../theme/styles";

export default function StatsScreen({ navigate }) {
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
