import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GOLD } from "./theme/colors";
import { isAdminUser, mapSupabaseUser, mergeProfileRole, friendlyAuthError } from "../authLogic";
import { supabase } from "./api/supabase";
import { fetchMyScans } from "./api/scans";
import { fetchMyProfile } from "./api/profile";
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

  // The authoritative scan history: read from Supabase under RLS with the
  // user's own session, never from local device storage. Oldest-first, since
  // badge streak logic (badges.js) walks scans chronologically.
  const refreshScans = useCallback(async () => {
    try {
      const rows = await fetchMyScans();
      setUserScans(rows);
    } catch {
      // RLS/network hiccups shouldn't crash the app; the user can pull to
      // retry by revisiting the screen.
    }
  }, []);

  // The role on a freshly-mapped user is always 'member' (see
  // mapSupabaseUser); this fills in the real value from the user's own
  // profiles row, which only the Supabase dashboard or the server's
  // service-role key can set to 'admin'. A failure here (RLS hiccup, no
  // network) leaves the safe 'member' default in place rather than granting
  // admin.
  const refreshUserRole = useCallback(async (userId) => {
    try {
      const profile = await fetchMyProfile();
      setUser(current => (current && current.id === userId ? mergeProfileRole(current, profile?.role) : current));
    } catch {
      // Leave the default role as-is.
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const mapped = mapSupabaseUser(data.session?.user);
      setUser(mapped);
      setAuthReady(true);
      if (data.session?.user) {
        refreshScans();
        refreshUserRole(mapped.id);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const mapped = mapSupabaseUser(session?.user);
      setUser(mapped);
      if (session?.user) {
        refreshScans();
        refreshUserRole(mapped.id);
      } else {
        setUserScans([]);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [refreshScans, refreshUserRole]);

  async function signUp(name, email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, name } },
    });
    if (error) throw new Error(friendlyAuthError(error));
    if (!data.session) {
      throw new Error("Account created. Check your email to confirm it, then sign in.");
    }
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error));
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Local session state is cleared below regardless - a thrown error
      // here (e.g. network failure invalidating the remote session) must
      // not leave Sign Out looking like it did nothing.
    }
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

  // Hold on a loading indicator while the saved Supabase session is restored so
  // the Login screen never flashes for an already-authenticated user.
  if (!authReady) {
    return (
      <View style={[styles.safeArea, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (isGuest) {
    return <ScanScreen navigate={(target) => (target === "home" ? exitGuest() : navigate(target))} user={{ name: "Guest" }} isGuest />;
  }

  if (!user) return <AuthScreen onSignIn={signIn} onSignUp={signUp} onGuest={continueAsGuest} />;

  if (screen === "home") return <HomeScreen navigate={navigate} userScans={userScans} />;
  if (screen === "scan") return <ScanScreen navigate={navigate} user={user} onScanSaved={refreshScans} />;
  if (screen === "badges") return <BadgesScreen navigate={navigate} />;
  if (screen === "leaderboard") return <LeaderboardScreen navigate={navigate} user={user} />;
  if (screen === "account") return <AccountScreen navigate={navigate} user={user} userScans={userScans} onSignOut={signOut} />;
  if (screen === "admin" && isAdminUser(user)) return <AdminScreen navigate={navigate} />;
  if (screen === "stats") return <StatsScreen key={user.id} navigate={navigate} userScans={userScans} />;
  return <HomeScreen navigate={navigate} userScans={userScans} />;
}
