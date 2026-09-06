'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff, Volume2, Sparkles, ArrowRight, User, Radio } from 'lucide-react';
import { sounds } from '@/lib/sound-effects';

interface LobbyProps {
  onJoin: (roomId: string, userName: string) => void;
  initialRoomId?: string;
}

export default function Lobby({ onJoin, initialRoomId = '' }: LobbyProps) {
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [userName, setUserName] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const savedName = localStorage.getItem('aura_voice_user_name');
      if (savedName) return savedName;
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      return `کاربر_${randomDigits}`;
    } catch {
      return 'کاربر_1001';
    }
  });
  const [micActive, setMicActive] = useState(true);
  const [micVolume, setMicVolume] = useState(0);
  const [camActive, setCamActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sounds.isEnabled());
  const [errorMsg, setErrorMsg] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Generate random stylish room code if empty
  const handleGenerateRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(randomCode);
    sounds.playPop();
  };

  // Setup preview mic volume meter
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let localStream: MediaStream | null = null;

    async function initPreviewMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: camActive ? { width: 640, height: 480 } : false,
        });

        localStream = stream;
        streamRef.current = stream;

        if (camActive && videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          audioCtx = new AudioCtx();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateMeter = () => {
            if (!micActive) {
              setMicVolume(0);
              animFrameRef.current = requestAnimationFrame(updateMeter);
              return;
            }
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            setMicVolume(Math.min(100, Math.round((avg / 128) * 100)));
            animFrameRef.current = requestAnimationFrame(updateMeter);
          };
          animFrameRef.current = requestAnimationFrame(updateMeter);
        }
      } catch (err) {
        console.warn('Microphone permission or preview not ready:', err);
      }
    }

    initPreviewMedia();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [camActive, micActive]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRoom = (roomId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanName = (userName || '').trim();

    if (!cleanRoom) {
      setErrorMsg('لطفاً شناسه اتاق (Room ID) را وارد کنید.');
      return;
    }
    if (!cleanName) {
      setErrorMsg('لطفاً نام یا لقب خود را وارد کنید.');
      return;
    }

    try {
      localStorage.setItem('aura_voice_user_name', cleanName);
    } catch {
      // ignore
    }

    // Stop lobby media preview tracks before transitioning into room
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    onJoin(cleanRoom.toLowerCase(), cleanName);
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 sm:p-6 overflow-hidden bg-gradient-to-tr from-[#0f172a] via-[#1e1b4b] to-[#312e81] text-white">
      {/* Ambient background frosted glow orbs */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-violet-600/15 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-xl mx-auto">
        {/* App Title */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 text-white text-xs font-medium mb-3 shadow-lg backdrop-blur-md">
            <Radio className="w-3.5 h-3.5 text-indigo-400" />
            <span>Real-time Voice & Video</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white flex items-center justify-center gap-2">
            <span>AchoVfx</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400">
              Vocal
            </span>
          </h1>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl shadow-black/40">
          <form onSubmit={handleJoin} className="space-y-5">
            {errorMsg && (
              <div className="p-3 text-xs text-rose-200 bg-rose-500/20 border border-rose-400/30 rounded-2xl text-center backdrop-blur-md">
                {errorMsg}
              </div>
            )}

            {/* Room Identifier */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-indigo-400" />
                  <span>کد یا شناسه اتاق (Room ID)</span>
                </label>
                <button
                  type="button"
                  id="btn-generate-room"
                  onClick={handleGenerateRoom}
                  className="text-[11px] text-indigo-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>تولید اتاق تصادفی</span>
                </button>
              </div>
              <div className="relative">
                <input
                  id="input-room-id"
                  type="text"
                  value={roomId}
                  onChange={(e) => {
                    setRoomId(e.target.value);
                    setErrorMsg('');
                  }}
                  placeholder="مثال: general-chat یا 8K2L9"
                  className="w-full bg-black/30 border border-white/15 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-all font-mono"
                  dir="ltr"
                />
              </div>
            </div>

            {/* User Name */}
            <div>
              <label className="block text-xs font-semibold text-white/80 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>نام نمایشی شما در اتاق</span>
                </span>
              </label>
              <input
                id="input-user-name"
                type="text"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  setErrorMsg('');
                }}
                placeholder="نام خود را وارد کنید..."
                className="w-full bg-black/30 border border-white/15 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
              />
            </div>

            {/* Media & Audio Preview Control Bar */}
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-xs text-white/80 font-medium mb-2.5">
                <span>تست میکروفون و ابزارهای ورودی</span>
                <span className="text-[11px] text-emerald-300 font-mono">
                  {micActive ? `${micVolume}% حساسیت` : 'میکروفون خاموش'}
                </span>
              </div>

              {/* Volume Bar Visualizer */}
              <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden mb-3 p-0.5 border border-white/10">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-teal-300 to-indigo-400 rounded-full transition-all duration-75 ease-out"
                  style={{ width: `${micActive ? micVolume : 0}%` }}
                />
              </div>

              {/* Camera Preview Box (if enabled) */}
              {camActive && (
                <div className="mb-3 relative rounded-2xl overflow-hidden aspect-video bg-black/80 border border-white/15 shadow-inner">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full bg-black/60 text-[10px] text-white/70 backdrop-blur-md border border-white/10">
                    پیش‌نمایش تصویر
                  </div>
                </div>
              )}

              {/* Toggle Buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  id="btn-toggle-mic-preview"
                  onClick={() => {
                    setMicActive(!micActive);
                    sounds.playPop();
                  }}
                  className={`py-2.5 px-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
                    micActive
                      ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30'
                      : 'bg-rose-500/20 border-rose-400/40 text-rose-200 hover:bg-rose-500/30'
                  }`}
                >
                  {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                  <span>{micActive ? 'میکروفون فعال' : 'میکروفون بسته'}</span>
                </button>

                <button
                  type="button"
                  id="btn-toggle-cam-preview"
                  onClick={() => {
                    setCamActive(!camActive);
                    sounds.playPop();
                  }}
                  className={`py-2.5 px-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
                    camActive
                      ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/30'
                      : 'bg-white/10 border-white/15 text-white/70 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {camActive ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                  <span>{camActive ? 'دوربین روشن' : 'دوربین خاموش'}</span>
                </button>

                <button
                  type="button"
                  id="btn-toggle-sound-effects"
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    sounds.setEnabled(next);
                    if (next) sounds.playPop();
                  }}
                  className={`py-2.5 px-3 rounded-2xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer backdrop-blur-md ${
                    soundEnabled
                      ? 'bg-teal-500/20 border-teal-400/40 text-teal-200 hover:bg-teal-500/30'
                      : 'bg-white/5 border-white/10 text-white/40'
                  }`}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>{soundEnabled ? 'صداها فعال' : 'صداها قطع'}</span>
                </button>
              </div>
            </div>

            {/* Submit Join Button */}
            <button
              type="submit"
              id="btn-join-room"
              className="w-full py-3.5 px-6 rounded-2xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-sm shadow-xl shadow-indigo-500/30 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-400/30"
            >
              <span>ورود به اتاق گفتگو</span>
              <ArrowRight className="w-4 h-4 rotate-180" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
