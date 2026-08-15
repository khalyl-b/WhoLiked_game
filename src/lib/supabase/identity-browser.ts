"use client";

import { createSupabaseBrowserClient } from "./browser";

/**
 * Ensure the browser owns a Supabase Auth identity before calling game APIs.
 * Creating anonymous users in the browser keeps Supabase Auth rate limiting tied
 * to the real client rather than concentrating sign-ups on a Vercel server IP.
 */
export async function ensureBrowserIdentity(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session) return;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Could not create your game session: ${error.message}`);
}
