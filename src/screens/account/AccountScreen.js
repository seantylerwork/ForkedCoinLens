import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import GoldCoin from "../../components/GoldCoin";
import Header from "../../components/Header";
import styles from "../../theme/styles";
import { isAdminUser } from "../../../authLogic";
import { getMe } from "../../api/client";

const RECENT_SCANS_LIMIT = 5;

export default function AccountScreen({ navigate, user, onSignOut }) {
  const [scans, setScans] = useState([]);
  // TEMP: debug check for the Expo -> Render -> Supabase auth flow.
  const [debugResult, setDebugResult] = useState("");

  async function handleDebugMe() {
    setDebugResult("Calling /api/me...");
    try {
      const me = await getMe();
      setDebugResult(`/api/me OK\nid: ${me.id}\nemail: ${me.email}`);
    } catch (e) {
      setDebugResult(`/api/me failed: ${e.message}`);
    }
  }

  useEffect(() => {
    AsyncStorage.getItem("@coinlens_scans")
      .then(data => { if (data) setScans(JSON.parse(data)); })
      .catch(() => {});
  }, []);

  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const recentScans = scans.slice(0, RECENT_SCANS_LIMIT);

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
          <View style={isAdminUser(user) ? styles.roleBadgeAdmin : styles.roleBadgeMember}>
            <Text style={styles.roleBadgeText}>{isAdminUser(user) ? "🛡 Admin" : "Member"}</Text>
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

        <Text style={styles.sectionTitle}>Recent Scans</Text>

        {recentScans.length === 0 ? (
          <Text style={styles.searchEmpty}>No coins scanned yet.</Text>
        ) : recentScans.map((scan, i) => (
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

        {isAdminUser(user) && (
          <View style={styles.adminPanelGlow}>
            <TouchableOpacity style={styles.adminPanelBtn} onPress={() => navigate("admin")}>
              <Text style={styles.adminPanelBtnText}>🛡 Admin Panel</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TEMP debug: verify the full auth flow through the backend. */}
        <TouchableOpacity style={styles.detailedStatsBtn} onPress={handleDebugMe}>
          <Text style={styles.detailedStatsBtnText}>Debug: GET /api/me</Text>
        </TouchableOpacity>
        {debugResult ? <Text style={styles.profileEmail}>{debugResult}</Text> : null}

        <TouchableOpacity style={styles.signOutBtn} onPress={onSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
