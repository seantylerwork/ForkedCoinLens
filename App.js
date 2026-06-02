import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";

const COINS = [
  { name: "Penny", us: true, valueCents: 1, color: "copper", old: false, fact: "The Lincoln penny has been minted since 1909 and is the most produced US coin." },
  { name: "Wheat Penny", us: true, valueCents: 1, color: "copper", old: true, fact: "Wheat pennies were minted from 1909 to 1958 and are popular with collectors." },
  { name: "Nickel", us: true, valueCents: 5, color: "silver", old: false, fact: "The Jefferson nickel has featured Monticello on the reverse since 1938." },
  { name: "Dime", us: true, valueCents: 10, color: "silver", small: true, old: false, fact: "The dime is the smallest and thinnest US coin despite being worth more than a penny or nickel." },
  { name: "Quarter", us: true, valueCents: 25, color: "silver", old: false, fact: "State quarters were released from 1999 to 2008, one for each US state." },
  { name: "Half Dollar", us: true, valueCents: 50, color: "silver", old: false, fact: "The Kennedy half dollar was first issued in 1964 to honor the late president." },
  { name: "Dollar Coin", us: true, valueCents: 100, color: "gold", old: false, fact: "US dollar coins include the Sacagawea and Presidential series." },
  { name: "Canadian Loonie", us: false, color: "gold", old: false, fact: "Canada's dollar coin is nicknamed the 'Loonie' after the loon bird on its face." },
  { name: "Euro Coin", us: false, color: "silver", old: false, fact: "Euro coins have a common European side and a country-specific side." },
  { name: "British Pound Coin", us: false, color: "gold", old: false, fact: "The £1 coin has had a distinctive 12-sided shape since 2017." },
];

const QUESTIONS = [
  {
    text: "Is it a US coin?",
    filter: (coin, yes) => yes ? coin.us : !coin.us
  },
  {
    text: "Is it worth less than 25 cents?",
    filter: (coin, yes) => yes
      ? coin.valueCents != null && coin.valueCents < 25
      : coin.valueCents == null || coin.valueCents >= 25
  },
  {
    text: "Is it copper or reddish in color?",
    filter: (coin, yes) => yes ? coin.color === "copper" : coin.color !== "copper"
  },
  {
    text: "Is it an old or vintage coin (minted before 1960)?",
    filter: (coin, yes) => yes ? coin.old === true : coin.old !== true
  },
  {
    text: "Is it worth exactly 5 cents?",
    filter: (coin, yes) => yes ? coin.valueCents === 5 : coin.valueCents !== 5
  },
  {
    text: "Is it the smallest coin you have?",
    filter: (coin, yes) => yes ? coin.small === true : !coin.small
  },
  {
    text: "Is it worth exactly 25 cents?",
    filter: (coin, yes) => yes ? coin.valueCents === 25 : coin.valueCents !== 25
  },
  {
    text: "Is it worth 50 cents or more?",
    filter: (coin, yes) => yes
      ? coin.valueCents != null && coin.valueCents >= 50
      : coin.valueCents == null || coin.valueCents < 50
  },
  {
    text: "Is it gold or yellowish in color?",
    filter: (coin, yes) => yes ? coin.color === "gold" : coin.color !== "gold"
  },
  {
    text: "Is it from Canada?",
    filter: (coin, yes) => yes ? coin.name.includes("Canadian") : !coin.name.includes("Canadian")
  },
  {
    text: "Is it from Europe?",
    filter: (coin, yes) => yes ? coin.name === "Euro Coin" : coin.name !== "Euro Coin"
  },
];

