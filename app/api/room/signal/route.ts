import { NextRequest, NextResponse } from 'next/server';
import { sendSignal } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomId, fromId, toId, payload } = body;

    if (!roomId || !fromId || !payload || typeof payload.type !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid signaling parameters' },
        { status: 400 }
      );
    }

    if ((payload.type === 'sdp-offer' || payload.type === 'sdp-answer' || payload.type === 'ice-candidate') && !toId) {
      return NextResponse.json(
        { error: 'Peer-to-peer signaling requires a target participant' },
        { status: 400 }
      );
    }

    await sendSignal(roomId, fromId, toId, payload);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
