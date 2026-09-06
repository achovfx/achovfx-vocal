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
    const token = client.generateUserToken({ user_id: userId, validity_in_seconds: 60 * 60 });

    return NextResponse.json({ token, apiKey, user: { id: userId, name, type: 'guest' } });
  } catch {
    return NextResponse.json({ error: 'Unable to create Stream token' }, { status: 500 });
  }
}
