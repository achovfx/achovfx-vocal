import { NextRequest, NextResponse } from 'next/server';
import { joinRoom } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, participantId, name } = body;

    if (!roomId || !participantId) {
      return NextResponse.json(
        { error: 'Missing roomId or participantId' },
        { status: 400 }
      );
    }

    const { self, others } = await joinRoom(roomId, participantId, name || '');

    return NextResponse.json({
      success: true,
      self,
      others,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
