import { Participant, SignalPayload } from '@/types/voice-chat';
import { getColorByOrder } from './colors';

interface StoredSignal {
  id: string;
  from: string;
  to?: string;
  payload: SignalPayload;
  timestamp: number;
}

interface RoomState {
  id: string;
  createdAt: number;
  lastActive: number;
  nextColorIndex: number;
  participants: Map<string, Participant>;
  signals: StoredSignal[];
}

const globalForRooms = globalThis as unknown as {
  __AURA_VOICE_ROOMS?: Map<string, RoomState>;
};

if (!globalForRooms.__AURA_VOICE_ROOMS) {
  globalForRooms.__AURA_VOICE_ROOMS = new Map<string, RoomState>();
}

const memoryRooms: Map<string, RoomState> = globalForRooms.__AURA_VOICE_ROOMS;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

function redisKey(roomId: string, suffix: string) {
  return `aura:room:${roomId}:${suffix}`;
}

async function redisCommand<T = unknown>(command: unknown[]): Promise<T> {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Redis is not configured');
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Redis request failed: ${response.status}`);
  const data = (await response.json()) as { result?: T; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result as T;
}

async function redisPipeline(commands: unknown[][]): Promise<unknown[]> {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error('Redis is not configured');
  const response = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Redis pipeline failed: ${response.status}`);
  const data = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  for (const item of data) if (item.error) throw new Error(item.error);
  return data.map((item) => item.result);
}

function parseHashValues(values: unknown): Participant[] {
  if (!Array.isArray(values)) return [];
  const participants: Participant[] = [];
  for (let i = 0; i < values.length; i += 2) {
    const raw = values[i + 1];
    if (typeof raw !== 'string') continue;
    try {
      participants.push(JSON.parse(raw) as Participant);
    } catch {
      // Ignore malformed stale entries.
    }
  }
  return participants;
}

function shouldParticipantOffer(offerer: Participant, target: Participant): boolean {
  if (offerer.joinedAt !== target.joinedAt) return offerer.joinedAt < target.joinedAt;
  return offerer.id < target.id;
}

function cleanupMemoryRoom(room: RoomState) {
  const now = Date.now();
  const timeoutMs = 15000;
  for (const [pId, p] of room.participants.entries()) {
    if (now - p.lastHeartbeat > timeoutMs) {
      room.participants.delete(pId);
      room.signals.push({
        id: `sig_leave_${now}_${pId}`,
        from: pId,
        payload: { type: 'leave', participantId: pId },
        timestamp: now,
      });
    }
  }
  room.signals = room.signals.filter((s) => s.timestamp > now - 45000);
  if (room.signals.length > 250) room.signals = room.signals.slice(-150);
}

export async function joinRoom(
  roomId: string,
  participantId: string,
  name: string
): Promise<{ self: Participant; others: Participant[] }> {
  if (!useRedis) return joinMemoryRoom(roomId, participantId, name);

  const now = Date.now();
  const cleanName = (name || '').trim();
  const participantsKey = redisKey(roomId, 'participants');
  const colorKey = redisKey(roomId, 'next-color');
  const signalsKey = redisKey(roomId, 'signals');
  const existingRaw = await redisCommand<string | null>(['HGET', participantsKey, participantId]);

  let participant: Participant;
  if (existingRaw) {
    participant = JSON.parse(existingRaw) as Participant;
    if (cleanName) participant.name = cleanName;
    participant.lastHeartbeat = now;
    await redisCommand(['HSET', participantsKey, participantId, JSON.stringify(participant)]);
  } else {
    const counter = Number(await redisCommand<number>(['INCR', colorKey]));
    const assignedOrder = counter - 1;
    participant = {
      id: participantId,
      name: cleanName || `کاربر ${assignedOrder + 1}`,
      joinOrder: assignedOrder,
      color: getColorByOrder(assignedOrder),
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      isSpeaking: false,
      joinedAt: now,
      lastHeartbeat: now,
    };
    const signal: StoredSignal = {
      id: `join_${now}_${participantId}`,
      from: participantId,
      payload: { type: 'join', participant },
      timestamp: now,
    };
    await redisPipeline([
      ['HSET', participantsKey, participantId, JSON.stringify(participant)],
      ['RPUSH', signalsKey, JSON.stringify(signal)],
      ['LTRIM', signalsKey, '-250', '-1'],
      ['EXPIRE', participantsKey, '30'],
      ['EXPIRE', signalsKey, '60'],
      ['EXPIRE', colorKey, '900'],
    ]);
  }

  const values = await redisCommand<unknown[]>(['HGETALL', participantsKey]);
  return {
    self: participant,
    others: parseHashValues(values).filter((p) => p.id !== participantId),
  };
}

