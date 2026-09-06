'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Headphones, LogOut, MessageCircle, Mic, MicOff, Radio, Send, Users, VolumeX, X } from 'lucide-react';
import { ChatMessage, Participant, ReactionItem, SignalPayload } from '@/types/voice-chat';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
    ...(process.env.NEXT_PUBLIC_TURN_URL && process.env.NEXT_PUBLIC_TURN_USERNAME && process.env.NEXT_PUBLIC_TURN_CREDENTIAL
      ? [{ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }]
      : [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }]),
  ],
  iceCandidatePoolSize: 4,
};

type Props = { roomId: string; userName: string; onLeave: () => void };
type Status = 'connecting' | 'connected' | 'disconnected' | 'failed';
type SignalEnvelope = { id: string; from: string; to?: string; payload: SignalPayload; timestamp: number };

const reactions = ['👏', '❤️', '🔥', '😂', '🎉', '👍'];

function initiates(a: Participant, b: Participant) {
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt;
  return a.id < b.id;
}

function initials(name: string) { return name.trim().slice(0, 2).toUpperCase() || '??'; }

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
  const [copied, setCopied] = useState(false);
  const [floating, setFloating] = useState<ReactionItem[]>([]);

  const selfRef = useRef<Participant | null>(null);
  const membersRef = useRef<Participant[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const candidateQueue = useRef(new Map<string, RTCIceCandidateInit[]>());
  const audio = useRef(new Map<string, HTMLAudioElement>());
  const lastSignal = useRef(0);
  const seenSignals = useRef(new Set<string>());
  const pendingSignals = useRef(new Map<string, SignalEnvelope[]>());
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerLocks = useRef(new Set<string>());
 const reconnectTimers = useRef<Map<string, number>>(new Map());
  const mutedRef = useRef(false);
  const deafenedRef = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const log = useCallback((event: string, ...args: unknown[]) => console.info(`[WebRTC] ${event}`, ...args), []);
  const updateMembers = useCallback((next: Participant[]) => { const unique = [...new Map(next.map(p => [p.id, p])).values()]; membersRef.current = unique; setMembers(unique); }, []);
  const setStatus = useCallback((id: string, value: Status) => setStatuses(s => ({ ...s, [id]: value })), []);

  const signal = useCallback(async (payload: SignalPayload, toId?: string) => {
    const fromId = selfRef.current?.id;
    if (!fromId || stopped.current) return false;
    try {
      const r = await fetch('/api/room/signal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ roomId, fromId, toId, payload }) });
      if (!r.ok) throw new Error(`signaling ${r.status}`);
      return true;
    } catch (e) { console.error('[WebRTC] signaling error', e); return false; }
  }, [roomId]);

  const destroyPeer = useCallback((id: string, expected?: RTCPeerConnection) => {
    const pc = peers.current.get(id);
    if (!pc || (expected && pc !== expected)) return;
    pc.onicecandidate = null; pc.ontrack = null; pc.onconnectionstatechange = null; pc.oniceconnectionstatechange = null; pc.onsignalingstatechange = null; pc.close();
    peers.current.delete(id); candidateQueue.current.delete(id); offerLocks.current.delete(id);
    const el = audio.current.get(id); if (el) { el.pause(); el.srcObject = null; el.remove(); }
    audio.current.delete(id); log('destroy peer', id);
  }, [log]);

  const flushCandidates = useCallback(async (id: string, pc: RTCPeerConnection) => {
    if (!pc.remoteDescription) return;
    const queued = candidateQueue.current.get(id) || []; candidateQueue.current.delete(id);
    for (const candidate of queued) { try { await pc.addIceCandidate(candidate); } catch (e) { console.warn('[WebRTC] queued ICE rejected', id, e); } }
  }, []);

  const makeOfferRef = useRef<(remote: Participant, iceRestart?: boolean) => Promise<void>>(async () => undefined);
  const reconnectRef = useRef<(id: string, remote: Participant) => void>(() => undefined);

  const createPeer = useCallback((remote: Participant) => {
    const existing = peers.current.get(remote.id); if (existing && existing.signalingState !== 'closed') return existing;
    const stream = streamRef.current; if (!stream) throw new Error('microphone stream is not ready');
    const pc = new RTCPeerConnection(RTC_CONFIG); peers.current.set(remote.id, pc); setStatus(remote.id, 'connecting');
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

    pc.onicecandidate = ({ candidate }) => { if (!candidate || peers.current.get(remote.id) !== pc) return; void signal({ type: 'ice-candidate', from: selfRef.current?.id || '', to: remote.id, candidate: candidate.toJSON() }, remote.id); };
    pc.ontrack = ({ streams, track }) => {
      if (peers.current.get(remote.id) !== pc) return;
      const remoteStream = streams[0] || new MediaStream([track]); let el = audio.current.get(remote.id);
      if (!el) { el = document.createElement('audio'); el.autoplay = true; el.setAttribute('playsinline', 'true'); el.setAttribute('aria-hidden', 'true'); document.body.appendChild(el); audio.current.set(remote.id, el); }
      el.srcObject = remoteStream; el.muted = deafenedRef.current; el.play().then(() => setAudioUnlock(false)).catch(() => setAudioUnlock(true));
    };
    pc.oniceconnectionstatechange = () => {
      if (peers.current.get(remote.id) !== pc) return;
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') setStatus(remote.id, 'connected');
      else if (pc.iceConnectionState === 'checking') setStatus(remote.id, 'connecting');
      else if (pc.iceConnectionState === 'disconnected') setStatus(remote.id, 'disconnected');
      else if (pc.iceConnectionState === 'failed') { setStatus(remote.id, 'failed'); if (selfRef.current && initiates(selfRef.current, remote)) reconnectRef.current(remote.id, remote); }
      log('ICE', remote.id, pc.iceConnectionState);
    };
    pc.onconnectionstatechange = () => {
      if (peers.current.get(remote.id) !== pc) return;
      if (pc.connectionState === 'connected') setStatus(remote.id, 'connected'); else if (pc.connectionState === 'connecting') setStatus(remote.id, 'connecting'); else if (pc.connectionState === 'disconnected') setStatus(remote.id, 'disconnected'); else if (pc.connectionState === 'failed') { setStatus(remote.id, 'failed'); if (selfRef.current && initiates(selfRef.current, remote)) reconnectRef.current(remote.id, remote); }
      log('connection', remote.id, pc.connectionState);
    };
    return pc;
  }, [log, setStatus, signal]);

  const makeOffer = useCallback(async (remote: Participant, iceRestart = false) => {
    const local = selfRef.current; if (!local || stopped.current || !initiates(local, remote) || offerLocks.current.has(remote.id)) return;
    let pc = peers.current.get(remote.id); if (!pc || pc.signalingState === 'closed' || pc.connectionState === 'failed') { destroyPeer(remote.id); pc = createPeer(remote); }
    if (pc.signalingState !== 'stable') return;
    offerLocks.current.add(remote.id);
    try { const offer = await pc.createOffer({ iceRestart }); if (peers.current.get(remote.id) !== pc) return; await pc.setLocalDescription(offer); if (!pc.localDescription) return; await signal({ type: 'sdp-offer', from: local.id, to: remote.id, sdp: pc.localDescription }, remote.id); }
    catch (e) { console.error('[WebRTC] offer error', remote.id, e); destroyPeer(remote.id, pc); }
    finally { offerLocks.current.delete(remote.id); }
  }, [createPeer, destroyPeer, signal]);
  useEffect(() => { makeOfferRef.current = makeOffer; }, [makeOffer]);

const scheduleReconnect = useCallback((id: string, remote: Participant) => {
  if (reconnectTimers.current.has(id) || stopped.current) return;

  const t = window.setTimeout(() => {
    reconnectTimers.current.delete(id);

    if (
      stopped.current ||
      !selfRef.current ||
      !initiates(selfRef.current, remote)
    ) {
      return;
    }

    destroyPeer(id);
    void makeOfferRef.current(remote, true);
  }, 1000);

  reconnectTimers.current.set(id, t);
}, [destroyPeer]);
  useEffect(() => { reconnectRef.current = scheduleReconnect; }, [scheduleReconnect]);

  const handleEnvelope = useCallback(async (item: SignalEnvelope) => {
    const local = selfRef.current; if (!local || stopped.current || item.from === local.id) return; const payload = item.payload;
    if (payload.type === 'join') { const p = payload.participant; updateMembers(membersRef.current.some(x => x.id === p.id) ? membersRef.current.map(x => x.id === p.id ? p : x) : [...membersRef.current, p]); if (initiates(local, p)) void makeOfferRef.current(p); return; }
    if (payload.type === 'leave') { updateMembers(membersRef.current.filter(p => p.id !== payload.participantId)); destroyPeer(payload.participantId); setStatuses(s => { const n = { ...s }; delete n[payload.participantId]; return n; }); return; }
    if (payload.type === 'state-update') { updateMembers(membersRef.current.map(p => p.id === payload.participantId ? { ...p, ...payload.updates } : p)); return; }
    if (payload.type === 'chat-message') { setMessages(m => m.some(x => x.id === payload.id) ? m : [...m.slice(-99), { id: payload.id, from: payload.from, senderName: payload.senderName, text: payload.text, timestamp: payload.timestamp }]); return; }
    if (payload.type === 'reaction') { const item = { id: payload.id, from: payload.from, emoji: payload.emoji, xOffset: 10 + Math.random() * 80 }; setFloating(r => [...r.slice(-12), item]); window.setTimeout(() => setFloating(r => r.filter(x => x.id !== item.id)), 3000); return; }

    const remote = membersRef.current.find(p => p.id === item.from);
    if (!remote) { const q = pendingSignals.current.get(item.from) || []; q.push(item); pendingSignals.current.set(item.from, q.slice(-50)); return; }
    if (payload.type === 'ice-candidate') {
      const pc = peers.current.get(item.from) || createPeer(remote);
      if (pc.remoteDescription) { try { await pc.addIceCandidate(payload.candidate); } catch (e) { console.warn('[WebRTC] ICE error', item.from, e); } }
      else { const q = candidateQueue.current.get(item.from) || []; if (!q.some(c => JSON.stringify(c) === JSON.stringify(payload.candidate))) q.push(payload.candidate); candidateQueue.current.set(item.from, q); }
      return;
    }
    if (payload.type === 'sdp-offer') {
      if (initiates(local, remote)) return;
      let pc = peers.current.get(item.from); if (!pc || pc.signalingState === 'closed') pc = createPeer(remote);
      try {
        if (pc.signalingState !== 'stable') { if (pc.signalingState === 'have-local-offer') await pc.setLocalDescription({ type: 'rollback' }); else return; }
        await pc.setRemoteDescription(payload.sdp); await flushCandidates(item.from, pc); await pc.setLocalDescription(await pc.createAnswer()); if (!pc.localDescription) return;
        await signal({ type: 'sdp-answer', from: local.id, to: item.from, sdp: pc.localDescription }, item.from);
      } catch (e) { console.error('[WebRTC] answer error', item.from, e); destroyPeer(item.from, pc); }
      return;
    }
    if (payload.type === 'sdp-answer') {
      const pc = peers.current.get(item.from); if (!pc || pc.signalingState !== 'have-local-offer') return;
      try { await pc.setRemoteDescription(payload.sdp); await flushCandidates(item.from, pc); } catch (e) { console.error('[WebRTC] remote answer error', item.from, e); destroyPeer(item.from, pc); }
    }
  }, [createPeer, destroyPeer, flushCandidates, signal, updateMembers]);

  const processPending = useCallback(async (id: string) => { const items = pendingSignals.current.get(id); if (!items?.length) return; pendingSignals.current.delete(id); for (const item of items) await handleEnvelope(item); }, [handleEnvelope]);

  const heartbeat = useCallback(async () => {
    const local = selfRef.current; if (!local || stopped.current) return;
    try {
      const r = await fetch('/api/room/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ roomId, participantId: local.id, lastSignalTimestamp: lastSignal.current, updates: { isMuted: mutedRef.current, isDeafened: deafenedRef.current } }) });
      if (!r.ok) throw new Error(`heartbeat ${r.status}`);
      const data = await r.json() as { signals?: SignalEnvelope[]; currentMembers?: Participant[] };
      const next = (data.currentMembers || []).filter(p => p.id !== local.id); updateMembers(next); for (const remote of next) await processPending(remote.id);
      const signals = [...(data.signals || [])].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
      let maxTimestamp = lastSignal.current;
      for (const item of signals) {
        if (seenSignals.current.has(item.id)) continue;
        try { await handleEnvelope(item); seenSignals.current.add(item.id); maxTimestamp = Math.max(maxTimestamp, item.timestamp); }
        catch (e) { console.error('[WebRTC] signal processing failed; retrying', item.id, e); break; }
      }
      // The API currently exposes a timestamp cursor, not an atomic Redis sequence cursor.
      // Keep one millisecond of overlap so two signals written in the same millisecond cannot be lost.
      lastSignal.current = Math.max(0, maxTimestamp - 1);
      if (seenSignals.current.size > 5000) seenSignals.current = new Set([...seenSignals.current].slice(-2500));
      for (const remote of next) if (initiates(local, remote)) { const pc = peers.current.get(remote.id); if (!pc || pc.signalingState === 'closed') void makeOfferRef.current(remote); }
    } catch (e) { console.warn('[WebRTC] heartbeat error', e); }
    if (!stopped.current) timer.current = setTimeout(() => void heartbeat(), 1000);
  }, [handleEnvelope, processPending, roomId, updateMembers]);

  useEffect(() => {
    stopped.current = false; let alive = true;
    const start = async () => {
      try {
        const key = `aura-voice-id:${roomId}`; let id = sessionStorage.getItem(key); if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
        const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); if (!alive) { media.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = media;
        const r = await fetch('/api/room/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ roomId, participantId: id, name: userName }) });
        const data = await r.json() as { self?: Participant; others?: Participant[]; error?: string }; if (!r.ok || !data.self) throw new Error(data.error || 'ورود به اتاق ناموفق بود');
        selfRef.current = data.self; setSelf(data.self); updateMembers(data.others || []);
        // Start one millisecond before our join so a signal written at the exact join timestamp is not skipped.
        lastSignal.current = Math.max(0, data.self.joinedAt - 1); setLoading(false);
        for (const remote of data.others || []) if (initiates(data.self, remote)) void makeOfferRef.current(remote);
        await heartbeat();
      } catch (e) { if (!alive) return; setLoading(false); setError(e instanceof Error ? e.message : 'اتصال صوتی برقرار نشد'); }
    };
    void start();
    return () => { alive = false; stopped.current = true; if (timer.current) clearTimeout(timer.current); reconnectTimers.current.forEach(t => clearTimeout(t)); reconnectTimers.current.clear(); peers.current.forEach(pc => pc.close()); peers.current.clear(); audio.current.forEach(el => { el.pause(); el.srcObject = null; el.remove(); }); audio.current.clear(); streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; const id = selfRef.current?.id; if (id) void fetch('/api/room/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, participantId: id }), keepalive: true }).catch(() => {}); };
  }, [heartbeat, roomId, updateMembers, userName]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, chatOpen]);
  const sendChat = (e: React.FormEvent) => { e.preventDefault(); const value = text.trim(); const me = selfRef.current; if (!value || !me) return; const message = { id: crypto.randomUUID(), from: me.id, senderName: me.name, text: value.slice(0, 1000), timestamp: Date.now() }; setMessages(m => [...m.slice(-99), message]); void signal({ type: 'chat-message', ...message }); setText(''); };
  const sendReaction = (emoji: string) => { const me = selfRef.current; if (!me) return; const id = crypto.randomUUID(); const item = { id, from: me.id, emoji, xOffset: 10 + Math.random() * 80 }; setFloating(r => [...r.slice(-12), item]); window.setTimeout(() => setFloating(r => r.filter(x => x.id !== id)), 3000); void signal({ type: 'reaction', id, from: me.id, emoji, timestamp: Date.now() }); };
  const unlock = async () => { let failed = false; for (const el of audio.current.values()) { el.muted = deafenedRef.current; try { await el.play(); } catch { failed = true; } } setAudioUnlock(failed); };
  const toggleMute = () => { const v = !mutedRef.current; mutedRef.current = v; setMuted(v); streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !v; }); };
  const toggleDeaf = () => { const v = !deafenedRef.current; deafenedRef.current = v; setDeafened(v); audio.current.forEach(el => { el.muted = v; }); };
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const all = self ? [self, ...members] : members; const connected = Object.values(statuses).filter(s => s === 'connected').length;

  return <div dir="rtl" className="voice-app min-h-screen overflow-hidden bg-[#070b16] text-white">
    <div className="voice-bg" aria-hidden="true"><span /><span /><span /></div>
    <header className="glass-header relative z-20 flex h-16 items-center justify-between px-4 sm:px-7"><div className="flex items-center gap-3"><div className="brand-mark"><Radio className="h-4 w-4" /></div><div><b>AchoVocal</b><div className="mt-0.5 flex items-center gap-1 text-[10px] text-white/40">اتاق {roomId}<button onClick={() => void copy()} className="rounded p-1 hover:bg-white/10"><Copy className="h-3 w-3" /></button>{copied && <span className="text-emerald-300">کپی شد</span>}</div></div></div><div className="flex items-center gap-2"><div className="member-count"><Users className="h-3.5 w-3.5" /> {all.length}</div><button onClick={() => setChatOpen(true)} className="icon-btn"><MessageCircle className="h-4 w-4" /></button></div></header>
    <main className="relative z-10 mx-auto flex min-h-[calc(100vh-128px)] w-full max-w-6xl flex-col px-3 py-5 sm:px-7 sm:py-7">
      {error && <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</div>}{audioUnlock && <button onClick={() => void unlock()} className="mb-4 w-full rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">برای فعال شدن صدای دریافتی کلیک کنید</button>}
      <div className="mb-5 flex items-end justify-between"><div><div className="mb-1 text-[11px] font-semibold uppercase tracking-[.22em] text-indigo-300/80">Voice room</div><h1 className="text-2xl font-black sm:text-4xl">با هم صحبت کنید<span className="text-indigo-300">.</span></h1><p className="mt-1.5 text-xs text-white/40 sm:text-sm">گفتگوی صوتی گروهی، سریع و سبک.</p></div><div className="hidden rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 sm:block"><div className="text-[10px] text-white/35">وضعیت اتصال</div><div className="mt-1 text-xs font-semibold text-emerald-300">{connected ? `${connected} اتصال صوتی فعال` : 'در انتظار اتصال صوتی'}</div></div></div>
      {loading ? <div className="glass-panel flex min-h-[420px] flex-1 items-center justify-center rounded-[2rem]"><div className="text-center"><div className="loader-ring mx-auto mb-5" /><b>در حال اتصال به اتاق...</b><div className="mt-2 text-xs text-white/35">در حال برقراری ارتباط صوتی</div></div></div> : <section className="glass-panel min-h-[420px] flex-1 rounded-[2rem] p-3 sm:p-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{all.map((p, i) => { const local = p.id === self?.id; const s = local ? 'connected' : statuses[p.id]; const mutedNow = local ? muted : p.isMuted; const label = local ? 'شما' : s === 'connected' ? 'متصل به Voice' : s === 'connecting' ? 'در حال اتصال...' : s === 'disconnected' ? 'قطع موقت' : 'اتصال ناموفق'; return <article key={p.id} className={`participant-card ${local ? 'is-self' : ''}`}><div className="card-top"><span className="role-label">{local ? 'شما' : i === 1 ? 'مهمان' : 'عضو'}</span></div><div className={`avatar ${local ? 'avatar-self' : ''} ${mutedNow ? 'is-muted' : ''}`}><span>{initials(p.name)}</span>{!mutedNow && s === 'connected' && <span className="speaking-ring" />}</div><div className="mt-4 truncate text-sm font-bold">{p.name}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/35">{mutedNow ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3 text-emerald-300" />}{mutedNow ? 'میکروفون خاموش' : label}</div></article>; })}</div></section>}
    </main>
    <div className="fixed bottom-[84px] left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-black/30 p-1.5 backdrop-blur-xl">{reactions.map(e => <button key={e} onClick={() => sendReaction(e)} className="reaction-btn">{e}</button>)}</div>
    <div className="glass-controls fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto flex max-w-xl items-center justify-center gap-2 sm:gap-3"><button onClick={toggleMute} className={`control-btn primary ${muted ? 'danger' : ''}`}>{muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}<span>{muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</span></button><button onClick={toggleDeaf} className={`control-btn square ${deafened ? 'active' : ''}`}>{deafened ? <VolumeX className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}</button><button onClick={() => setChatOpen(v => !v)} className="control-btn square"><MessageCircle className="h-5 w-5" /></button><button onClick={onLeave} className="control-btn leave"><LogOut className="h-5 w-5" /><span className="hidden sm:inline">خروج</span></button></div></div>
    {floating.map(x => <div key={x.id} className="floating-reaction" style={{ left: `${x.xOffset}%` }}>{x.emoji}</div>)}
    {chatOpen && <><button aria-label="بستن چت" onClick={() => setChatOpen(false)} className="fixed inset-0 z-50 bg-black/45" /><aside className="chat-drawer fixed bottom-0 left-0 top-0 z-[60] flex w-full max-w-[390px] flex-col border-r border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-3xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><b className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-indigo-300" /> چت اتاق</b><button onClick={() => setChatOpen(false)} className="icon-btn"><X className="h-4 w-4" /></button></div><div className="flex-1 overflow-y-auto p-4">{messages.map(m => <div key={m.id} className="mb-4"><div className="mb-1 text-[10px] text-white/35">{m.senderName}</div><div className="rounded-2xl border border-white/10 bg-white/[.06] px-3.5 py-2.5 text-xs leading-5">{m.text}</div></div>)}<div ref={messagesEnd} /></div><form onSubmit={sendChat} className="border-t border-white/10 p-3"><div className="flex gap-2 rounded-2xl border border-white/10 bg-black/20 p-1.5"><input value={text} onChange={e => setText(e.target.value)} className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" placeholder="پیام..." /><button className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500 disabled:opacity-30" disabled={!text.trim()}><Send className="h-4 w-4 rotate-180" /></button></div></form></aside></>}
  </div>;
}
