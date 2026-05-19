import { getAnalyticsSummary } from "@pulseguard/analytics";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANALYTICS_HISTORY_LIMIT = 60;

export async function GET() {
  try {
    const summary = await getAnalyticsSummary({
      limit: ANALYTICS_HISTORY_LIMIT,
    });

    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch analytics";

    return NextResponse.json(
      {
        message,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
