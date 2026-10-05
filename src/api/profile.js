import { supabase } from "./supabase";

// Direct-to-Supabase read of the signed-in user's own profile row, under RLS
// (see profiles_select_own in supabase/migrations). `role` here is the
// authoritative admin flag: there is no client UPDATE policy on profiles, so
// it can only be changed by editing the row directly in the Supabase
// dashboard (or by the server's service-role key) - never by the signed-in
// user themselves, unlike auth user_metadata which a client can update on
// its own account.
export async function fetchMyProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, created_at")
    .single();

  if (error) throw error;
  return data;
}
