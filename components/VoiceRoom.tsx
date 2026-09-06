'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Mic, MicOff, Users, Volume2, VolumeX } from 'lucide-react';
import { Participant, SignalPayload } from '@/types/voice-chat';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

interface Props { roomId: string; userName: string; onLeave: () => void; }

function shouldInitiate(a: Participant, b: Participant) {
  return a.joinedAt !== b.joinedAt ? a.joinedAt < b.joinedAt : a.id < b.id;
}

export default function VoiceRoom({ roomId, userName, onLeave }: Props) {
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [connecting, setConnecting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState('');
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);

  const selfRef = useRef<Participant | null>(null);
  const participantsRef = useRef<Participant[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastSignalRef = useRef(0);
  const stoppedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muteRef = useRef(false);
  const deafenRef = useRef(false);
  const offeringRef = useRef<Set<string>>(new Set());
  const handleSignalRef = useRef<(payload: SignalPayload, fromId: string) => Promise<void>>(async () => {});

  const replaceParticipants = useCallback((next: Participant[]) => {
    participantsRef.current = next;
    setParticipants(next);
  }, []);

  const sendSignal = useCallback(async (payload: SignalPayload, toId?: string) => {
    const fromId = selfRef.current?.id;
    if (!fromId || stoppedRef.current) return;
    try {
      await fetch('/api/room/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, fromId, toId, payload }),
        cache: 'no-store',
      });
    } catch {}
  }, [roomId]);

  const closePeer = useCallback((id: string) => {
    const pc = peersRef.current.get(id);
    if (pc) pc.close();
    peersRef.current.delete(id);
    pendingRef.current.delete(id);
    offeringRef.current.delete(id);
    const audio = audioRef.current.get(id);
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    audioRef.current.delete(id);
  }, []);

  const createPeer = useCallback((remote: Participant) => {
    const old = peersRef.current.get(remote.id);
    if (old && old.signalingState !== 'closed') return old;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(remote.id, pc);
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));

    pc.onicecandidate = (event) => {
      if (event.candidate) void sendSignal({ type: 'ice-candidate', from: selfRef.current?.id || '', to: remote.id, candidate: event.candidate.toJSON() }, remote.id);
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      let audio = audioRef.current.get(remote.id);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.volume = 1;
        audioRef.current.set(remote.id, audio);
        document.body.appendChild(audio);
      }
      audio.srcObject = stream;
      audio.muted = deafenRef.current;
      void audio.play().catch(() => setNeedsAudioUnlock(true));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') closePeer(remote.id);
    };
    return pc;
  }, [closePeer, sendSignal]);

  const offer = useCallback(async (remote: Participant) => {
    const local = selfRef.current;
    if (!local || !shouldInitiate(local, remote) || offeringRef.current.has(remote.id)) return;
    offeringRef.current.add(remote.id);
    try {
      let pc = peersRef.current.get(remote.id);
      if (!pc || pc.signalingState === 'closed') pc = createPeer(remote);
      if (!pc || pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription) await sendSignal({ type: 'sdp-offer', from: local.id, to: remote.id, sdp: pc.localDescription }, remote.id);
    } catch { closePeer(remote.id); }
    finally { offeringRef.current.delete(remote.id); }
  }, [closePeer, createPeer, sendSignal]);

  const flush = useCallback(async (id: string, pc: RTCPeerConnection) => {
    const candidates = pendingRef.current.get(id) || [];
    pendingRef.current.delete(id);
    for (const candidate of candidates) { try { await pc.addIceCandidate(candidate); } catch {} }
  }, []);

  const handleSignal = useCallback(async (payload: SignalPayload, fromId: string) => {
    const local = selfRef.current;
    if (!local || stoppedRef.current || fromId === local.id) return;

    if (payload.type === 'join') {
      const next = participantsRef.current.some((p) => p.id === payload.participant.id) ? participantsRef.current : [...participantsRef.current, payload.participant];
      replaceParticipants(next);
      if (shouldInitiate(local, payload.participant)) await offer(payload.participant);
      return;
    }
    if (payload.type === 'leave') {
      replaceParticipants(participantsRef.current.filter((p) => p.id !== payload.participantId));
      closePeer(payload.participantId);
      return;
    }
    if (payload.type === 'state-update') {
      replaceParticipants(participantsRef.current.map((p) => p.id === payload.participantId ? { ...p, ...payload.updates } : p));
      return;
    }

    const remote = participantsRef.current.find((p) => p.id === fromId);
    if (payload.type === 'ice-candidate') {
      let pc = peersRef.current.get(fromId);
      if (!pc && remote) pc = createPeer(remote);
      if (!pc) return;
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate); } catch {}
      } else {
        pendingRef.current.set(fromId, [...(pendingRef.current.get(fromId) || []), payload.candidate]);
      }
      return;
    }
    if (payload.type === 'sdp-offer') {
      if (!remote || !shouldInitiate(remote, local)) return;
      let pc = peersRef.current.get(fromId);
      if (!pc) pc = createPeer(remote);
      if (!pc || pc.signalingState !== 'stable') return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flush(fromId, pc);
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc.localDescription) await sendSignal({ type: 'sdp-answer', from: local.id, to: fromId, sdp: pc.localDescription }, fromId);
      } catch { closePeer(fromId); }
      return;
    }
    if (payload.type === 'sdp-answer') {
      const pc = peersRef.current.get(fromId);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try { await pc.setRemoteDescription(payload.sdp); await flush(fromId, pc); } catch { closePeer(fromId); }
    }
  }, [closePeer, createPeer, flush, offer, replaceParticipants, sendSignal]);

  handleSignalRef.current = handleSignal;

  const heartbeat = useCallback(async () => {
    const local = selfRef.current;
    if (!local || stoppedRef.current) return;
    try {
      const response = await fetch('/api/room/heartbeat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, participantId: local.id, lastSignalTimestamp: lastSignalRef.current, updates: { isMuted: muteRef.current, isDeafened: deafenRef.current } }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('heartbeat failed');
      const data = await response.json() as { signals?: Array<{ from: string; payload: SignalPayload; timestamp: number }>; currentMembers?: Participant[] };
      for (const signal of data.signals || []) {
        lastSignalRef.current = Math.max(lastSignalRef.current, signal.timestamp);
        await handleSignalRef.current(signal.payload, signal.from);
      }
      const members = (data.currentMembers || []).filter((p) => p.id !== local.id);
      replaceParticipants(members);
      for (const remote of members) {
        if (shouldInitiate(local, remote)) {
          const pc = peersRef.current.get(remote.id);
          if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') void offer(remote);
        }
      }
    } catch {}
    if (!stoppedRef.current) pollTimerRef.current = setTimeout(() => void heartbeat(), 700);
  }, [offer, replaceParticipants, roomId]);

  useEffect(() => {
    let active = true;
    stoppedRef.current = false;
    const start = async () => {
      try {
        const key = `aura-voice-id:${roomId}`;
        let id = sessionStorage.getItem(key);
        if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
        const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active) { media.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = media;
        const response = await fetch('/api/room/join', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId: id, name: userName }), cache: 'no-store',
        });
        const data = await response.json() as { self?: Participant; others?: Participant[]; error?: string };
        if (!response.ok || !data.self) throw new Error(data.error || 'ورود به اتاق ناموفق بود');
        selfRef.current = data.self;
        setSelf(data.self);
        replaceParticipants(data.others || []);
        setConnecting(false);
        lastSignalRef.current = Date.now();
        for (const remote of data.others || []) if (shouldInitiate(data.self, remote)) void offer(remote);
        await heartbeat();
      } catch (err) {
        if (!active) return;
        setConnecting(false);
        setError(err instanceof Error ? err.message : 'اتصال صوتی برقرار نشد');
      }
    };
    void start();
    return () => {
      active = false;
      stoppedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      audioRef.current.forEach((audio) => { audio.pause(); audio.srcObject = null; audio.remove(); });
      audioRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      const id = selfRef.current?.id;
      if (id) void fetch('/api/room/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, participantId: id }), keepalive: true }).catch(() => {});
    };
  }, [heartbeat, offer, replaceParticipants, roomId, userName]);

  const toggleMute = () => {
    const next = !muteRef.current;
    muteRef.current = next; setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
  };
  const toggleDeafened = () => {
    const next = !deafenRef.current;
    deafenRef.current = next; setDeafened(next);
    audioRef.current.forEach((a) => { a.muted = next; });
  };
  const unlockAudio = async () => {
    let failed = false;
    for (const audio of audioRef.current.values()) { audio.muted = deafenRef.current; try { await audio.play(); } catch { failed = true; } }
    setNeedsAudioUnlock(failed);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-white/10 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div><div className="text-xs text-white/50">Voice دست‌ساز • بدون API Key</div><div className="font-semibold text-lg">{roomId}</div></div>
        <div className="text-sm text-white/60">{participants.length + (self ? 1 : 0)} نفر</div>
      </header>
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-8 flex flex-col justify-center">
        {error && <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-red-100"><b>خطا</b><div className="text-sm mt-1">{error}</div></div>}
        {needsAudioUnlock && <button onClick={() => void unlockAudio()} type="button" className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100">برای فعال شدن صدای دریافتی کلیک کن</button>}
        {connecting ? <div className="text-center text-white/50 py-16">در حال اتصال به اتاق...</div> : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...(self ? [self] : []), ...participants].map((p) => {
            const local = p.id === self?.id;
            const isMuted = local ? muted : p.isMuted;
            return <div key={p.id} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 min-h-40 flex flex-col justify-between">
              <div className="flex items-center justify-between"><div className="w-12 h-12 rounded-full bg-indigo-500/20 border border-indigo-300/20 flex items-center justify-center text-lg font-bold">{p.name.slice(0, 1).toUpperCase()}</div>{isMuted ? <MicOff className="w-5 h-5 text-white/40" /> : <Mic className="w-5 h-5 text-emerald-300" />}</div>
              <div><div className="font-semibold truncate">{p.name}{local ? ' (شما)' : ''}</div><div className="text-xs text-white/40 mt-1">{isMuted ? 'میکروفون خاموش' : 'میکروفون روشن'}</div></div>
            </div>;
          })}
        </div>}
        {!connecting && participants.length === 0 && <div className="text-center text-white/40 mt-8"><Users className="w-9 h-9 mx-auto mb-2 opacity-50" />فعلاً فقط خودت در اتاق هستی</div>}
      </main>
      <footer className="border-t border-white/10 bg-slate-950/95 p-4 flex justify-center gap-3 sticky bottom-0">
        <button onClick={toggleMute} type="button" className="px-5 py-3 rounded-full bg-white/10 flex items-center gap-2">{muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}{muted ? 'روشن کردن میکروفون' : 'خاموش کردن میکروفون'}</button>
        <button onClick={toggleDeafened} type="button" className="p-3 rounded-full bg-white/10" aria-label="قطع صدا">{deafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}</button>
        <button onClick={onLeave} type="button" className="px-5 py-3 rounded-full bg-red-500/80 flex items-center gap-2"><LogOut className="w-5 h-5" />خروج</button>
      </footer>
    </div>
  );
}