async function joinMemoryRoom(
  roomId: string,
  participantId: string,
  name: string
): Promise<{ self: Participant; others: Participant[] }> {
  let room = memoryRooms.get(roomId);
  const now = Date.now();
  if (!room) {
    room = {
      id: roomId,
      createdAt: now,
      lastActive: now,
      nextColorIndex: 0,
      participants: new Map(),
      signals: [],
    };
    memoryRooms.set(roomId, room);
  }
  room.lastActive = now;
  cleanupMemoryRoom(room);

  const cleanName = (name || '').trim();
  let participant = room.participants.get(participantId);
  if (!participant) {
    const assignedOrder = room.nextColorIndex++;
    participant = {
      id: participantId,
      name: cleanName || `کاربر ${assignedOrder + 1}`,
      joinOrder: assignedOrder,
      color: getColorByOrder(assignedOrder),
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      isSpeaking: false,
      joinedAt: now,
      lastHeartbeat: now,
    };
    room.participants.set(participantId, participant);
    room.signals.push({
      id: `join_${now}_${participantId}`,
      from: participantId,
      payload: { type: 'join', participant },
      timestamp: now,
    });
  } else {
    if (cleanName) participant.name = cleanName;
    participant.lastHeartbeat = now;
  }

  return {
    self: participant,
    others: Array.from(room.participants.values()).filter((p) => p.id !== participantId),
  };
}

export async function leaveRoom(roomId: string, participantId: string): Promise<void> {
  if (!useRedis) {
    const room = memoryRooms.get(roomId);
    if (!room || !room.participants.has(participantId)) return;
    room.participants.delete(participantId);
    room.signals.push({
      id: `leave_${Date.now()}_${participantId}`,
      from: participantId,
      payload: { type: 'leave', participantId },
      timestamp: Date.now(),
    });
    return;
  }

  const participantsKey = redisKey(roomId, 'participants');
  const signalsKey = redisKey(roomId, 'signals');
  const exists = await redisCommand<number>(['HEXISTS', participantsKey, participantId]);
  if (!exists) return;

  const now = Date.now();
  const signal: StoredSignal = {
    id: `leave_${now}_${participantId}`,
    from: participantId,
    payload: { type: 'leave', participantId },
    timestamp: now,
  };
  await redisPipeline([
    ['HDEL', participantsKey, participantId],
    ['RPUSH', signalsKey, JSON.stringify(signal)],
    ['LTRIM', signalsKey, '-250', '-1'],
    ['EXPIRE', signalsKey, '60'],
  ]);
}

export async function sendSignal(
  roomId: string,
  fromId: string,
  toId: string | undefined,
  payload: SignalPayload
): Promise<void> {
  if (payload.type === 'sdp-offer' && toId) {
    if (useRedis) {
      const participantsKey = redisKey(roomId, 'participants');
      const [fromRaw, toRaw] = await redisPipeline([
        ['HGET', participantsKey, fromId],
        ['HGET', participantsKey, toId],
      ]) as [unknown, unknown];
      if (typeof fromRaw === 'string' && typeof toRaw === 'string') {
        const fromParticipant = JSON.parse(fromRaw) as Participant;
        const toParticipant = JSON.parse(toRaw) as Participant;
        if (!shouldParticipantOffer(fromParticipant, toParticipant)) return;
      }
    } else {
      const room = memoryRooms.get(roomId);
      const fromParticipant = room?.participants.get(fromId);
      const toParticipant = room?.participants.get(toId);
      if (fromParticipant && toParticipant && !shouldParticipantOffer(fromParticipant, toParticipant)) return;
    }
  }

  const signal: StoredSignal = {
    id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    from: fromId,
    to: toId,
    payload,
    timestamp: Date.now(),
  };

  if (!useRedis) {
    let room = memoryRooms.get(roomId);
    if (!room) {
      const now = Date.now();
      room = {
        id: roomId,
        createdAt: now,
        lastActive: now,
        nextColorIndex: 0,
        participants: new Map(),
        signals: [],
      };
      memoryRooms.set(roomId, room);
    }
    cleanupMemoryRoom(room);
    room.signals.push(signal);
    if (room.signals.length > 250) room.signals = room.signals.slice(-150);
    return;
  }

  const signalsKey = redisKey(roomId, 'signals');
  await redisPipeline([
    ['RPUSH', signalsKey, JSON.stringify(signal)],
    ['LTRIM', signalsKey, '-250', '-1'],
    ['EXPIRE', signalsKey, '60'],
  ]);
}

