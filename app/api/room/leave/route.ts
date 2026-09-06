import { NextRequest, NextResponse } from 'next/server';
import { leaveRoom } from '@/lib/room-store';

export async function POST(req: NextRequest) {
  try {
    let body: { roomId?: string; participantId?: string } = {};
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }
    const { roomId, participantId } = body;

    if (!roomId || !participantId) {
      return NextResponse.json(
        { error: 'Missing roomId or participantId' },
        { status: 400 }
      );
    }

    leaveRoom(roomId, participantId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
