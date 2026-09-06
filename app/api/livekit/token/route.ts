import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { roomName, participantName } = (await request.json()) as {
      roomName?: string;
      participantName?: string;
    };

    const room = roomName?.trim();
    const name = participantName?.trim();

    if (!room || !name) {
      return NextResponse.json(
        { error: 'roomName and participantName are required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return NextResponse.json(
        {
          error:
            'LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.',
        },
        { status: 503 }
      );
    }

    const identity = `${crypto.randomUUID()}-${name.slice(0, 24)}`;

    const token = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: '2h',
    });

    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return NextResponse.json({
      token: await token.toJwt(),
      url: livekitUrl,
      identity,
    });
  } catch (error) {
    console.error('LiveKit token error:', error);
    return NextResponse.json({ error: 'Unable to create LiveKit token' }, { status: 500 });
  }
}