export async function heartbeat(
  roomId: string,
  participantId: string,
  lastSignalTimestamp: number,
  updates?: Partial<Participant>
): Promise<{ signals: StoredSignal[]; currentMembers: Participant[] }> {
  if (!useRedis) return heartbeatMemory(roomId, participantId, lastSignalTimestamp, updates);

  const participantsKey = redisKey(roomId, 'participants');
  const signalsKey = redisKey(roomId, 'signals');
  const now = Date.now();
  const raw = await redisCommand<string | null>(['HGET', participantsKey, participantId]);

  if (raw) {
    const participant = JSON.parse(raw) as Participant;
    participant.lastHeartbeat = now;
    if (updates) {
      if (typeof updates.isMuted === 'boolean') participant.isMuted = updates.isMuted;
      if (typeof updates.isDeafened === 'boolean') participant.isDeafened = updates.isDeafened;
      if (typeof updates.isCameraOn === 'boolean') participant.isCameraOn = updates.isCameraOn;
      if (typeof updates.isScreenSharing === 'boolean') participant.isScreenSharing = updates.isScreenSharing;
      if (typeof updates.isSpeaking === 'boolean') participant.isSpeaking = updates.isSpeaking;
      if (updates.name) participant.name = updates.name;
    }
    await redisPipeline([
      ['HSET', participantsKey, participantId, JSON.stringify(participant)],
      ['EXPIRE', participantsKey, '30'],
    ]);
  }

  const [signalValues, memberValues] = await redisPipeline([
    ['LRANGE', signalsKey, '0', '-1'],
    ['HGETALL', participantsKey],
  ]);

  const signals: StoredSignal[] = [];
  if (Array.isArray(signalValues)) {
    for (const rawSignal of signalValues) {
      if (typeof rawSignal !== 'string') continue;
      try {
        const signal = JSON.parse(rawSignal) as StoredSignal;
        if (
          signal.from !== participantId &&
          signal.timestamp > lastSignalTimestamp &&
          (!signal.to || signal.to === participantId)
        ) {
          signals.push(signal);
        }
      } catch {
        // Ignore malformed stale signals.
      }
    }
  }

  return { signals, currentMembers: parseHashValues(memberValues) };
}

async function heartbeatMemory(
  roomId: string,
  participantId: string,
  lastSignalTimestamp: number,
  updates?: Partial<Participant>
): Promise<{ signals: StoredSignal[]; currentMembers: Participant[] }> {
  const room = memoryRooms.get(roomId);
  if (!room) return { signals: [], currentMembers: [] };
  cleanupMemoryRoom(room);
  const now = Date.now();
  const p = room.participants.get(participantId);
  if (p) {
    p.lastHeartbeat = now;
    if (updates) {
      if (typeof updates.isMuted === 'boolean') p.isMuted = updates.isMuted;
      if (typeof updates.isDeafened === 'boolean') p.isDeafened = updates.isDeafened;
      if (typeof updates.isCameraOn === 'boolean') p.isCameraOn = updates.isCameraOn;
      if (typeof updates.isScreenSharing === 'boolean') p.isScreenSharing = updates.isScreenSharing;
      if (typeof updates.isSpeaking === 'boolean') p.isSpeaking = updates.isSpeaking;
      if (updates.name) p.name = updates.name;
    }
  }

  const signals = room.signals.filter(
    (s) =>
      s.from !== participantId &&
      s.timestamp > lastSignalTimestamp &&
      (!s.to || s.to === participantId)
  );
  return { signals, currentMembers: Array.from(room.participants.values()) };
}
