'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StreamVideoClient, type Call, type CallSessionResponse } from '@stream-io/video-react-sdk';

type Participant = { id: string; name: string; speaking: boolean };
type Message = { id: string; name: string; message: string; time: number };

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
    const selfId = userIdRef.current;
    const values = Array.from(call.state.participants.values()).map((p) => ({
      id: p.user.id,
      name: p.user.name || 'کاربر',
      speaking: Boolean(p.isSpeaking),
    }));
    setParticipants(values.filter((p) => p.id !== selfId));
    const me = values.find((p) => p.id === selfId);
    setSelfSpeaking(Boolean(me?.speaking));
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
        'call.member_added',
        'call.member_removed',
        'call.stats_report',
      ];
      for (const event of events) {
        const unsubscribe = call.on(event as never, sync);
        listenersRef.current.push(unsubscribe);
      }

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
    void call.sendCustomEvent({ type: 'room-chat', message: message.trim().slice(0, 1000) }).catch(() => {});
  }, []);

  useEffect(() => {
    const call = callRef.current;
    if (!call) return;
    const onChat = (event: { custom?: { type?: string; message?: string; user?: { id?: string; name?: string } } }) => {
      if (event.custom?.type !== 'room-chat' || !event.custom.message) return;
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        name: event.custom?.user?.name || 'کاربر',
        message: event.custom.message,
        time: Date.now(),
      }]);
    };
    const unsubscribe = call.on('custom', onChat as never);
    return unsubscribe;
  }, [joined]);

  useEffect(() => () => leave(), [leave]);

  return { joined, connecting, participants, messages, muted, selfSpeaking, roomId, name, error, selfId, join, leave, toggleMute, sendMessage };
}
