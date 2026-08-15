import { NextResponse } from "next/server";
import { GameError } from "./errors";

export function jsonError(error: unknown) {
  if (error instanceof GameError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "Unexpected server error.", code: "INTERNAL_ERROR" }, { status: 500 });
}
