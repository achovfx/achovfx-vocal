'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Headphones, LogOut, MessageCircle, Mic, MicOff, Send, Users, VolumeX, X } from 'lucide-react';
import useVoiceChat from '@/lib/useVoiceChat';

type Props = { roomId: string; userName: string; onLeave: () => void };

function initials(name: string) { return name.trim().slice(0, 2).toUpperCase() || '??'; }

export default function VoiceRoomFixed({ roomId, userName, onLeave }: Props) {
  const voice = useVoiceChat();
  const [chatOpen, setChatOpen] = useState(false);
  const [text, setText] = useState('');
  const [deafened, setDeafened] = useState(false);

  useEffect(() => {
    void voice.join(roomId, userName);
    return () => voice.leave();
  }, [roomId, userName]);

  const sendChat = (e: FormEvent) => { e.preventDefault(); if (!text.trim()) return; voice.sendMessage(text); setText(''); };
  const toggleDeaf = () => { const next = !deafened; setDeafened(next); document.querySelectorAll('audio').forEach((el) => { el.muted = next; }); };
  const leaveRoom = () => { voice.leave(); onLeave(); };

  if (voice.connecting || !voice.joined) return <main className="min-h-screen bg-slate-950 p-6 text-white"><div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center"><div className="text-center"><div className="loader-ring mx-auto mb-5" /><b>{voice.error || 'در حال اتصال به اتاق...'}</b></div></div></main>;

  const all = [{ id: voice.selfId, name: userName, speaking: voice.selfSpeaking, self: true }, ...voice.participants.map((p) => ({ ...p, self: false }))];

  return <div className="min-h-screen bg-slate-950 px-3 pb-28 pt-5 text-white sm:px-6">
    <header className="mx-auto mb-5 flex max-w-5xl items-center justify-between"><div><div className="text-xs text-white/35">VOICE ROOM</div><h1 className="mt-1 text-xl font-bold">{roomId}</h1></div><div className="flex items-center gap-2 text-xs text-white/45"><Users className="h-4 w-4" /> {all.length}</div></header>
    {voice.error && <div className="mx-auto mb-4 max-w-5xl rounded-2xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{voice.error}</div>}
    <main className="glass-panel mx-auto min-h-[420px] max-w-5xl rounded-[2rem] p-3 sm:p-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{all.map((p) => <article key={p.id} className={`participant-card ${p.self ? 'is-self' : ''}`}><div className={`avatar ${p.self ? 'avatar-self' : ''} ${p.self && voice.muted ? 'is-muted' : ''}`}><span>{initials(p.name)}</span>{p.speaking && <span className="speaking-ring" />}</div><div className="mt-4 truncate text-sm font-bold">{p.name}</div><div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/35">{p.self && voice.muted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3 text-emerald-300" />}{p.self ? 'شما' : 'متصل به Voice'}</div></article>)}</div></main>
    <div className="glass-controls fixed bottom-0 left-0 right-0 z-40 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3"><div className="mx-auto flex max-w-xl items-center justify-center gap-2 sm:gap-3"><button onClick={voice.toggleMute} className={`control-btn primary ${voice.muted ? 'danger' : ''}`}>{voice.muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}<span>{voice.muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</span></button><button onClick={toggleDeaf} className={`control-btn square ${deafened ? 'active' : ''}`}>{deafened ? <VolumeX className="h-5 w-5" /> : <Headphones className="h-5 w-5" />}</button><button onClick={() => setChatOpen((v) => !v)} className="control-btn square"><MessageCircle className="h-5 w-5" /></button><button onClick={leaveRoom} className="control-btn leave"><LogOut className="h-5 w-5" /><span className="hidden sm:inline">خروج</span></button></div></div>
    {chatOpen && <><button aria-label="بستن چت" onClick={() => setChatOpen(false)} className="fixed inset-0 z-50 bg-black/45" /><aside className="chat-drawer fixed bottom-0 left-0 top-0 z-[60] flex w-full max-w-[390px] flex-col border-r border-white/10 bg-[#0b1020]/95 shadow-2xl backdrop-blur-3xl"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><b className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> چت اتاق</b><button onClick={() => setChatOpen(false)} className="icon-btn"><X className="h-4 w-4" /></button></div><div className="flex-1 overflow-y-auto p-4">{voice.messages.map((m) => <div key={`${m.id}-${m.time}`} className="mb-4"><div className="mb-1 text-xs text-white/40">{m.name}</div><div className="rounded-2xl bg-white/5 px-3 py-2 text-sm">{m.message}</div></div>)}</div><form onSubmit={sendChat} className="flex gap-2 border-t border-white/10 p-3"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="پیام..." className="min-w-0 flex-1 rounded-xl bg-white/5 px-3 py-2 text-sm outline-none" /><button className="control-btn square" aria-label="ارسال"><Send className="h-4 w-4" /></button></form></aside></>}
  </div>;
}
