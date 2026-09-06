'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Mic, MicOff, Users, Volume2, VolumeX } from 'lucide-react';
import { Participant, SignalPayload } from '@/types/voice-chat';

const RTC_CONFIG: RTCConfiguration = {
  // Public STUN only: no API key and no paid service.
  // WebRTC still works directly between peers when a direct ICE path is available.
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
};

interface VoiceRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
}

function shouldInitiate(local: Participant, remote: Participant) {
  if (local.joinedAt !== remote.joinedAt) return local.joinedAt < remote.joinedAt;
  return local.id < remote.id;
}

export default function VoiceRoom({ roomId, userName, onLeave }: VoiceRoomProps) {
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [audioNeedsUnlock, setAudioNeedsUnlock] = useState(false);
  const [error, setError] = useState('');

  const selfRef = useRef<Participant | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const lastSignalRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const startingPeersRef = useRef<Set<string>>(new Set());
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);

  const updateSelf = useCallback((next: Participant) => {
    selfRef.current = next;
    setSelf(next);
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
    } catch {
      // Polling will recover from transient signaling failures.
    }
  }, [roomId]);

  const closePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    startingPeersRef.current.delete(peerId);

    const audio = audioRef.current.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      audioRef.current.delete(peerId);
    }
  }, []);

  const flushCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(peerId) || [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates from an old ICE generation.
      }
    }
  }, []);

  const createPeer = useCallback((remote: Participant) => {
    const existing = peersRef.current.get(remote.id);
    if (existing && existing.signalingState !== 'closed') return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(remote.id, pc);

    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) {
        pc.addTrack(track, localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendSignal(
        {
          type: 'ice-candidate',
          from: selfRef.current?.id || '',
          to: remote.id,
          candidate: event.candidate.toJSON(),
        },
        remote.id
      );
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
      audio.muted = deafenedRef.current;
      void audio.play().catch(() => setAudioNeedsUnlock(true));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'closed') {
        closePeer(remote.id);
      }
    };

    return pc;
  }, [closePeer, sendSignal]);

  const makeOffer = useCallback(async (remote: Participant) => {
    const local = selfRef.current;
    if (!local || !shouldInitiate(local, remote) || startingPeersRef.current.has(remote.id)) return;

    startingPeersRef.current.add(remote.id);
    try {
      let pc = peersRef.current.get(remote.id);
      if (!pc || pc.signalingState === 'closed') pc = createPeer(remote);
      if (!pc || pc.signalingState !== 'stable') return;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (pc.localDescription) {
        await sendSignal(
          {
            type: 'sdp-offer',
            from: local.id,
            to: remote.id,
            sdp: pc.localDescription,
          },
          remote.id
        );
      }
    } catch (err) {
      console.warn('Voice offer failed', err);
      closePeer(remote.id);
    } finally {
      startingPeersRef.current.delete(remote.id);
    }
  }, [closePeer, createPeer, sendSignal]);

  const handleSignal = useCallback(async (payload: SignalPayload, fromId: string) => {
    const local = selfRef.current;
    if (!local || fromId === local.id || stoppedRef.current) return;

    if (payload.type === 'join') {
      setParticipants((prev) => prev.some((p) => p.id === payload.participant.id) ? prev : [...prev, payload.participant]);
      if (shouldInitiate(local, payload.participant)) {
        await makeOffer(payload.participant);
      }
      return;
    }

    if (payload.type === 'leave') {
      setParticipants((prev) => prev.filter((p) => p.id !== payload.participantId));
      closePeer(payload.participantId);
      return;
    }

    if (payload.type === 'state-update') {
      setParticipants((prev) => prev.map((p) => p.id === payload.participantId ? { ...p, ...payload.updates } : p));
      return;
    }

    if (payload.type === 'ice-candidate') {
      let pc = peersRef.current.get(fromId);
      if (!pc || pc.signalingState === 'closed') {
        const remote = participants.find((p) => p.id === fromId);
        if (remote) pc = createPeer(remote);
      }
      if (!pc) return;

      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch {
          // Candidate can belong to an obsolete negotiation.
        }
      } else {
        const queued = pendingCandidatesRef.current.get(fromId) || [];
        queued.push(payload.candidate);
        pendingCandidatesRef.current.set(fromId, queued);
      }
      return;
    }

    if (payload.type === 'sdp-offer') {
      // Only the deterministic older peer may offer. This prevents offer glare.
      const remote = participants.find((p) => p.id === fromId);
      if (!remote || !shouldInitiate(remote, local)) return;

      let pc = peersRef.current.get(fromId);
      if (!pc || pc.signalingState === 'closed') pc = createPeer(remote);
      if (!pc) return;

      try {
        if (pc.signalingState !== 'stable') return;
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(fromId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          await sendSignal(
            {
              type: 'sdp-answer',
              from: local.id,
              to: fromId,
              sdp: pc.localDescription,
            },
            fromId
          );
        }
      } catch (err) {
        console.warn('Voice offer handling failed', err);
        closePeer(fromId);
      }
      return;
    }

    if (payload.type === 'sdp-answer') {
      const pc = peersRef.current.get(fromId);
      if (!pc) return;
      try {
        if (pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(fromId, pc);
      } catch (err) {
        console.warn('Voice answer handling failed', err);
        closePeer(fromId);
      }
    }
  }, [closePeer, createPeer, flushCandidates, makeOffer, participants, sendSignal]);

  const heartbeat = useCallback(async () => {
    const local = selfRef.current;
    if (!local || stoppedRef.current) return;

    try {
      const response = await fetch('/api/room/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          participantId: local.id,
          lastSignalTimestamp: lastSignalRef.current,
          updates: { isMuted: mutedRef.current, isDeafened: deafenedRef.current },
        }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('heartbeat failed');
      const data = await response.json() as { signals?: Array<{ id: string; from: string; payload: SignalPayload; timestamp: number }>; currentMembers?: Participant[] };

      for (const signal of data.signals || []) {
        lastSignalRef.current = Math.max(lastSignalRef.current, signal.timestamp);
        await handleSignal(signal.payload, signal.from);
      }

      const members = (data.currentMembers || []).filter((p) => p.id !== local.id);
      setParticipants(members);

      for (const remote of members) {
        if (shouldInitiate(local, remote)) {
          const pc = peersRef.current.get(remote.id);
          if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            void makeOffer(remote);
          }
        }
      }
    } catch {
      // Keep the call alive through transient polling failures.
    }

    if (!stoppedRef.current) {
      pollTimerRef.current = setTimeout(() => void heartbeat(), 700);
    }
  }, [handleSignal, makeOffer, roomId]);

  useEffect(() => {
    let active = true;
    stoppedRef.current = false;

    async function start() {
      try {
        setError('');
        const participantIdKey = `aura-voice-id:${roomId}`;
        let participantId = sessionStorage.getItem(participantIdKey);
        if (!participantId) {
          participantId = crypto.randomUUID();
          sessionStorage.setItem(participantIdKey, participantId);
        }

        const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = media;

        const joinResponse = await fetch('/api/room/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId, name: userName }),
          cache: 'no-store',
        });
        const joinData = await joinResponse.json() as { self?: Participant; others?: Participant[]; error?: string };
        if (!joinResponse.ok || !joinData.self) throw new Error(joinData.error || 'ورود به اتاق ناموفق بود');

        updateSelf(joinData.self);
        setParticipants(joinData.others || []);
        setIsConnecting(false);

        // Only the deterministic older participant starts the offer.
        for (const remote of joinData.others || []) {
          if (shouldInitiate(joinData.self, remote)) void makeOffer(remote);
        }

        lastSignalRef.current = Date.now();
        await heartbeat();
      } catch (err) {
        if (!active) return;
        setIsConnecting(false);
        setError(err instanceof Error ? err.message : 'اتصال صوتی برقرار نشد');
      }
    }

    void start();

    return () => {
      active = false;
      stoppedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      audioRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      });
      audioRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;

      const participantId = selfRef.current?.id;
      if (participantId) {
        void fetch('/api/room/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [heartbeat, makeOffer, roomId, updateSelf, userName]);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setIsMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  const toggleDeafened = () => {
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setIsDeafened(next);
    audioRef.current.forEach((audio) => { audio.muted = next; });
  };

  const unlockAudio = async () => {
    let failed = false;
    for (const audio of audioRef.current.values()) {
      audio.muted = deafenedRef.current;
      try { await audio.play(); } catch { failed = true; }
    }
    setAudioNeedsUnlock(failed);
  };

  const leave = () => onLeave();

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-white/10 px-4 sm:px-8 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs text-white/50">اتاق صوتی دست‌ساز</div>
          <div className="font-semibold text-lg">{roomId}</div>
        </div>
        <div className="text-sm text-white/60">{participants.length + (self ? 1 : 0)} نفر</div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-8 flex flex-col justify-center">
        {error && (
          <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-red-100">
            <div className="font-semibold mb-1">اتصال برقرار نشد</div>
            <div className="text-sm text-red-100/70">{error}</div>
          </div>
        )}

        {audioNeedsUnlock && (
          <button onClick={() => void unlockAudio()} type="button" className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100 text-sm">
            برای فعال شدن صدای دریافتی اینجا کلیک کن
          </button>
        )}

        {isConnecting ? (
          <div className="text-center text-white/50 py-16">در حال اتصال به اتاق...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...(self ? [self] : []), ...participants].map((participant) => {
              const local = participant.id === self?.id;
              const muted = local ? isMuted : participant.isMuted;
              return (
                <div key={participant.id} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 min-h-40 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="w-12 h-12 rounded-full bg-indigo-500/20 border border-indigo-300/20 flex items-center justify-center text-lg font-bold">
                      {participant.name.slice(0, 1).toUpperCase()}
                    </div>
                    {muted ? <MicOff className="w-5 h-5 text-white/40" /> : <Mic className="w-5 h-5 text-emerald-300" />}
                  </div>
                  <div>
                    <div className="font-semibold truncate">{participant.name}{local ? ' (شما)' : ''}</div>
                    <div className="text-xs text-white/40 mt-1">{muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isConnecting && participants.length === 0 && (
          <div className="text-center text-white/40 mt-8"><Users className="w-9 h-9 mx-auto mb-2 opacity-50" />فعلاً فقط خودت در اتاق هستی</div>
        )}
      </main>

      <footer className="border-t border-white/10 bg-slate-950/95 p-4 flex justify-center gap-3 sticky bottom-0">
        <button onClick={toggleMute} type="button" className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 transition flex items-center gap-2">
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          {isMuted ? 'روشن کردن میکروفون' : 'خاموش کردن میکروفون'}
        </button>
        <button onClick={toggleDeafened} type="button" className="p-3 rounded-full bg-white/10 hover:bg-white/15 transition" aria-label="قطع صدای دریافتی">
          {isDeafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <button onClick={leave} type="button" className="px-5 py-3 rounded-full bg-red-500/80 hover:bg-red-500 transition flex items-center gap-2">
          <LogOut className="w-5 h-5" /> خروج
        </button>
      </footer>
    </div>
  );
}
