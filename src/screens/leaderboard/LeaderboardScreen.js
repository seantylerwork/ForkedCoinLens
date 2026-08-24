import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TouchableOpacity, View } from "react-native";
import Header from "../../components/Header";
import styles from "../../theme/styles";
import { BADGES } from "../../badges/badges";

function _fakeBadges({ scanned, netWorth, memberDays }) {
  const scanTiers  = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const worthTiers = [1, 10, 50, 100, 500, 1000, 10000, 25000, 100000, 500000, 1000000];
  const dayTiers   = [0, 7, 30, 180, 365, 730, 1825];
  return (
    scanTiers.filter(t => scanned >= t).length +
    worthTiers.filter(t => netWorth >= t).length +
    dayTiers.filter(t => memberDays >= t).length
  );
}

const FAKE_USERS = [
  { name: "CoinKing99",    scanned: 312, netWorth: 4820,  memberDays: 841  },
  { name: "SilverHunter",  scanned: 274, netWorth: 11340, memberDays: 612  },
  { name: "MintErrorMike", scanned: 198, netWorth: 28900, memberDays: 390  },
  { name: "PennyCollector",scanned: 165, netWorth: 390,   memberDays: 1204 },
  { name: "AncientRome",   scanned: 143, netWorth: 7650,  memberDays: 520  },
  { name: "QuarterQueen",  scanned: 121, netWorth: 1120,  memberDays: 278  },
  { name: "BuffaloNickel", scanned: 97,  netWorth: 3200,  memberDays: 730  },
  { name: "GoldEagleFan",  scanned: 84,  netWorth: 52000, memberDays: 95   },
  { name: "WheatBackWill", scanned: 61,  netWorth: 940,   memberDays: 1560 },
  { name: "NewCollector",  scanned: 12,  netWorth: 85,    memberDays: 8    },
].map(u => ({ ...u, badges: _fakeBadges(u) }));

const LB_CATEGORIES = [
  { key: "scanned",    label: "Most Scanned",  field: "scanned",    format: v => `${v} coins`   },
  { key: "netWorth",   label: "Net Worth",     field: "netWorth",   format: v => `$${v.toLocaleString()}` },
  { key: "memberDays", label: "Longest Member",field: "memberDays", format: v => `${v} days`    },
  { key: "badges",     label: "Most Badges",   field: "badges",     format: v => `${v} badges`  },
];

export default function LeaderboardScreen({ navigate, user, userScans }) {
  const [cat, setCat] = useState("scanned");
  const [liveUsers, setLiveUsers] = useState(FAKE_USERS.map(u => ({ ...u })));
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [flashedName, setFlashedName] = useState(null);
  const category = LB_CATEGORIES.find(c => c.key === cat);

  useEffect(() => {
    function tick() {
      setLiveUsers(prev => {
        const next = prev.map(u => ({ ...u }));
        const count = Math.random() < 0.4 ? 2 : 1;
        const picked = [];
        while (picked.length < count) {
          const idx = Math.floor(Math.random() * next.length);
          if (!picked.includes(idx)) picked.push(idx);
        }
        picked.forEach(idx => {
          if (Math.random() < 0.7) next[idx].scanned += 1;
          next[idx].netWorth += Math.floor(Math.random() * 120);
        });
        setFlashedName(next[picked[0]].name);
        setTimeout(() => setFlashedName(null), 800);
        return next;
      });
      setLastUpdated(new Date());
    }

    const id = setInterval(tick, 7000 + Math.random() * 5000);
    return () => clearInterval(id);
  }, []);

  const myDays = user.createdAt
    ? Math.max(1, Math.floor((Date.now() - user.createdAt) / 86400000))
    : 1;

  const myEntry = {
    name: user.name,
    scanned: userScans.length,
    netWorth: userScans.reduce((s, c) => s + (c.value ?? 0), 0),
    memberDays: myDays,
    badges: BADGES.filter(b => b.check(userScans, user)).length,
    isMe: true,
  };

  const all = [...liveUsers.map(u => ({ ...u, isMe: false })), myEntry]
    .sort((a, b) => b[category.field] - a[category.field])
    .map((u, i) => ({ ...u, rank: i + 1 }));

  const medals = ["🥇", "🥈", "🥉"];
  const updatedStr = lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <SafeAreaView style={styles.safeArea}>
      <Header title="Leaderboard" onBack={() => navigate("home")} />
      <ScrollView contentContainerStyle={styles.accountContainer}>
        <View style={styles.lbLiveRow}>
          <View style={styles.lbLiveDot} />
          <Text style={styles.lbLiveText}>LIVE</Text>
          <Text style={styles.lbUpdatedText}>  Updated {updatedStr}</Text>
        </View>

        <View style={styles.lbCatRow}>
          {LB_CATEGORIES.map(c => (
            <TouchableOpacity key={c.key} style={[styles.lbCatBtn, cat === c.key && styles.lbCatBtnActive]} onPress={() => setCat(c.key)}>
              <Text style={[styles.lbCatText, cat === c.key && styles.lbCatTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {all.map((entry) => (
          <View key={entry.name} style={[styles.lbRow, entry.isMe && styles.lbRowMe, flashedName === entry.name && styles.lbRowFlash]}>
            <Text style={styles.lbRank}>
              {entry.rank <= 3 ? medals[entry.rank - 1] : `#${entry.rank}`}
            </Text>
            <View style={styles.lbInfo}>
              <Text style={[styles.lbName, entry.isMe && styles.lbNameMe]}>
                {entry.name}{entry.isMe ? "  (you)" : ""}
              </Text>
              <Text style={styles.lbSub}>{category.format(entry[category.field])}</Text>
            </View>
            <View style={[styles.lbBadge, entry.rank === 1 && styles.lbBadgeGold]}>
              <Text style={[styles.lbBadgeText, entry.rank === 1 && styles.lbBadgeTextGold]}>
                {category.format(entry[category.field])}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