export default function App() {
  const [screen, setScreen] = useState("home");
  const [remainingCoins, setRemainingCoins] = useState(COINS);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [history, setHistory] = useState([]);
  const [guess, setGuess] = useState(null);

  function startGame() {
    setScreen("playing");
    setRemainingCoins(COINS);
    setQuestionIdx(0);
    setHistory([]);
    setGuess(null);
  }

  function answer(yes) {
    const question = QUESTIONS[questionIdx];
    const filtered = remainingCoins.filter(coin => question.filter(coin, yes));
    const newHistory = [...history, { q: question.text, a: yes ? "Yes" : "No" }];
    setHistory(newHistory);

    const nextIdx = questionIdx + 1;

    if (filtered.length === 1 || nextIdx >= QUESTIONS.length || filtered.length === 0) {
      setGuess(filtered.length > 0 ? filtered[0] : remainingCoins[0]);
      setScreen("guess");
      return;
    }

    setRemainingCoins(filtered);
    setQuestionIdx(nextIdx);
  }

  if (screen === "home") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.title}>CoinLens</Text>
          <Text style={styles.subtitle}>Think of a coin and I'll try to guess it by asking yes or no questions!</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={startGame}>
            <Text style={styles.primaryBtnText}>Let's Play</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screen === "guess") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.guessLabel}>My guess is...</Text>
          <Text style={styles.guessName}>{guess?.name}!</Text>
          <Text style={styles.fact}>{guess?.fact}</Text>
          <View style={styles.historyBox}>
            {history.map((item, i) => (
              <Text key={i} style={styles.historyItem}>
                {item.q.replace("?", "")} → <Text style={styles.historyAnswer}>{item.a}</Text>
              </Text>
            ))}
          </View>
          <TouchableOpacity style={styles.primaryBtn} onPress={startGame}>
            <Text style={styles.primaryBtnText}>Play Again</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.coinIcon}>🪙</Text>
        <Text style={styles.questionCounter}>Question {history.length + 1} of {QUESTIONS.length}</Text>
        <View style={styles.questionCard}>
          <Text style={styles.question}>{QUESTIONS[questionIdx].text}</Text>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.yesBtn} onPress={() => answer(true)}>
            <Text style={styles.yesBtnText}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.noBtn} onPress={() => answer(false)}>
            <Text style={styles.noBtnText}>No</Text>
          </TouchableOpacity>
        </View>
        {history.length > 0 && (
          <View style={styles.historyBox}>
            {history.map((item, i) => (
              <Text key={i} style={styles.historyItem}>
                {item.q.replace("?", "")} → <Text style={styles.historyAnswer}>{item.a}</Text>
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#007AFF"
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28
  },
  container: {
    padding: 24,
    alignItems: "center",
    gap: 16,
    paddingBottom: 40
  },
  coinIcon: {
    fontSize: 80,
    textAlign: "center"
  },
  title: {
    fontSize: 38,
    fontWeight: "800",
    color: "#fff",
    marginTop: 8
  },
  subtitle: {
    fontSize: 17,
    color: "#cce5ff",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 24
  },
  primaryBtn: {
    marginTop: 28,
    backgroundColor: "#fff",
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 32
  },
  primaryBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#007AFF"
  },
  questionCounter: {
    fontSize: 14,
    color: "#cce5ff",
    fontWeight: "600",
    letterSpacing: 0.5
  },
  questionCard: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 20,
    padding: 24,
    width: "100%"
  },
  question: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
    lineHeight: 30
  },
  buttonRow: {
    flexDirection: "row",
    gap: 14,
    width: "100%"
  },
  yesBtn: {
    flex: 1,
    backgroundColor: "#fff",
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center"
  },
  yesBtnText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#007AFF"
  },
  noBtn: {
    flex: 1,
    borderWidth: 2,
    borderColor: "#fff",
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: "center"
  },
  noBtnText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff"
  },
  guessLabel: {
    fontSize: 18,
    color: "#cce5ff",
    fontWeight: "600"
  },
  guessName: {
    fontSize: 40,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center"
  },
  fact: {
    fontSize: 16,
    color: "#e0f0ff",
    textAlign: "center",
    fontStyle: "italic",
    lineHeight: 24,
    paddingHorizontal: 8
  },
  historyBox: {
    width: "100%",
    backgroundColor: "rgba(0,0,0,0.15)",
    borderRadius: 14,
    padding: 14,
    gap: 6
  },
  historyItem: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    lineHeight: 20
  },
  historyAnswer: {
    fontWeight: "700",
    color: "#fff"
  }
});
