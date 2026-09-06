import { NextResponse } from 'next/server';
import { StreamClient } from '@stream-io/node-sdk';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
  const apiSecret = process.env.STREAM_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'Stream credentials are not configured' }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { userId?: string; name?: string };
    const userId = String(body.userId || '').trim().slice(0, 64);
    const name = String(body.name || 'کاربر').trim().slice(0, 40) || 'کاربر';

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const client = new StreamClient(apiKey, apiSecret);

    // These are anonymous app users, but they need the regular Stream
    // `user` role because they create/join rooms. The Stream `guest` role
    // is intentionally restricted and cannot create calls by default.
    await client.upsertUsers([
      {
        id: userId,
        name,
        role: 'user',
      },
    ]);

    const token = client.generateUserToken({
      user_id: userId,
      validity_in_seconds: 60 * 60,
    });

    return NextResponse.json({
      token,
      apiKey,
      user: { id: userId, name, role: 'user' },
    });
  } catch (error) {
    console.error('Stream token error:', error);
    return NextResponse.json({ error: 'Unable to create Stream token' }, { status: 500 });
  }
}
