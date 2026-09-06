'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Participant = { id: string; name: string; speaking: boolean };
type Message = { id: string; name: string; message: string; time: number };
type SignalData = { type: 'offer' | 'answer' | 'candidate'; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audioElsRef = useRef(new Map<string, HTMLAudioElement>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speakingCleanupsRef = useRef(new Map<string, () => void>());

  const setSpeakingFor = useCallback((id: string, speaking: boolean) => {
    setParticipants((prev) => prev.map((p) => p.id === id ? { ...p, speaking } : p));
  }, []);

  const attachSpeakingDetector = useCallback((stream: MediaStream, onSpeak: (v: boolean) => void) => {
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return undefined;
      const ctx = audioCtxRef.current || new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let current = false;
      let raf = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i];
        const speaking = sum / data.length > 14;
        if (speaking !== current) { current = speaking; onSpeak(speaking); }
        raf = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(raf);
    } catch { return undefined; }
  }, []);

  const createPeerConnection = useCallback((peerId: string) => {
    const existing = peersRef.current.get(peerId);
    if (existing && existing.signalingState !== 'closed') return existing;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) socketRef.current?.emit('signal', { to: peerId, data: { type: 'candidate', candidate: e.candidate.toJSON() } satisfies SignalData });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      let audio = audioElsRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioElsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      speakingCleanupsRef.current.get(peerId)?.();
      const cleanup = attachSpeakingDetector(stream, (v) => setSpeakingFor(peerId, v));
      if (cleanup) speakingCleanupsRef.current.set(peerId, cleanup);
    };
    peersRef.current.set(peerId, pc);
    return pc;
  }, [attachSpeakingDetector, setSpeakingFor]);

  const join = useCallback(async (roomIdInput: string, nameInput: string) => {
    setError('');
    setConnecting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      const cleanup = attachSpeakingDetector(stream, setSelfSpeaking);
      if (cleanup) speakingCleanupsRef.current.set('__self__', cleanup);
    } catch {
      setError('دسترسی به میکروفون داده نشد. برای ورود به گفتگوی صوتی، اجازهٔ میکروفون لازم است.');
      setConnecting(false);
      return;
    }

    const socket = io({ path: '/socket.io' });
    socketRef.current = socket;
    setRoomId(roomIdInput);
    setName(nameInput);

    socket.on('connect', () => {
      setSelfId(socket.id);
      socket.emit('join-room', { roomId: roomIdInput, name: nameInput });
      setJoined(true);
      setConnecting(false);
    });
    socket.on('connect_error', () => {
      setError('اتصال به سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
      setConnecting(false);
    });
    socket.on('existing-users', async (users: Array<{ id: string; name: string }>) => {
      setParticipants(users.map((u) => ({ ...u, speaking: false })));
      for (const user of users) {
        const pc = createPeerConnection(user.id);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', { to: user.id, data: { type: 'offer', sdp: offer } satisfies SignalData });
        } catch {}
      }
    });
    socket.on('user-joined', ({ id, name: peerName }: { id: string; name: string }) => {
      setParticipants((prev) => prev.some((p) => p.id === id) ? prev : [...prev, { id, name: peerName, speaking: false }]);
    });
    socket.on('user-left', ({ id }: { id: string }) => {
      peersRef.current.get(id)?.close();
      peersRef.current.delete(id);
      speakingCleanupsRef.current.get(id)?.();
      speakingCleanupsRef.current.delete(id);
      const audio = audioElsRef.current.get(id);
      if (audio) { audio.srcObject = null; audio.remove(); audioElsRef.current.delete(id); }
      setParticipants((prev) => prev.filter((p) => p.id !== id));
    });
    socket.on('signal', async ({ from, data }: { from: string; data: SignalData }) => {
      let pc = peersRef.current.get(from);
      try {
        if (data.type === 'offer') {
          if (!pc) pc = createPeerConnection(from);
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } satisfies SignalData });
        } else if (data.type === 'answer') {
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === 'candidate') {
          if (pc && data.candidate) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch {}
    });
    socket.on('chat-message', (msg: Message) => setMessages((prev) => [...prev, msg]));
  }, [attachSpeakingDetector, createPeerConnection]);

  const leave = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElsRef.current.forEach((el) => { el.srcObject = null; el.remove(); });
    audioElsRef.current.clear();
    speakingCleanupsRef.current.forEach((cleanup) => cleanup());
    speakingCleanupsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    socketRef.current?.emit('leave-room');
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (audioCtxRef.current) { void audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    setJoined(false); setConnecting(false); setParticipants([]); setMessages([]); setMuted(false); setSelfSpeaking(false); setSelfId('');
  }, []);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const sendMessage = useCallback((message: string) => {
    if (!socketRef.current || !message.trim()) return;
    socketRef.current.emit('chat-message', { message: message.trim() });
  }, []);

  useEffect(() => () => leave(), [leave]);

  return { joined, connecting, participants, messages, muted, selfSpeaking, roomId, name, error, selfId, join, leave, toggleMute, sendMessage };
}
