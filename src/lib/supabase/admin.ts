import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerKey, getSupabaseUrl } from "./config";

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serverKey = getSupabaseServerKey();
  if (!url || !serverKey) return null;
  return createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
