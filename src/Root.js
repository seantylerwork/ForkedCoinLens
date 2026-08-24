import { useEffect, useState } from "react";
import { View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAdminUser } from "../authLogic";
import styles from "./theme/styles";
import AuthScreen from "./screens/auth/AuthScreen";
import HomeScreen from "./screens/home/HomeScreen";
import ScanScreen from "./screens/scan/ScanScreen";
import AdminScreen from "./screens/admin/AdminScreen";
import StatsScreen from "./screens/stats/StatsScreen";
import LeaderboardScreen from "./screens/leaderboard/LeaderboardScreen";
import AccountScreen from "./screens/account/AccountScreen";
import BadgesScreen from "./badges/BadgesScreen";

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
          setUser({ ...persistedUser, role: isAdminUser(persistedUser) ? "admin" : (persistedUser.role || "member") });
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
      role: isAdminUser(match) ? "admin" : (match.role || "member"),
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
  if (screen === "admin" && isAdminUser(user)) return <AdminScreen navigate={navigate} />;
  if (screen === "stats") return <StatsScreen navigate={navigate} />;
  return <HomeScreen navigate={navigate} />;
}
