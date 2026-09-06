'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, VolumeX, Edit3, Monitor, Maximize2, Minimize2, Video } from 'lucide-react';
import { Participant } from '@/types/voice-chat';

interface ParticipantCardProps {
  participant: Participant;
  isSelf: boolean;
  displayName: string;
  isSpeaking: boolean;
  stream?: MediaStream | null;
  cameraStream?: MediaStream | null;
  screenStream?: MediaStream | null;
  isDeafenedLocal?: boolean;
  onEditNickname?: (id: string) => void;
}

export default function ParticipantCard({
  participant,
  isSelf,
  displayName,
  isSpeaking,
  stream,
  cameraStream,
  screenStream,
  isDeafenedLocal = false,
  onEditNickname,
}: ParticipantCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Active video stream to display (priority: screen share > camera)
  const isScreenShareActive =
    participant.isScreenSharing || (isSelf && !!screenStream);

  const isCameraActive =
    (participant.isCameraOn && !isScreenShareActive) ||
    (isSelf && !!cameraStream && !isScreenShareActive);

  const activeVideoStream = isSelf
    ? (isScreenShareActive ? screenStream : cameraStream) || screenStream || cameraStream
    : stream && stream.getVideoTracks().length > 0
    ? stream
    : null;

  const hasVideo = isSelf
    ? !!activeVideoStream
    : !!activeVideoStream && (participant.isCameraOn || participant.isScreenSharing || (!!stream && stream.getVideoTracks().length > 0));

  // Bind video stream
  useEffect(() => {
    if (videoRef.current) {
      if (activeVideoStream) {
        videoRef.current.srcObject = activeVideoStream;
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [activeVideoStream, hasVideo]);

  const toggleFullscreen = () => {
    if (!cardRef.current) return;
    if (!document.fullscreenElement) {
      cardRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const color = participant.color;

  return (
    <div
      ref={cardRef}
      className={`group relative flex flex-col items-center justify-center rounded-2xl sm:rounded-3xl overflow-hidden transition-all duration-300 ${
        hasVideo ? 'aspect-video min-h-[180px] sm:min-h-[260px]' : 'aspect-square sm:aspect-auto min-h-[160px] sm:min-h-[220px]'
      } bg-white/5 backdrop-blur-md border ${
        isSpeaking
          ? 'border-2 shadow-2xl scale-[1.01]'
          : 'border-white/10 hover:border-white/20 shadow-xl'
      }`}
      style={{
        borderColor: isSpeaking ? color.border : undefined,
        boxShadow: isSpeaking ? `0 0 30px ${color.glow}` : undefined,
      }}
    >
      {/* Video layer if camera or screen share is on */}
      {hasVideo ? (
        <div className="relative w-full h-full bg-black/90 flex items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={true}
            className={`w-full h-full ${
              isScreenShareActive ? 'object-contain' : isSelf ? 'object-cover scale-x-[-1]' : 'object-cover'
            }`}
          />

          {/* Fullscreen Button (visible on mobile, hover on desktop) */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-3 left-3 p-2 rounded-full bg-black/50 hover:bg-black/70 active:scale-90 text-white border border-white/20 backdrop-blur-md opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
            title={isFullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      ) : (
        /* Voice Only Tile with Avatar */
        <div className="relative flex flex-col items-center justify-center p-3 sm:p-6 text-center w-full h-full">
          {/* Speaking Aura Halo Rings */}
          <div className="relative flex items-center justify-center mb-2 sm:mb-4">
            {isSpeaking && (
              <>
                <div
                  className="absolute -inset-3 sm:-inset-4 rounded-full animate-ping opacity-25 pointer-events-none"
                  style={{ backgroundColor: color.ring }}
                />
                <div
                  className="absolute -inset-1.5 sm:-inset-2 rounded-full animate-pulse opacity-40 pointer-events-none"
                  style={{ backgroundColor: color.border }}
                />
              </>
            )}

            {/* Avatar Circle */}
            <div
              className="relative w-18 h-18 sm:w-26 sm:h-26 rounded-full flex items-center justify-center text-2xl sm:text-4xl font-bold text-white shadow-2xl transition-transform duration-200"
              style={{
                backgroundColor: color.bg,
                boxShadow: `0 12px 28px ${color.glow}`,
                transform: isSpeaking ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <span>{displayName.charAt(0).toUpperCase()}</span>

              {/* Color index badge */}
              <div
                className="absolute -bottom-1 -right-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold bg-black/70 border border-white/20 backdrop-blur-md"
                style={{ color: color.border }}
              >
                #{participant.joinOrder + 1}
              </div>
            </div>
          </div>

          {/* Real-time sound wave bars when speaking */}
          <div className="h-4 flex items-center justify-center gap-1 my-0.5 sm:my-1">
            {isSpeaking ? (
              <>
                <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-2" style={{ animationDelay: '0ms' }} />
                <span className="w-1 bg-teal-400 rounded-full animate-bounce h-3.5" style={{ animationDelay: '150ms' }} />
                <span className="w-1 bg-indigo-400 rounded-full animate-bounce h-4" style={{ animationDelay: '300ms' }} />
                <span className="w-1 bg-teal-400 rounded-full animate-bounce h-2.5" style={{ animationDelay: '150ms' }} />
                <span className="w-1 bg-emerald-400 rounded-full animate-bounce h-1.5" style={{ animationDelay: '0ms' }} />
              </>
            ) : (
              <span className="text-[10px] sm:text-[11px] text-white/40 font-medium">در حال گوش دادن</span>
            )}
          </div>
        </div>
      )}

      {/* Top badges (Screen sharing / Camera indicator) */}
      <div className="absolute top-2.5 sm:top-4 right-2.5 sm:right-4 flex items-center gap-1.5 z-20">
        {isScreenShareActive && (
          <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-indigo-600/95 text-white text-[10px] sm:text-xs font-semibold flex items-center gap-1.5 backdrop-blur-md shadow-xl border border-indigo-400/40 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <Monitor className="w-3.5 h-3.5" />
            <span>{isSelf ? 'پیش‌نمایش زنده صفحه شما' : 'اشتراک صفحه'}</span>
          </span>
        )}
        {isCameraActive && !isScreenShareActive && (
          <span className="px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-teal-600/95 text-white text-[10px] sm:text-xs font-semibold flex items-center gap-1.5 backdrop-blur-md shadow-xl border border-teal-400/40">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <Video className="w-3.5 h-3.5" />
            <span>{isSelf ? 'پیش‌نمایش دوربین شما' : 'دوربین فعال'}</span>
          </span>
        )}
      </div>

      {/* Bottom overlay badge: Name & status icons */}
      <div className="absolute bottom-2.5 sm:bottom-4 left-2.5 sm:left-4 right-2.5 sm:right-4 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-black/60 border border-white/10 backdrop-blur-md flex items-center justify-between gap-1.5 sm:gap-2 z-20 shadow-lg">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              isSpeaking ? 'bg-emerald-400 animate-pulse' : 'bg-white/40'
            }`}
          />
          <span className="text-[11px] sm:text-sm font-semibold text-white truncate max-w-[100px] sm:max-w-[170px]">
            {displayName}
          </span>
          {isSelf && (
            <span className="text-[9px] sm:text-[10px] text-white/50 shrink-0">
              (You)
            </span>
          )}
          {displayName !== participant.name && (
            <span
              className="text-[10px] text-white/40 hidden md:inline truncate max-w-[80px]"
              title={`نام اصلی: ${participant.name}`}
            >
              • {participant.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Quick Edit Nickname Button */}
          {onEditNickname && (
            <button
              type="button"
              onClick={() => onEditNickname(participant.id)}
              className="p-1 rounded-full text-white/60 hover:text-white hover:bg-white/15 active:scale-90 transition-all cursor-pointer"
              title="تغییر نام مستعار برای این کاربر"
            >
              <Edit3 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          )}

          {/* Status Indicators */}
          {participant.isDeafened && (
            <span
              className="p-1 rounded-full bg-amber-500/30 text-amber-200 border border-amber-500/30"
              title="کاربر صدای چت را بسته است"
            >
              <VolumeX className="w-3.5 h-3.5" />
            </span>
          )}

          {participant.isMuted ? (
            <span
              className="p-1 rounded-full bg-rose-500/30 text-rose-200 border border-rose-500/30"
              title="میکروفون بسته است"
            >
              <MicOff className="w-3.5 h-3.5" />
            </span>
          ) : (
            <span
              className={`p-1 rounded-full ${
                isSpeaking ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-500/30' : 'text-white/60'
              }`}
              title={isSpeaking ? 'در حال صحبت' : 'میکروفون باز'}
            >
              <Mic className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
