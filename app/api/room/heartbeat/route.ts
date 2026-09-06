import { NextRequest, NextResponse } from 'next/server';
import { heartbeat } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production' && !redisConfigured()) {
      return NextResponse.json(
        { error: 'Production signaling requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const { roomId, participantId, lastSignalTimestamp, updates } = body;

    if (!roomId || !participantId) {
      return NextResponse.json(
        { error: 'Missing roomId or participantId' },
        { status: 400 }
      );
    }

    const { signals, currentMembers } = await heartbeat(
      roomId,
      participantId,
      Number(lastSignalTimestamp) || 0,
      updates
    );

    return NextResponse.json({
      success: true,
      signals,
      currentMembers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
