import { supabase } from "./supabase";

// Direct-to-Supabase reads for the signed-in user, under RLS. These never go
// through Flask: the architecture only routes trusted writes (the scan
// pipeline) through the server, while reads of a user's own data - and the
// safe cross-user leaderboard aggregate - go straight to Supabase with the
// user's own session.

const SCAN_COLUMNS =
  "id, coin_name, country, denomination, year, mint_mark, estimated_grade, estimated_value, source, image_path, created_at, denom_canonical, is_foreign, local_date, local_hour, scanned_at";

export async function fetchMyScans() {
  const { data, error } = await supabase
    .from("scans")
    .select(SCAN_COLUMNS)
    .order("scanned_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function fetchLeaderboard() {
  const { data, error } = await supabase.rpc("leaderboard");
  if (error) throw error;
  return data || [];
}
