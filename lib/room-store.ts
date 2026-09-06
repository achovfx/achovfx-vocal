import { Participant, SignalPayload } from '@/types/voice-chat';
import { getColorByOrder } from './colors';

interface StoredSignal {
  id: string;
  from: string;
  to?: string; // If undefined, broadcast to all except sender
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

const rooms: Map<string, RoomState> = globalForRooms.__AURA_VOICE_ROOMS;

// Clean up inactive rooms and participants
function cleanupInactive(room: RoomState) {
  const now = Date.now();
  // 15 seconds without heartbeat = disconnected (normal heartbeat is every 500ms-1000ms)
  const timeoutMs = 15000;

  for (const [pId, p] of room.participants.entries()) {
    if (now - p.lastHeartbeat > timeoutMs) {
      room.participants.delete(pId);
      // broadcast leave
      room.signals.push({
        id: `sig_leave_${now}_${pId}`,
        from: pId,
        payload: { type: 'leave', participantId: pId },
        timestamp: now,
      });
    }
  }

  // Prune signals older than 45s or keep last 250
  const pruneThreshold = now - 45000;
  room.signals = room.signals.filter((s) => s.timestamp > pruneThreshold);
  if (room.signals.length > 250) {
    room.signals = room.signals.slice(-150);
  }
}

export function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
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
    rooms.set(roomId, room);
  }

  room.lastActive = now;
  cleanupInactive(room);
  return room;
}

export function joinRoom(
  roomId: string,
  participantId: string,
  name: string
): { self: Participant; others: Participant[] } {
  const room = getOrCreateRoom(roomId);
  const now = Date.now();
  const cleanName = (name || '').trim();

  let participant = room.participants.get(participantId);
  if (!participant) {
    const assignedOrder = room.nextColorIndex;
    room.nextColorIndex += 1; // Increment sequentially for the next joiner!
    const color = getColorByOrder(assignedOrder);

    participant = {
      id: participantId,
      name: cleanName || `کاربر ${assignedOrder + 1}`,
      joinOrder: assignedOrder,
      color,
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isScreenSharing: false,
      isSpeaking: false,
      joinedAt: now,
      lastHeartbeat: now,
    };
    room.participants.set(participantId, participant);

    // Broadcast join signal to other participants
    room.signals.push({
      id: `join_${now}_${participantId}`,
      from: participantId,
      payload: { type: 'join', participant },
      timestamp: now,
    });
  } else {
    // update heartbeat and name if provided
    if (cleanName) participant.name = cleanName;
    participant.lastHeartbeat = now;
  }

  const others: Participant[] = [];
  for (const [id, p] of room.participants.entries()) {
    if (id !== participantId) {
      others.push(p);
    }
  }

  return { self: participant, others };
}

export function leaveRoom(roomId: string, participantId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.participants.has(participantId)) {
    room.participants.delete(participantId);
    const now = Date.now();
    room.signals.push({
      id: `leave_${now}_${participantId}`,
      from: participantId,
      payload: { type: 'leave', participantId },
      timestamp: now,
    });
  }

  if (room.participants.size === 0) {
    // Keep empty room for at least 15 min
    if (Date.now() - room.lastActive > 15 * 60 * 1000) {
      rooms.delete(roomId);
    }
  }
}

export function sendSignal(
  roomId: string,
  fromId: string,
  toId: string | undefined,
  payload: SignalPayload
) {
  const room = getOrCreateRoom(roomId);
  const now = Date.now();

  room.signals.push({
    id: `sig_${now}_${Math.random().toString(36).substring(2, 9)}`,
    from: fromId,
    to: toId,
    payload,
    timestamp: now,
  });
}

export function heartbeat(
  roomId: string,
  participantId: string,
  lastSignalTimestamp: number,
  updates?: Partial<Participant>
): { signals: StoredSignal[]; currentMembers: Participant[] } {
  const room = getOrCreateRoom(roomId);
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

  // Get signals intended for this participant or broadcasted to everyone (where to is undefined)
  // that were emitted after lastSignalTimestamp and not sent by self
  const relevantSignals = room.signals.filter((s) => {
    if (s.from === participantId) return false;
    if (s.timestamp <= lastSignalTimestamp) return false;
    if (s.to && s.to !== participantId) return false;
    return true;
  });

  const currentMembers = Array.from(room.participants.values());

  return {
    signals: relevantSignals,
    currentMembers,
  };
}
