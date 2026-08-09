import { NextResponse } from "next/server";
import { loadRegistry } from "@/lib/registry";
import { isMockMode } from "@/lib/anthropic";

export const dynamic = "force-dynamic";

/** 画面の選択肢（病院・治験）を返す。 */
export async function GET() {
  try {
    const registry = await loadRegistry();
    return NextResponse.json({
      hospitals: registry.hospitals,
      trials: registry.trials,
      documentCount: registry.documents.length,
      mock: isMockMode(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
