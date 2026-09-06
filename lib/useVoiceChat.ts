'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamVideoClient, type Call } from '@stream-io/video-react-sdk';

type Participant = { id: string; name: string; speaking: boolean };
type Message = { id: string; name: string; message: string; time: number };

type StreamParticipant = {
  user: { id: string; name?: string };
  isSpeaking?: boolean;
};

type CustomEvent = {
  custom?: {
    type?: string;
    payload?: { message?: string };
    user?: { id?: string; name?: string };
  };
};

export default function useVoiceChat() {
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [muted, setMuted] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [selfId, setSelfId] = useState('');

  const clientRef = useRef<StreamVideoClient | null>(null);
  const callRef = useRef<Call | null>(null);
  const listenersRef = useRef<Array<() => void>>([]);
  const userIdRef = useRef('');

  const syncParticipants = useCallback((call: Call) => {
    const raw = call.state.participants as unknown as StreamParticipant[] | Map<string, StreamParticipant>;
    const list = Array.isArray(raw) ? raw : Array.from(raw.values());
    const selfId = userIdRef.current;
    const values = list.map((p) => ({
      id: p.user.id,
      name: p.user.name || 'کاربر',
      speaking: Boolean(p.isSpeaking),
    }));
    setParticipants(values.filter((p) => p.id !== selfId));
    setSelfSpeaking(Boolean(values.find((p) => p.id === selfId)?.speaking));
  }, []);

  const join = useCallback(async (roomIdInput: string, nameInput: string) => {
    setError('');
    setConnecting(true);
    try {
      const storedId = window.localStorage.getItem('voice-stream-user-id');
      const userId = storedId || `guest-${crypto.randomUUID()}`;
      window.localStorage.setItem('voice-stream-user-id', userId);
      userIdRef.current = userId;

      const response = await fetch('/api/stream/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, name: nameInput }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Token error');

      const client = new StreamVideoClient({
        apiKey: data.apiKey,
        user: { id: userId, name: nameInput || 'کاربر', type: 'guest' },
        token: data.token,
      });
      clientRef.current = client;

      const call = client.call('default', roomIdInput);
      callRef.current = call;
      await call.join({ create: true });
      await call.camera.disable();
      await call.microphone.enable();

      const sync = () => syncParticipants(call);
      const events = [
        'call.session_participant_joined',
        'call.session_participant_left',
        'call.updated',
        'call.session_started',
      ];
      for (const event of events) {
        const unsubscribe = call.on(event as never, sync);
        listenersRef.current.push(unsubscribe);
      }

      const unsubscribeChat = call.on('custom', (event) => {
        const custom = event as unknown as CustomEvent;
        if (custom.custom?.type !== 'room-chat') return;
        const message = custom.custom.payload?.message;
        if (!message) return;
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          name: custom.custom?.user?.name || 'کاربر',
          message,
          time: Date.now(),
        }]);
      });
      listenersRef.current.push(unsubscribeChat);

      sync();
      setRoomId(roomIdInput);
      setName(nameInput);
      setSelfId(userId);
      setJoined(true);
      setConnecting(false);
    } catch (err) {
      console.error(err);
      setError('اتصال صوتی برقرار نشد. تنظیمات Stream را بررسی کنید.');
      setConnecting(false);
      await callRef.current?.leave().catch(() => {});
      await clientRef.current?.disconnectUser().catch(() => {});
      callRef.current = null;
      clientRef.current = null;
    }
  }, [syncParticipants]);

  const leave = useCallback(() => {
    listenersRef.current.forEach((unsubscribe) => unsubscribe());
    listenersRef.current = [];
    const call = callRef.current;
    callRef.current = null;
    if (call) void call.leave().catch(() => {});
    const client = clientRef.current;
    clientRef.current = null;
    if (client) void client.disconnectUser().catch(() => {});
    setJoined(false);
    setConnecting(false);
    setParticipants([]);
    setMessages([]);
    setMuted(false);
    setSelfSpeaking(false);
    setSelfId('');
  }, []);

  const toggleMute = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    if (muted) {
      await call.microphone.enable();
      setMuted(false);
    } else {
      await call.microphone.disable();
      setMuted(true);
    }
  }, [muted]);

  const sendMessage = useCallback((message: string) => {
    const call = callRef.current;
    if (!call || !message.trim()) return;
    void call.sendCustomEvent({
      type: 'room-chat',
      payload: { message: message.trim().slice(0, 1000) },
    }).catch(() => {});
  }, []);

  useEffect(() => () => leave(), [leave]);

  return { joined, connecting, participants, messages, muted, selfSpeaking, roomId, name, error, selfId, join, leave, toggleMute, sendMessage };
}
