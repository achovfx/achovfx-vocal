import { NextRequest, NextResponse } from 'next/server';
import { sendSignal } from '@/lib/room-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, fromId, toId, payload } = body;

    if (!roomId || !fromId || !payload) {
      return NextResponse.json(
        { error: 'Missing required signaling parameters' },
        { status: 400 }
      );
    }

    sendSignal(roomId, fromId, toId, payload);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
