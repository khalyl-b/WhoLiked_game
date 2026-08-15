import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseServerConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = process.env.GAME_STORAGE?.toLowerCase();
  const storage = configured || (hasSupabaseServerConfig() ? "supabase" : "memory");

  if (process.env.NODE_ENV === "production" && storage !== "supabase") {
    return NextResponse.json(
      { ok: false, storage, database: false, error: "Production requires GAME_STORAGE=supabase." },
      { status: 503 },
    );
  }

  if (storage === "supabase") {
    try {
      const db = createSupabaseAdminClient();
      if (!db) throw new Error("Supabase is not configured.");
      const { error } = await db.from("rooms").select("id", { head: true, count: "exact" });
      if (error) {
        return NextResponse.json(
          { ok: false, storage, database: false, error: "Supabase is configured but the game schema is unavailable." },
          { status: 503 },
        );
      }
      return NextResponse.json({ ok: true, storage, database: true });
    } catch {
      return NextResponse.json(
        { ok: false, storage, database: false, error: "Supabase server configuration is incomplete." },
        { status: 503 },
      );
    }
  }

  return NextResponse.json({ ok: true, storage, database: false });
}
