// Badge predicates operate on real Supabase `scans` rows (see
// server/app.py's persist_scan / supabase/migrations for the exact shape),
// not a client-side approximation. denom_canonical, is_foreign, year,
// local_date and local_hour are all computed authoritatively by Flask at
// insert time, so badges just read them instead of re-deriving them from a
// display string.

function _nw(scans) { return scans.reduce((s, c) => s + (c.estimated_value ?? 0), 0); }
function _days(createdAt) { return Math.floor((Date.now() - createdAt) / 86400000); }

function _localDateParts(scan) {
  const raw = scan.local_date || (scan.scanned_at ? scan.scanned_at.slice(0, 10) : null);
  if (!raw) return null;
  const [year, month, day] = raw.split("-").map(Number);
  return { year, month, day, date: new Date(year, month - 1, day) };
}

function _onMonthDay(scans, month, day) {
  return scans.filter(s => {
    const parts = _localDateParts(s);
    return parts && parts.month === month && parts.day === day;
  }).length;
}
function _onFridayThe13th(scans) {
  return scans.filter(s => {
    const parts = _localDateParts(s);
    return parts && parts.day === 13 && parts.date.getDay() === 5;
  }).length;
}
function _onThanksgiving(scans) {
  return scans.filter(s => {
    const parts = _localDateParts(s);
    return parts && parts.month === 11 && parts.date.getDay() === 4 && parts.day >= 22 && parts.day <= 28;
  }).length;
}
function _maxStreak(scans, matchFn) {
  let max = 0, cur = 0;
  for (const s of scans) {
    if (matchFn(s)) { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}
function _maxDenomStreak(scans, denom) {
  return _maxStreak(scans, s => s.denom_canonical === denom);
}
function _maxAnyDenomStreak(scans) {
  let max = 0, cur = 0, last = null;
  for (const s of scans) {
    const d = s.denom_canonical;
    cur = (d && d === last) ? cur + 1 : (d ? 1 : 0);
    last = d;
    if (cur > max) max = cur;
  }
  return max;
}
function _hasAllDenoms(scans, denoms) {
  const owned = new Set(scans.map(s => s.denom_canonical));
  return denoms.every(d => owned.has(d));
}
function _hasScanInHourRange(scans, startH, endH) {
  return scans.some(s => typeof s.local_hour === "number" && s.local_hour >= startH && s.local_hour < endH);
}
function _hasRapidPair(scans, withinMs) {
  const times = scans.map(s => new Date(s.scanned_at).getTime()).filter(t => !Number.isNaN(t)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] <= withinMs) return true;
  }
  return false;
}
function _hasOldCoin(scans, beforeYear) {
  return scans.some(s => typeof s.year === "number" && s.year < beforeYear);
}
function _yearSpan(scans) {
  const years = scans.map(s => s.year).filter(y => typeof y === "number");
  return years.length < 2 ? 0 : Math.max(...years) - Math.min(...years);
}
function _hasDenom(scans, denom) {
  return scans.some(s => s.denom_canonical === denom);
}

