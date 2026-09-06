'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, Radio, Share2, Tag, Clock } from 'lucide-react';
import { sounds } from '@/lib/sound-effects';

interface RoomHeaderProps {
  roomId: string;
  participantCount: number;
  onOpenNicknames: () => void;
  quality?: 'good' | 'fair' | 'poor';
}

export default function RoomHeader({
  roomId,
  participantCount,
  onOpenNicknames,
  quality = 'good',
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatDuration = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopyLink = async () => {
    try {
      const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sounds.playPop();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <header className="w-full h-14 sm:h-16 px-3 sm:px-8 flex items-center justify-between border-b border-white/10 bg-white/5 backdrop-blur-lg z-30 shrink-0">
      {/* Brand & Room info */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 shrink-0">
            <Radio className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-bold text-sm sm:text-base tracking-tight text-white whitespace-nowrap">
              AchoVfx<span className="hidden xs:inline"> Vocal</span>
            </span>
            <span className="text-white/40 font-normal text-xs hidden sm:inline">| #{roomId}</span>
          </div>
        </div>

        {/* Session Duration Timer Pill */}
        <div
          id="session-duration-timer"
          className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] sm:text-xs font-mono text-white/80 backdrop-blur-md shrink-0"
          title="مدت زمان حضور در جلسه صوتی"
        >
          <Clock className="w-3 h-3 text-indigo-400" />
          <span>{formatDuration(elapsedSeconds)}</span>
        </div>

        {/* Room Code Pill (Tablet / Desktop) */}
        <div className="hidden md:flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/10 border border-white/10 backdrop-blur-md">
          <span className="text-xs font-mono font-medium text-white/90">{roomId}</span>
          <button
            type="button"
            id="btn-copy-room-link"
            onClick={handleCopyLink}
            className="p-1 text-white/60 hover:text-white active:scale-90 transition-all cursor-pointer"
            title="کپی کردن لینک دعوت به اتاق"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Right side status & action buttons */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Connection status indicator */}
        <div
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/70 backdrop-blur-md"
          title={quality === 'good' ? 'اتصال پایدار' : 'اتصال متوسط'}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              quality === 'good'
                ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                : quality === 'fair'
                ? 'bg-amber-400'
                : 'bg-rose-400'
            }`}
          />
          <span className="hidden md:inline">{quality === 'good' ? 'اتصال پایدار' : 'اتصال متوسط'}</span>
        </div>

        {/* Local Nicknames Quick Trigger */}
        <button
          type="button"
          id="btn-header-nicknames"
          onClick={onOpenNicknames}
          className="flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto p-1.5 sm:px-3.5 sm:py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/10 text-white transition-all text-xs sm:text-sm font-medium backdrop-blur-md cursor-pointer"
          title="نام‌های مستعار"
        >
          <Tag className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">نام‌های مستعار</span>
        </button>

        {/* Share / Invite Button */}
        <button
          type="button"
          id="btn-share-room"
          onClick={handleCopyLink}
          className="flex items-center justify-center gap-1.5 w-8 h-8 sm:w-auto sm:h-auto p-1.5 sm:px-4 sm:py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/10 transition-all text-xs sm:text-sm font-medium backdrop-blur-md cursor-pointer"
          title="دعوت دوستان / کپی لینک"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{copied ? 'کپی شد' : 'Invite Friends'}</span>
        </button>
      </div>
    </header>
  );
}
