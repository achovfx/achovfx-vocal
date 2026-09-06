'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Copy,
  Headphones,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Radio,
  Send,
  Users,
  VolumeX,
  X,
} from 'lucide-react';
import { Participant, SignalPayload, ChatMessage, ReactionItem } from '@/types/voice-chat';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

interface Props { roomId: string; userName: string; onLeave: () => void; }

const REACTIONS = ['👏', '❤️', '🔥', '😂', '🎉', '👍'];

type PeerStatus = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed';

function shouldInitiate(a: Participant, b: Participant) {
  if (a.joinOrder !== b.joinOrder) return a.joinOrder < b.joinOrder;
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
  return a.id < b.id;
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '??';
}

export default function VoiceRoom({ roomId, userName, onLeave }: Props) {
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerStatus>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [connecting, setConnecting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState('');
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [copied, setCopied] = useState(false);

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
  const offerRef = useRef<(remote: Participant, iceRestart?: boolean) => Promise<void>>(async () => {});
  const handleSignalRef = useRef<(payload: SignalPayload, fromId: string) => Promise<void>>(async () => {});
  const messagesRef = useRef<HTMLDivElement>(null);

  const replaceParticipants = useCallback((next: Participant[]) => {
    const unique = Array.from(new Map(next.map((p) => [p.id, p])).values());
    participantsRef.current = unique;
    setParticipants(unique);
  }, []);

  const setPeerStatus = useCallback((id: string, status: PeerStatus) => {
    setPeerStatuses((current) => ({ ...current, [id]: status }));
  }, []);

  const sendSignal = useCallback(async (payload: SignalPayload, toId?: string) => {
    const fromId = selfRef.current?.id;
    if (!fromId || stoppedRef.current) return;
    try {
      const response = await fetch('/api/room/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, fromId, toId, payload }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('signal failed');
    } catch {
      // Heartbeat will retry the connection when necessary.
    }
  }, [roomId]);

  const closePeer = useCallback((id: string) => {
    peersRef.current.get(id)?.close();
    peersRef.current.delete(id);
    pendingRef.current.delete(id);
    offeringRef.current.delete(id);
    const audio = audioRef.current.get(id);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    audioRef.current.delete(id);
    setPeerStatus(id, 'failed');
  }, [setPeerStatus]);

  const createPeer = useCallback((remote: Participant) => {
    const existing = peersRef.current.get(remote.id);
    if (existing && existing.signalingState !== 'closed') return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peersRef.current.set(remote.id, pc);
    setPeerStatus(remote.id, 'connecting');

    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendSignal({
        type: 'ice-candidate',
        from: selfRef.current?.id || '',
        to: remote.id,
        candidate: event.candidate.toJSON(),
      }, remote.id);
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0] || new MediaStream([event.track]);
      let audio = audioRef.current.get(remote.id);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute('aria-hidden', 'true');
        audio.volume = 1;
        audioRef.current.set(remote.id, audio);
        document.body.appendChild(audio);
      }
      audio.srcObject = remoteStream;
      audio.muted = deafenRef.current;
      void audio.play().then(() => setNeedsAudioUnlock(false)).catch(() => setNeedsAudioUnlock(true));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') setPeerStatus(remote.id, 'connected');
      else if (state === 'connecting') setPeerStatus(remote.id, 'connecting');
      else if (state === 'disconnected') setPeerStatus(remote.id, 'disconnected');
      else if (state === 'failed') {
        setPeerStatus(remote.id, 'failed');
        closePeer(remote.id);
        if (selfRef.current && shouldInitiate(selfRef.current, remote)) {
          window.setTimeout(() => void offerRef.current(remote, true), 700);
        }
      } else if (state === 'closed') {
        setPeerStatus(remote.id, 'failed');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setPeerStatus(remote.id, 'connected');
      } else if (pc.iceConnectionState === 'checking') {
        setPeerStatus(remote.id, 'connecting');
      } else if (pc.iceConnectionState === 'disconnected') {
        setPeerStatus(remote.id, 'disconnected');
      } else if (pc.iceConnectionState === 'failed') {
        if (selfRef.current && shouldInitiate(selfRef.current, remote)) {
          window.setTimeout(() => void offerRef.current(remote, true), 500);
        }
      }
    };

    return pc;
  }, [closePeer, sendSignal, setPeerStatus]);

  const flushCandidates = useCallback(async (id: string, pc: RTCPeerConnection) => {
    const candidates = pendingRef.current.get(id) || [];
    pendingRef.current.delete(id);
    for (const candidate of candidates) {
      try { await pc.addIceCandidate(candidate); } catch {}
    }
  }, []);

  const offer = useCallback(async (remote: Participant, iceRestart = false) => {
    const local = selfRef.current;
    if (!local || stoppedRef.current || !shouldInitiate(local, remote)) return;
    if (offeringRef.current.has(remote.id)) return;

    offeringRef.current.add(remote.id);
    try {
      let pc = peersRef.current.get(remote.id);
      if (!pc || pc.signalingState === 'closed') pc = createPeer(remote);
      if (!pc) return;

      if (pc.signalingState !== 'stable') {
        if (iceRestart && pc.signalingState === 'stable') pc.restartIce();
        return;
      }

      if (iceRestart) pc.restartIce();
      const description = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(description);
      if (pc.localDescription) {
        await sendSignal({
          type: 'sdp-offer',
          from: local.id,
          to: remote.id,
          sdp: pc.localDescription,
        }, remote.id);
      }
    } catch {
      closePeer(remote.id);
    } finally {
      offeringRef.current.delete(remote.id);
    }
  }, [closePeer, createPeer, sendSignal]);

  offerRef.current = offer;

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => current.some((item) => item.id === message.id)
      ? current
      : [...current.slice(-99), message]);
  }, []);

  const handleSignal = useCallback(async (payload: SignalPayload, fromId: string) => {
    const local = selfRef.current;
    if (!local || stoppedRef.current || fromId === local.id) return;

    if (payload.type === 'join') {
      const next = participantsRef.current.some((p) => p.id === payload.participant.id)
        ? participantsRef.current.map((p) => p.id === payload.participant.id ? payload.participant : p)
        : [...participantsRef.current, payload.participant];
      replaceParticipants(next);
      if (shouldInitiate(local, payload.participant)) await offer(payload.participant);
      return;
    }

    if (payload.type === 'leave') {
      replaceParticipants(participantsRef.current.filter((p) => p.id !== payload.participantId));
      closePeer(payload.participantId);
      setPeerStatuses((current) => {
        const next = { ...current };
        delete next[payload.participantId];
        return next;
      });
      return;
    }

    if (payload.type === 'state-update') {
      replaceParticipants(participantsRef.current.map((p) => p.id === payload.participantId ? { ...p, ...payload.updates } : p));
      return;
    }

    if (payload.type === 'chat-message') {
      addMessage({
        id: payload.id,
        from: payload.from,
        senderName: payload.senderName,
        text: payload.text,
        timestamp: payload.timestamp,
      });
      return;
    }

    if (payload.type === 'reaction') {
      const item: ReactionItem = {
        id: payload.id,
        from: payload.from,
        emoji: payload.emoji,
        xOffset: 10 + Math.random() * 80,
      };
      setReactions((current) => [...current.slice(-12), item]);
      window.setTimeout(() => setReactions((current) => current.filter((r) => r.id !== item.id)), 3200);
      return;
    }

    let remote = participantsRef.current.find((p) => p.id === fromId);
    if (!remote) {
      remote = {
        id: fromId,
        name: 'کاربر',
        joinOrder: Number.MAX_SAFE_INTEGER,
        color: '#6366f1',
        isMuted: false,
        isDeafened: false,
        isCameraOn: false,
        isScreenSharing: false,
        isSpeaking: false,
        joinedAt: Date.now(),
        lastHeartbeat: Date.now(),
      };
    }

    if (payload.type === 'ice-candidate') {
      let pc = peersRef.current.get(fromId);
      if (!pc) pc = createPeer(remote);
      if (!pc) return;
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(payload.candidate); } catch {}
      } else {
        pendingRef.current.set(fromId, [...(pendingRef.current.get(fromId) || []), payload.candidate]);
      }
      return;
    }

    if (payload.type === 'sdp-offer') {
      let pc = peersRef.current.get(fromId);
      if (!pc) pc = createPeer(remote);
      if (!pc) return;

      try {
        if (pc.signalingState !== 'stable') {
          if (shouldInitiate(local, remote)) return;
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(fromId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          await sendSignal({
            type: 'sdp-answer',
            from: local.id,
            to: fromId,
            sdp: pc.localDescription,
          }, fromId);
        }
      } catch {
        closePeer(fromId);
      }
      return;
    }

    if (payload.type === 'sdp-answer') {
      const pc = peersRef.current.get(fromId);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flushCandidates(fromId, pc);
      } catch {
        closePeer(fromId);
      }
    }
  }, [addMessage, closePeer, createPeer, flushCandidates, offer, replaceParticipants, sendSignal]);

  handleSignalRef.current = handleSignal;

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
          updates: { isMuted: muteRef.current, isDeafened: deafenRef.current },
        }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('heartbeat failed');

      const data = await response.json() as {
        signals?: Array<{ from: string; payload: SignalPayload; timestamp: number }>;
        currentMembers?: Participant[];
      };

      for (const signal of data.signals || []) {
        lastSignalRef.current = Math.max(lastSignalRef.current, signal.timestamp);
        await handleSignalRef.current(signal.payload, signal.from);
      }

      const members = (data.currentMembers || []).filter((p) => p.id !== local.id);
      replaceParticipants(members);

      for (const remote of members) {
        if (!shouldInitiate(local, remote)) continue;
        const pc = peersRef.current.get(remote.id);
        if (!pc || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          void offer(remote);
        }
      }
    } catch {
      // The next heartbeat retries automatically.
    }

    if (!stoppedRef.current) pollTimerRef.current = setTimeout(() => void heartbeat(), 1000);
  }, [offer, replaceParticipants, roomId]);

  useEffect(() => {
    let active = true;
    stoppedRef.current = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('مرورگر شما از میکروفون پشتیبانی نمی‌کند');

        const key = `aura-voice-id:${roomId}`;
        let id = sessionStorage.getItem(key);
        if (!id) {
          id = crypto.randomUUID();
          sessionStorage.setItem(key, id);
        }

        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (!active) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = media;

        const response = await fetch('/api/room/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId: id, name: userName }),
          cache: 'no-store',
        });
        const data = await response.json() as { self?: Participant; others?: Participant[]; error?: string };
        if (!response.ok || !data.self) throw new Error(data.error || 'ورود به اتاق ناموفق بود');

        selfRef.current = data.self;
        setSelf(data.self);
        replaceParticipants(data.others || []);
        setConnecting(false);

        // Start just after joining so we don't miss fresh SDP/ICE signals.
        lastSignalRef.current = Date.now() - 1000;
        for (const remote of data.others || []) {
          if (shouldInitiate(data.self, remote)) void offer(remote);
        }
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
      audioRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      });
      audioRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      const id = selfRef.current?.id;
      if (id) {
        void fetch('/api/room/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId: id }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [heartbeat, offer, replaceParticipants, roomId, userName]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chatOpen]);

  const toggleMute = () => {
    const next = !muteRef.current;
    muteRef.current = next;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
  };

  const toggleDeafened = () => {
    const next = !deafenRef.current;
    deafenRef.current = next;
    setDeafened(next);
    audioRef.current.forEach((audio) => { audio.muted = next; });
  };

  const unlockAudio = async () => {
    let failed = false;
    for (const audio of audioRef.current.values()) {
      audio.muted = deafenRef.current;
      try { await audio.play(); } catch { failed = true; }
    }
    setNeedsAudioUnlock(failed);
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = messageText.trim();
    if (!text || !selfRef.current) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      from: selfRef.current.id,
      senderName: selfRef.current.name,
      text: text.slice(0, 1000),
      timestamp: Date.now(),
    };
    addMessage(message);
    void sendSignal({ type: 'chat-message', ...message });
    setMessageText('');
  };

  const sendReaction = (emoji: string) => {
    const id = crypto.randomUUID();
    const item: ReactionItem = {
      id,
      from: selfRef.current?.id || '',
      emoji,
      xOffset: 10 + Math.random() * 80,
    };
    setReactions((current) => [...current.slice(-12), item]);
    window.setTimeout(() => setReactions((current) => current.filter((r) => r.id !== id)), 3200);
    void sendSignal({ type: 'reaction', id, from: selfRef.current?.id || '', emoji, timestamp: Date.now() });
  };

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };

  const allParticipants = [...(self ? [self] : []), ...participants];
  const connectedCount = Object.values(peerStatuses).filter((status) => status === 'connected').length;

  return (
    <div dir="rtl" className="voice-app min-h-screen overflow-hidden bg-[#070b16] text-white">
      <div className="voice-bg" aria-hidden="true"><span /><span /><span /></div>

      <header className="glass-header relative z-20 flex h-16 shrink-0 items-center justify-between px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="brand-mark"><Radio className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight">AchoVocal</span>
              <span className="live-pill"><i /> زنده</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/40">
              <span className="max-w-36 truncate sm:max-w-64">اتاق {roomId}</span>
              <button onClick={() => void copyRoom()} className="rounded p-1 hover:bg-white/10" title="کپی لینک اتاق"><Copy className="h-3 w-3" /></button>
              {copied && <span className="text-emerald-300">کپی شد</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="member-count"><Users className="h-3.5 w-3.5" /> {allParticipants.length}</div>
          <button onClick={() => setChatOpen(true)} className="icon-btn relative" title="چت">
            <MessageCircle className="h-4 w-4" />
            {messages.length > 0 && <span className="chat-badge">{messages.length > 99 ? '99+' : messages.length}</span>}
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-128px)] w-full max-w-6xl flex-col px-3 py-5 sm:px-7 sm:py-7">
        {error && <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}
        {needsAudioUnlock && <button onClick={() => void unlockAudio()} className="mb-4 w-full rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">برای فعال شدن صدای دریافتی کلیک کنید</button>}

        <section className="mb-5 flex items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-300/80">Voice room</div>
            <h1 className="text-2xl font-black tracking-tight sm:text-4xl">با هم صحبت کنید<span className="text-indigo-300">.</span></h1>
            <p className="mt-1.5 max-w-xl text-xs leading-6 text-white/40 sm:text-sm">گفتگوی صوتی گروهی، سریع و سبک؛ بدون ویدیو و بدون سرویس پولی.</p>
          </div>
          <div className="hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left sm:block">
            <div className="text-[10px] text-white/35">وضعیت اتصال</div>
            <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-emerald-300"><span className="status-dot" /> {connectedCount > 0 ? `${connectedCount} اتصال صوتی فعال` : 'در انتظار اتصال صوتی'}</div>
          </div>
        </section>

        {connecting ? (
          <div className="glass-panel flex min-h-[420px] flex-1 items-center justify-center rounded-[2rem]">
            <div className="text-center"><div className="loader-ring mx-auto mb-5" /><div className="font-semibold">در حال اتصال به اتاق...</div><div className="mt-2 text-xs text-white/35">درخواست دسترسی به میکروفون و برقراری ارتباط امن</div></div>
          </div>
        ) : (
          <section className="glass-panel min-h-[420px] flex-1 rounded-[2rem] p-3 sm:p-5">
            {allParticipants.length === 0 ? <div className="flex h-full min-h-[390px] items-center justify-center text-center text-white/35">هیچ عضوی در اتاق نیست.</div> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {allParticipants.map((participant, index) => {
                  const local = participant.id === self?.id;
                  const isMuted = local ? muted : participant.isMuted;
                  const status = local ? 'connected' : peerStatuses[participant.id];
                  return (
                    <article key={participant.id} className={`participant-card ${local ? 'is-self' : ''}`}>
                      <div className="card-top">
                        <span className="role-label">{local ? 'شما' : index === 1 ? 'مهمان' : 'عضو'}</span>
                        <MoreHorizontal className="h-4 w-4 text-white/25" />
                      </div>
                      <div className={`avatar ${local ? 'avatar-self' : ''} ${isMuted ? 'is-muted' : ''}`}>
                        <span>{initials(participant.name)}</span>
                        {!isMuted && status === 'connected' && <span className="speaking-ring" />}
                      </div>
                      <div className="mt-4 min-w-0">
                        <div className="truncate text-sm font-bold">{participant.name}</div>
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/35">
                          {isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3 text-emerald-300" />}
                          {isMuted ? 'میکروفون خاموش' : status === 'connected' ? 'متصل به Voice' : status === 'connecting' ? 'در حال اتصال...' : 'اتصال ناموفق'}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      <div className="reaction-tray fixed bottom-[84px] left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-black/30 p-1.5 backdrop-blur-xl">
        {REACTIONS.map((emoji) => <button key={emoji} onClick={() => sendReaction(emoji)} className="reaction-btn" aria-label={`ارسال ${emoji}`}>{emoji}</button>)}
      </div>

      <div className="glass-controls fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="mx-auto flex max-w-xl items-center justify-center gap-2 sm:gap-3">
          <button onClick={toggleMute} className={`control-btn primary ${muted ? 'danger' : ''}`}>
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            <span>{muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</span>
          </button>
          <button onClick={toggleDeafened} className={`control-btn square ${deafened ? 'active' : ''}`} title={deafened ? 'فعال کردن صدا' : 'قطع صدای دریافتی'}>
            {deafened ? <VolumeX className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}
          </button>
          <button onClick={() => setChatOpen((open) => !open)} className={`control-btn square ${chatOpen ? 'active' : ''}`} title="چت"><MessageCircle className="h-5 w-5" /></button>
          <button onClick={onLeave} className="control-btn leave" title="خروج از اتاق"><LogOut className="h-5 w-5" /><span className="hidden sm:inline">خروج</span></button>
        </div>
      </div>

      {reactions.map((reaction) => <div key={reaction.id} className="floating-reaction" style={{ left: `${reaction.xOffset}%` }}>{reaction.emoji}</div>)}

      {chatOpen && <>
        <button aria-label="بستن چت" onClick={() => setChatOpen(false)} className="fixed inset-0 z-50 cursor-default bg-black/45 backdrop-blur-[2px]" />
        <aside className="chat-drawer fixed bottom-0 left-0 top-0 z-[60] flex w-full max-w-[390px] flex-col border-r border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-3xl">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div><div className="flex items-center gap-2 font-bold"><MessageCircle className="h-4 w-4 text-indigo-300" /> چت اتاق</div><div className="mt-1 text-[10px] text-white/35">{messages.length} پیام</div></div>
            <button onClick={() => setChatOpen(false)} className="icon-btn"><X className="h-4 w-4" /></button>
          </div>
          <div ref={messagesRef} className="flex-1 overflow-y-auto p-4">
            {messages.length === 0 ? <div className="flex h-full items-center justify-center text-center text-xs leading-6 text-white/30">هنوز پیامی نیست.<br />گفتگو را شروع کنید ✨</div> : messages.map((message) => {
              const mine = message.from === self?.id;
              return <div key={message.id} className={`mb-4 flex flex-col ${mine ? 'items-start' : 'items-end'}`}>
                <span className="mb-1 px-1 text-[10px] text-white/35">{message.senderName}</span>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 ${mine ? 'rounded-tr-md border border-indigo-300/15 bg-indigo-500/25' : 'rounded-tl-md border border-white/10 bg-white/[0.07]'}`}>{message.text}</div>
                <time className="mt-1 px-1 text-[9px] text-white/20">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
              </div>;
            })}
          </div>
          <form onSubmit={sendChat} className="border-t border-white/10 bg-white/[0.025] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5 focus-within:border-indigo-400/40">
              <input value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={1000} placeholder="پیام خود را بنویسید..." className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/25" />
              <button type="submit" disabled={!messageText.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:opacity-25"><Send className="h-4 w-4 rotate-180" /></button>
            </div>
          </form>
        </aside>
      </>}
    </div>
  );
}