export const BADGES = [
  // — Scanning milestones
  { id: "scan_1",     icon: "🔍", name: "First Scan",           desc: "Scan your very first coin",          category: "Scanning",  check: (s) => s.length >= 1     },
  { id: "scan_10",    icon: "🔟", name: "Getting Started",      desc: "Scan 10 coins",                      category: "Scanning",  check: (s) => s.length >= 10    },
  { id: "scan_25",    icon: "⭐", name: "Coin Enthusiast",      desc: "Scan 25 coins",                      category: "Scanning",  check: (s) => s.length >= 25    },
  { id: "scan_50",    icon: "🏆", name: "Half Century",         desc: "Scan 50 coins",                      category: "Scanning",  check: (s) => s.length >= 50    },
  { id: "scan_100",   icon: "💯", name: "Century Club",         desc: "Scan 100 coins",                     category: "Scanning",  check: (s) => s.length >= 100   },
  { id: "scan_250",   icon: "🚀", name: "Dedicated Collector",  desc: "Scan 250 coins",                     category: "Scanning",  check: (s) => s.length >= 250   },
  { id: "scan_500",   icon: "👑", name: "Master Scanner",       desc: "Scan 500 coins",                     category: "Scanning",  check: (s) => s.length >= 500   },
  { id: "scan_1000",  icon: "🔱", name: "Elite Collector",      desc: "Scan 1,000 coins",                   category: "Scanning",  check: (s) => s.length >= 1000  },
  { id: "scan_2500",  icon: "🌌", name: "Numismatic Legend",    desc: "Scan 2,500 coins",                   category: "Scanning",  check: (s) => s.length >= 2500  },
  { id: "scan_5000",  icon: "⚡", name: "Coin Overlord",        desc: "Scan 5,000 coins",                   category: "Scanning",  check: (s) => s.length >= 5000  },
  { id: "scan_10000", icon: "🌠", name: "The Archivist",        desc: "Scan 10,000 coins",                  category: "Scanning",  check: (s) => s.length >= 10000 },
  // — Net worth milestones
  { id: "worth_1",      icon: "💰", name: "First Dollar",       desc: "Reach $1 in collection value",       category: "Net Worth", check: (s) => _nw(s) >= 1       },
  { id: "worth_10",     icon: "💵", name: "Growing Stack",      desc: "Reach $10 in collection value",      category: "Net Worth", check: (s) => _nw(s) >= 10      },
  { id: "worth_50",     icon: "💸", name: "Rising Value",       desc: "Reach $50 in collection value",      category: "Net Worth", check: (s) => _nw(s) >= 50      },
  { id: "worth_100",    icon: "🤑", name: "Century Mark",       desc: "Reach $100 in collection value",     category: "Net Worth", check: (s) => _nw(s) >= 100     },
  { id: "worth_500",    icon: "💎", name: "Five Hundred",       desc: "Reach $500 in collection value",     category: "Net Worth", check: (s) => _nw(s) >= 500     },
  { id: "worth_1000",   icon: "🏦", name: "Four Figures",       desc: "Reach $1,000 in collection value",   category: "Net Worth", check: (s) => _nw(s) >= 1000    },
  { id: "worth_10000",  icon: "🌟", name: "High Roller",        desc: "Reach $10,000 in collection value",  category: "Net Worth", check: (s) => _nw(s) >= 10000   },
  { id: "worth_25000",  icon: "🔥", name: "Quarter Million",    desc: "Reach $25,000 in collection value",  category: "Net Worth", check: (s) => _nw(s) >= 25000   },
  { id: "worth_100000", icon: "🏅", name: "Six Figures",        desc: "Reach $100,000 in collection value", category: "Net Worth", check: (s) => _nw(s) >= 100000  },
  { id: "worth_500000", icon: "🦅", name: "Half Million",       desc: "Reach $500,000 in collection value", category: "Net Worth", check: (s) => _nw(s) >= 500000  },
  { id: "worth_1m",     icon: "👁️", name: "The Million",        desc: "Reach $1,000,000 in collection value",category:"Net Worth", check: (s) => _nw(s) >= 1000000 },
  // — Membership milestones
  { id: "mem_join", icon: "👋", name: "Welcome",                desc: "Join CoinLens",                      category: "Member",    check: (s, u) => !!u.createdAt                             },
  { id: "mem_7",    icon: "📅", name: "One Week",               desc: "Be a member for 7 days",             category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 7    },
  { id: "mem_30",   icon: "📆", name: "One Month",              desc: "Be a member for 30 days",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 30   },
  { id: "mem_180",  icon: "🗓️", name: "Half Year",              desc: "Be a member for 180 days",           category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 180  },
  { id: "mem_365",  icon: "🎂", name: "Veteran",                desc: "Be a member for 1 year",             category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 365  },
  { id: "mem_730",  icon: "🏛️", name: "Pillar of the Community",desc: "Be a member for 2 years",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 730  },
  { id: "mem_1825", icon: "🌐", name: "Living Legend",          desc: "Be a member for 5 years",            category: "Member",    check: (s, u) => u.createdAt && _days(u.createdAt) >= 1825 },
  // — Seasonal / holiday (evaluated against the device-local calendar date at scan time)
  { id: "season_halloween",    icon: "🎃", name: "Trick-or-Treasure",   desc: "Scan 5 coins on Halloween (Oct 31)",        category: "Seasonal", check: (s) => _onMonthDay(s, 10, 31) >= 5 },
  { id: "season_friday13",     icon: "🕷️", name: "Unlucky for Some",    desc: "Scan a coin on Friday the 13th",            category: "Seasonal", check: (s) => _onFridayThe13th(s) >= 1    },
  { id: "season_christmas",    icon: "🎄", name: "Silver Bells",        desc: "Scan a coin on Christmas Day (Dec 25)",     category: "Seasonal", check: (s) => _onMonthDay(s, 12, 25) >= 1 },
  { id: "season_newyear",      icon: "🎆", name: "New Year, New Coins", desc: "Scan 3 coins on New Year's Day (Jan 1)",    category: "Seasonal", check: (s) => _onMonthDay(s, 1, 1) >= 3    },
  { id: "season_valentine",    icon: "💘", name: "Lucky in Love",       desc: "Scan a coin on Valentine's Day (Feb 14)",   category: "Seasonal", check: (s) => _onMonthDay(s, 2, 14) >= 1   },
  { id: "season_stpatrick",    icon: "🍀", name: "Pot of Gold",         desc: "Scan a coin on St. Patrick's Day (Mar 17)", category: "Seasonal", check: (s) => _onMonthDay(s, 3, 17) >= 1   },
  { id: "season_july4",        icon: "🎇", name: "Independence Stack",  desc: "Scan 4 coins on Independence Day (Jul 4)",  category: "Seasonal", check: (s) => _onMonthDay(s, 7, 4) >= 4    },
  { id: "season_thanksgiving", icon: "🦃", name: "Turkey Day Treasure", desc: "Scan a coin on Thanksgiving",               category: "Seasonal", check: (s) => _onThanksgiving(s) >= 1      },
  // — Variety & streaks (streaks assume `scans` is ordered oldest -> newest)
  { id: "var_nickel_streak",   icon: "🪙", name: "Nickel Streak",       desc: "Scan 5 nickels in a row",                       category: "Variety", check: (s) => _maxDenomStreak(s, "nickel") >= 5   },
  { id: "var_penny_streak",    icon: "🅿️", name: "Penny Pincher",       desc: "Scan 5 pennies in a row",                       category: "Variety", check: (s) => _maxDenomStreak(s, "penny") >= 5    },
  { id: "var_dime_streak",     icon: "🎙️", name: "Dime Dash",           desc: "Scan 5 dimes in a row",                         category: "Variety", check: (s) => _maxDenomStreak(s, "dime") >= 5     },
  { id: "var_quarter_streak",  icon: "🦅", name: "Quarter Quartet",     desc: "Scan 4 quarters in a row",                      category: "Variety", check: (s) => _maxDenomStreak(s, "quarter") >= 4  },
  { id: "var_wheat_streak",    icon: "🌾", name: "Wheat Row",           desc: "Scan 3 wheat pennies in a row",                 category: "Variety", check: (s) => _maxDenomStreak(s, "wheat-penny") >= 3 },
  { id: "var_on_a_roll",       icon: "🎯", name: "On a Roll",           desc: "Scan 5 of the same denomination in a row",      category: "Variety", check: (s) => _maxAnyDenomStreak(s) >= 5          },
  { id: "var_full_set",        icon: "🧺", name: "Full Set",            desc: "Scan a penny, nickel, dime, and quarter",       category: "Variety", check: (s) => _hasAllDenoms(s, ["penny", "nickel", "dime", "quarter"]) },
  { id: "var_night_owl",       icon: "🌙", name: "Night Owl",           desc: "Scan a coin between midnight and 3 AM",         category: "Variety", check: (s) => _hasScanInHourRange(s, 0, 3)        },
  { id: "var_early_bird",      icon: "🌅", name: "Early Bird",          desc: "Scan a coin between 4 AM and 6 AM",             category: "Variety", check: (s) => _hasScanInHourRange(s, 4, 6)        },
  { id: "var_quickfire",       icon: "⚡", name: "Quickfire",           desc: "Scan two coins within 60 seconds of each other",category: "Variety", check: (s) => _hasRapidPair(s, 60000)             },
  { id: "var_old_soul",        icon: "🕰️", name: "Old Soul",            desc: "Scan a coin minted before 1950",                category: "Variety", check: (s) => _hasOldCoin(s, 1950)                },
  { id: "var_time_machine",    icon: "⏳", name: "Time Machine",        desc: "Scan coins spanning 100+ years apart",          category: "Variety", check: (s) => _yearSpan(s) >= 100                 },
  // — Coin types
  { id: "type_penny",   icon: "🟤", name: "Copper Cent",   desc: "Scan a penny",                       category: "Coin Types", check: (s) => _hasDenom(s, "penny")       },
  { id: "type_nickel",  icon: "⚪", name: "Nickel Novice", desc: "Scan a nickel",                      category: "Coin Types", check: (s) => _hasDenom(s, "nickel")      },
  { id: "type_dime",    icon: "🥈", name: "Perfect Ten",   desc: "Scan a dime",                        category: "Coin Types", check: (s) => _hasDenom(s, "dime")        },
  { id: "type_quarter", icon: "🦅", name: "Quarter Master",desc: "Scan a quarter",                     category: "Coin Types", check: (s) => _hasDenom(s, "quarter")     },
  { id: "type_half",    icon: "🎖️", name: "Half Measures", desc: "Scan a half dollar",                 category: "Coin Types", check: (s) => _hasDenom(s, "half-dollar") },
  { id: "type_dollar",  icon: "💵", name: "Dollar Sign",   desc: "Scan a dollar coin",                 category: "Coin Types", check: (s) => _hasDenom(s, "dollar")      },
  { id: "type_wheat",   icon: "🌾", name: "Wheat Field",   desc: "Scan a wheat penny",                 category: "Coin Types", check: (s) => _hasDenom(s, "wheat-penny") },
  { id: "type_foreign", icon: "🌍", name: "World Traveler",desc: "Scan a coin from outside the U.S.",  category: "Coin Types", check: (s) => s.some(x => x.is_foreign) },
];

export const BADGE_CATEGORIES = ["Scanning", "Net Worth", "Member", "Seasonal", "Variety", "Coin Types"];

// Tier-only approximation used for OTHER users on the leaderboard, where we
// only have safe aggregate fields (scan_count, total_value, member days) and
// must not fetch another user's raw scan history to compute their real
// badges. Uses the same thresholds as the Scanning/Net Worth/Member badges
// above so the count stays meaningful.
export function tierBadgeCount({ scanned, netWorth, memberDays }) {
  const scanTiers  = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const worthTiers = [1, 10, 50, 100, 500, 1000, 10000, 25000, 100000, 500000, 1000000];
  const dayTiers   = [0, 7, 30, 180, 365, 730, 1825];
  return (
    scanTiers.filter(t => scanned >= t).length +
    worthTiers.filter(t => netWorth >= t).length +
    dayTiers.filter(t => memberDays >= t).length
  );
}
