import { NextRequest, NextResponse } from 'next/server';
import { heartbeat } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
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
