'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, LogOut, MessageCircle, Mic, MicOff, Send, Users, VolumeX, X } from 'lucide-react';
import { ChatMessage, Participant, ReactionItem, SignalPayload } from '@/types/voice-chat';

type Props = { roomId: string; userName: string; onLeave: () => void };
type Status = 'connecting' | 'connected' | 'disconnected' | 'failed';
type SignalEnvelope = { id: string; from: string; to?: string; payload: SignalPayload; timestamp: number };

const TURN_URLS = (process.env.NEXT_PUBLIC_TURN_URL || '').split(',').map((x) => x.trim()).filter(Boolean);
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    ...(TURN_URLS.length && process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_CREDENTIAL
      ? [{ urls: TURN_URLS, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }]
      : []),
  ],
  iceCandidatePoolSize: 4,
};

const reactions = ['👏', '❤️', '🔥', '😂', '🎉', '👍'];

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '??';
}

function initiates(a: Participant, b: Participant) {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
  return a.id < b.id;
}

export default function VoiceRoomFixed({ roomId, userName, onLeave }: Props) {
  const [self, setSelf] = useState<Participant | null>(null);
  const [members, setMembers] = useState<Participant[]>([]);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [audioUnlock, setAudioUnlock] = useState(false);
  const [floating, setFloating] = useState<ReactionItem[]>([]);
  const [selfSpeaking, setSelfSpeaking] = useState(false);

  const selfRef = useRef<Participant | null>(null);
  const membersRef = useRef<Participant[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const candidateQueue = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingSignals = useRef(new Map<string, SignalEnvelope[]>());
  const seenSignals = useRef(new Set<string>());
  const lastSignal = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const offerLocks = useRef(new Set<string>());
  const reconnectTimers = useRef(new Map<string, number>());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speakingRafs = useRef<number[]>([]);

  const updateMembers = useCallback((next: Participant[]) => {
    const unique = [...new Map(next.map((p) => [p.id, p])).values()];
    membersRef.current = unique;
    setMembers(unique);
  }, []);

  const setStatus = useCallback((id: string, value: Status) => {
    setStatuses((s) => ({ ...s, [id]: value }));
  }, []);

  const attachSpeakingDetector = useCallback((stream: MediaStream, onSpeak: (value: boolean) => void) => {
    try {
      const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current || new Ctx();
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
        const next = sum / data.length > 14;
        if (next !== current) { current = next; onSpeak(next); }
        raf = requestAnimationFrame(tick);
      };
      tick();
      speakingRafs.current.push(raf);
      return () => cancelAnimationFrame(raf);
    } catch {
      return undefined;
    }
  }, []);

  const signal = useCallback(async (payload: SignalPayload, toId?: string) => {
    const fromId = selfRef.current?.id;
    if (!fromId || stopped.current) return false;
    try {
      const r = await fetch('/api/room/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ roomId, fromId, toId, payload }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }, [roomId]);

  const destroyPeer = useCallback((id: string) => {
    const pc = peersRef.current.get(id);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(id);
    }
    candidateQueue.current.delete(id);
    offerLocks.current.delete(id);
    const el = audioRef.current.get(id);
    if (el) { el.pause(); el.srcObject = null; el.remove(); }
    audioRef.current.delete(id);
  }, []);

  const createPeerConnection = useCallback((remote: Participant) => {
    const existing = peersRef.current.get(remote.id);
    if (existing && existing.signalingState !== 'closed') return existing;
    const stream = streamRef.current;
    if (!stream) throw new Error('microphone stream is not ready');
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(remote.id, pc);
    setStatus(remote.id, 'connecting');

    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || peersRef.current.get(remote.id) !== pc) return;
      void signal({ type: 'ice-candidate', from: selfRef.current?.id || '', to: remote.id, candidate: candidate.toJSON() }, remote.id);
    };

    pc.ontrack = ({ streams, track }) => {
      if (peersRef.current.get(remote.id) !== pc) return;
      const remoteStream = streams[0] || new MediaStream([track]);
      let el = audioRef.current.get(remote.id);
      if (!el) {
        el = document.createElement('audio');
        el.autoplay = true;
        el.setAttribute('playsinline', 'true');
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        audioRef.current.set(remote.id, el);
      }
      el.srcObject = remoteStream;
      el.muted = deafened;
      attachSpeakingDetector(remoteStream, (speaking) => {
        setMembers((prev) => prev.map((p) => p.id === remote.id ? { ...p, isSpeaking: speaking } : p));
        membersRef.current = membersRef.current.map((p) => p.id === remote.id ? { ...p, isSpeaking: speaking } : p);
      });
      el.play().then(() => setAudioUnlock(false)).catch(() => setAudioUnlock(true));
    };

    const updateConnection = () => {
      if (peersRef.current.get(remote.id) !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus(remote.id, 'connected');
      else if (state === 'connecting' || pc.iceConnectionState === 'checking') setStatus(remote.id, 'connecting');
      else if (state === 'disconnected') setStatus(remote.id, 'disconnected');
      else if (state === 'failed' || pc.iceConnectionState === 'failed') {
        setStatus(remote.id, 'failed');
        if (selfRef.current && initiates(selfRef.current, remote) && !reconnectTimers.current.has(remote.id)) {
          const t = window.setTimeout(() => {
            reconnectTimers.current.delete(remote.id);
            destroyPeer(remote.id);
            void makeOffer(remote, true);
          }, 1000);
          reconnectTimers.current.set(remote.id, t);
        }
      }
    };
    pc.onconnectionstatechange = updateConnection;
    pc.oniceconnectionstatechange = updateConnection;
    return pc;
  }, [attachSpeakingDetector, deafened, destroyPeer, setStatus, signal]);

  const flushCandidates = useCallback(async (id: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queued = candidateQueue.current.get(id) || [];
    candidateQueue.current.delete(id);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
    }
  }, []);

  const makeOffer = useCallback(async (remote: Participant, iceRestart = false) => {
    const local = selfRef.current;
    if (!local || stopped.current || !initiates(local, remote) || offerLocks.current.has(remote.id)) return;
    let pc = peersRef.current.get(remote.id);
    if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'failed') {
      destroyPeer(remote.id);
      pc = createPeerConnection(remote);
    }
    if (pc.signalingState !== 'stable') return;
    offerLocks.current.add(remote.id);
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      if (!pc.localDescription) return;
      await signal({ type: 'sdp-offer', from: local.id, to: remote.id, sdp: pc.localDescription }, remote.id);
    } catch {
      destroyPeer(remote.id);
    } finally {
      offerLocks.current.delete(remote.id);
    }
  }, [createPeerConnection, destroyPeer, signal]);

  const handleSignal = useCallback(async (item: SignalEnvelope) => {
    const local = selfRef.current;
    if (!local || stopped.current || item.from === local.id) return;
    const payload = item.payload;
    if (payload.type === 'join') {
      const p = payload.participant;
      updateMembers([...membersRef.current.filter((x) => x.id !== p.id), p]);
      if (initiates(local, p)) void makeOffer(p);
      return;
    }
    if (payload.type === 'leave') {
      destroyPeer(payload.participantId);
      updateMembers(membersRef.current.filter((p) => p.id !== payload.participantId));
      return;
    }
    if (payload.type === 'state-update') {
      updateMembers(membersRef.current.map((p) => p.id === payload.participantId ? { ...p, ...payload.updates } : p));
      return;
    }
    if (payload.type === 'chat-message') {
      setMessages((prev) => prev.some((m) => m.id === payload.id) ? prev : [...prev.slice(-99), { id: payload.id, from: payload.from, senderName: payload.senderName, text: payload.text, timestamp: payload.timestamp }]);
      return;
    }
    if (payload.type === 'reaction') {
      const item2 = { id: payload.id, from: payload.from, emoji: payload.emoji, xOffset: 10 + Math.random() * 80 };
      setFloating((prev) => [...prev.slice(-12), item2]);
      window.setTimeout(() => setFloating((prev) => prev.filter((x) => x.id !== item2.id)), 3000);
      return;
    }

    const remote = membersRef.current.find((p) => p.id === item.from);
    if (!remote) {
      const q = pendingSignals.current.get(item.from) || [];
      q.push(item);
      pendingSignals.current.set(item.from, q.slice(-20));
      return;
    }

    if (payload.type === 'ice-candidate') {
      const pc = peersRef.current.get(item.from) || createPeerConnection(remote);
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate); } catch { /* stale candidate */ }
      } else {
        const q = candidateQueue.current.get(item.from) || [];
        q.push(payload.candidate);
        candidateQueue.current.set(item.from, q);
      }
      return;
    }

    if (payload.type === 'sdp-offer') {
      if (initiates(local, remote)) return;
      let pc = peersRef.current.get(item.from);
      if (!pc || pc.signalingState === 'closed') pc = createPeerConnection(remote);
      try {
        if (pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' });
        if (pc.signalingState !== 'stable') return;
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(item.from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) await signal({ type: 'sdp-answer', from: local.id, to: item.from, sdp: pc.localDescription }, item.from);
      } catch {
        destroyPeer(item.from);
      }
      return;
    }

    if (payload.type === 'sdp-answer') {
      const pc = peersRef.current.get(item.from);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(item.from, pc);
      } catch {
        destroyPeer(item.from);
      }
    }
  }, [createPeerConnection, destroyPeer, flushCandidates, makeOffer, signal, updateMembers]);

  const processPending = useCallback(async (id: string) => {
    const items = pendingSignals.current.get(id);
    if (!items?.length) return;
    pendingSignals.current.delete(id);
    for (const item of items) await handleSignal(item);
  }, [handleSignal]);

  const heartbeat = useCallback(async () => {
    const local = selfRef.current;
    if (!local || stopped.current) return;
    try {
      const r = await fetch('/api/room/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ roomId, participantId: local.id, lastSignalTimestamp: lastSignal.current, updates: { isMuted: muted, isDeafened: deafened } }),
      });
      if (!r.ok) throw new Error(`heartbeat ${r.status}`);
      const data = await r.json() as { signals?: SignalEnvelope[]; currentMembers?: Participant[] };
      const next = (data.currentMembers || []).filter((p) => p.id !== local.id);
      updateMembers(next);
      for (const remote of next) await processPending(remote.id);
      const signals = [...(data.signals || [])].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
      let maxTimestamp = lastSignal.current;
      for (const item of signals) {
        if (seenSignals.current.has(item.id)) continue;
        await handleSignal(item);
        seenSignals.current.add(item.id);
        maxTimestamp = Math.max(maxTimestamp, item.timestamp);
      }
      lastSignal.current = Math.max(0, maxTimestamp - 1);
      for (const remote of next) {
        if (initiates(local, remote) && !peersRef.current.has(remote.id)) void makeOffer(remote);
      }
    } catch (e) {
      console.warn('[WebRTC] heartbeat error', e);
    }
    if (!stopped.current) timer.current = setTimeout(() => void heartbeat(), 1000);
  }, [deafened, handleSignal, makeOffer, muted, processPending, roomId, updateMembers]);

  const leave = useCallback(async () => {
    if (stopped.current) return;
    stopped.current = true;
    if (timer.current) clearTimeout(timer.current);
    reconnectTimers.current.forEach((t) => window.clearTimeout(t));
    reconnectTimers.current.clear();
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioRef.current.forEach((el) => { el.pause(); el.srcObject = null; el.remove(); });
    audioRef.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    speakingRafs.current.forEach((raf) => cancelAnimationFrame(raf));
    speakingRafs.current = [];
    if (audioCtxRef.current) { await audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    const id = selfRef.current?.id;
    if (id) {
      await fetch('/api/room/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, participantId: id }) }).catch(() => {});
    }
    setMembers([]);
    setSelf(null);
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        attachSpeakingDetector(stream, setSelfSpeaking);
        const participantId = crypto.randomUUID();
        const r = await fetch('/api/room/join', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
          body: JSON.stringify({ roomId, participantId, name: userName }),
        });
        if (!r.ok) throw new Error(`join ${r.status}`);
        const data = await r.json() as { self: Participant; others: Participant[] };
        if (cancelled) return;
        selfRef.current = data.self;
        setSelf(data.self);
        updateMembers(data.others || []);
        lastSignal.current = data.self.joinedAt - 1;
        setLoading(false);
        for (const remote of data.others || []) if (initiates(data.self, remote)) void makeOffer(remote);
        await signal({ type: 'join', participant: data.self });
        void heartbeat();
      } catch (e) {
        console.error('[WebRTC] join failed', e);
        setError(e instanceof Error && e.message.includes('NotAllowed') ? 'دسترسی میکروفون داده نشد.' : 'ورود به اتاق صوتی ناموفق بود.');
        setLoading(false);
      }
    };
    void start();
    return () => { cancelled = true; void leave(); };
  }, [attachSpeakingDetector, heartbeat, leave, makeOffer, roomId, signal, updateMembers, userName]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const toggleMute = useCallback(async () => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track || !selfRef.current) return;
    const next = !track.enabled;
    track.enabled = next;
    setMuted(!next);
    await signal({ type: 'state-update', participantId: selfRef.current.id, updates: { isMuted: !next } });
  }, [signal]);

  const toggleDeaf = useCallback(async () => {
    const next = !deafened;
    setDeafened(next);
    audioRef.current.forEach((el) => { el.muted = next; });
    if (selfRef.current) await signal({ type: 'state-update', participantId: selfRef.current.id, updates: { isDeafened: next } });
  }, [deafened, signal]);

  const sendChat = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const textValue = text.trim();
    if (!textValue || !selfRef.current) return;
    const msg: SignalPayload = { type: 'chat-message', id: crypto.randomUUID(), from: selfRef.current.id, senderName: selfRef.current.name, text: textValue, timestamp: Date.now() };
    setMessages((m) => [...m.slice(-99), { ...msg } as ChatMessage]);
    setText('');
    await signal(msg);
  }, [signal, text]);

  const sendReaction = useCallback(async (emoji: string) => {
    if (!selfRef.current) return;
    const msg: SignalPayload = { type: 'reaction', id: crypto.randomUUID(), from: selfRef.current.id, emoji, timestamp: Date.now() };
    await signal(msg);
  }, [signal]);

  if (loading) return <main className="min-h-screen bg-slate-950 p-6 text-white"><div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center"><div className="text-center"><div className="loader-ring mx-auto mb-5" /><b>در حال اتصال به اتاق...</b>{error && <div className="mt-3 text-sm text-red-300">{error}</div>}</div></div></main>;

  const all = self ? [self, ...members.filter((p) => p.id !== self.id)] : members;

  return <div className="min-h-screen bg-slate-950 px-3 pb-28 pt-5 text-white sm:px-6">
    <header className="mx-auto mb-5 flex max-w-5xl items-center justify-between"><div><div className="text-xs text-white/35">VOICE ROOM</div><h1 className="mt-1 text-xl font-bold">{roomId}</h1></div><div className="flex items-center gap-2 text-xs text-white/45"><Users className="h-4 w-4" /> {all.length}</div></header>
    {error && <div className="mx-auto mb-4 max-w-5xl rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}
    {audioUnlock && <button onClick={() => audioRef.current.forEach((el) => void el.play())} className="mx-auto mb-4 block rounded-xl bg-indigo-500 px-4 py-2 text-sm">فعال‌کردن صدای دریافتی</button>}
    <main className="glass-panel mx-auto min-h-[420px] max-w-5xl rounded-[2rem] p-3 sm:p-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{all.map((p) => { const local = p.id === self?.id; const status = local ? 'connected' : statuses[p.id]; const mutedNow = local ? muted : p.isMuted; return <article key={p.id} className={`participant-card ${local ? 'is-self' : ''}`}><div className={`avatar ${local ? 'avatar-self' : ''} ${mutedNow ? 'is-muted' : ''}`}><span>{initials(p.name)}</span>{!mutedNow && (local ? selfSpeaking : p.isSpeaking) && <span className="speaking-ring" />}</div><div className="mt-4 truncate text-sm font-bold">{p.name}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/35">{mutedNow ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3 text-emerald-300" />}{local ? 'شما' : status === 'connected' ? 'متصل به Voice' : status === 'failed' ? 'اتصال ناموفق' : 'در حال اتصال...'}</div></article>; })}</div></main>
    <div className="fixed bottom-[84px] left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-black/30 p-1.5 backdrop-blur-xl">{reactions.map((e) => <button key={e} onClick={() => void sendReaction(e)} className="reaction-btn">{e}</button>)}</div>
    <div className="glass-controls fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto flex max-w-xl items-center justify-center gap-2 sm:gap-3"><button onClick={() => void toggleMute()} className={`control-btn primary ${muted ? 'danger' : ''}`}>{muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}<span>{muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</span></button><button onClick={() => void toggleDeaf()} className={`control-btn square ${deafened ? 'active' : ''}`}>{deafened ? <VolumeX className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}</button><button onClick={() => setChatOpen((v) => !v)} className="control-btn square"><MessageCircle className="h-5 w-5" /></button><button onClick={() => void leave().finally(onLeave)} className="control-btn leave"><LogOut className="h-5 w-5" /><span className="hidden sm:inline">خروج</span></button></div></div>
    {floating.map((x) => <div key={x.id} className="floating-reaction" style={{ left: `${x.xOffset}%` }}>{x.emoji}</div>)}
    {chatOpen && <><button aria-label="بستن چت" onClick={() => setChatOpen(false)} className="fixed inset-0 z-50 bg-black/45" /><aside className="chat-drawer fixed bottom-0 left-0 top-0 z-[60] flex w-full max-w-[390px] flex-col border-r border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-3xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><b className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> چت اتاق</b><button onClick={() => setChatOpen(false)} className="icon-btn"><X className="h-4 w-4" /></button></div><div className="flex-1 overflow-y-auto p-4">{messages.map((m) => <div key={m.id} className="mb-4"><div className="mb-1 text-[10px] text-white/35">{m.senderName}</div><div className="rounded-2xl border border-white/10 bg-white/[.06] px-3.5 py-2.5 text-xs leading-5">{m.text}</div></div>)}</div><form onSubmit={sendChat} className="border-t border-white/10 p-3"><div className="flex gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5"><input value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" placeholder="پیام..." /><button className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500 disabled:opacity-30" disabled={!text.trim()}><Send className="h-4 w-4" /></button></div></form></aside></>}
  </div>;
}
