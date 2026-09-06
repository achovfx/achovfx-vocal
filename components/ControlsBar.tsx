'use client';

import { useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  Volume2,
  VolumeX,
  PhoneOff,
  Users,
  MessageSquare,
  Smile,
  Volume1,
  Sparkles,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { sounds } from '@/lib/sound-effects';

interface ControlsBarProps {
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isNoiseSuppression?: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleNoiseSuppression?: () => void;
  onDisconnect: () => void;
  onOpenNicknames: () => void;
  onToggleChat: () => void;
  onSendReaction: (emoji: string) => void;
  participantsCount: number;
  unreadCount?: number;
}

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '👏', '🚀', '🎙️', '🎉', '👍'];

export default function ControlsBar({
  isMuted,
  isDeafened,
  isCameraOn,
  isScreenSharing,
  isNoiseSuppression = true,
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreenShare,
  onToggleNoiseSuppression,
  onDisconnect,
  onOpenNicknames,
  onToggleChat,
  onSendReaction,
  participantsCount,
  unreadCount = 0,
}: ControlsBarProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [soundFxEnabled, setSoundFxEnabled] = useState(sounds.isEnabled());

  const handleToggleSoundFx = () => {
    const next = !soundFxEnabled;
    setSoundFxEnabled(next);
    sounds.setEnabled(next);
    if (next) sounds.playPop();
  };

  return (
    <div className="fixed bottom-3 sm:bottom-6 inset-x-0 z-40 flex flex-col items-center pointer-events-none px-2 sm:px-4 pb-[env(safe-area-inset-bottom)]">
      {/* Floating Reactions Popup */}
      {showReactions && (
        <div className="mb-2 sm:mb-3 pointer-events-auto p-2 sm:p-2.5 bg-[#0f172a]/95 border border-white/20 rounded-2xl shadow-2xl backdrop-blur-2xl flex items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-24px)] overflow-x-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onSendReaction(emoji);
                setShowReactions(false);
              }}
              className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl hover:bg-white/20 active:scale-90 text-lg sm:text-xl flex items-center justify-center transition-all cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Mobile More Options Bottom Sheet / Popover */}
      {showMoreMenu && (
        <div className="sm:hidden mb-2 pointer-events-auto w-[calc(100vw-24px)] max-w-sm p-3.5 bg-[#0f172a]/95 border border-white/20 rounded-3xl shadow-2xl backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-2 duration-200 text-white">
          <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10">
            <span className="text-xs font-bold text-white/90">سایر تنظیمات و امکانات</span>
            <button
              type="button"
              onClick={() => setShowMoreMenu(false)}
              className="p-1 rounded-full text-white/60 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Noise Suppression */}
            <button
              type="button"
              onClick={() => {
                onToggleNoiseSuppression?.();
              }}
              className={`p-2.5 rounded-2xl border text-xs flex items-center justify-between transition-all ${
                isNoiseSuppression
                  ? 'bg-indigo-500/25 border-indigo-400/40 text-indigo-200'
                  : 'bg-white/5 border-white/10 text-white/60'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>کاهش نویز</span>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${isNoiseSuppression ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-white/40'}`}>
                {isNoiseSuppression ? 'روشن' : 'خاموش'}
              </span>
            </button>

            {/* Deafen Toggle */}
            <button
              type="button"
              onClick={() => {
                onToggleDeafen();
              }}
              className={`p-2.5 rounded-2xl border text-xs flex items-center justify-between transition-all ${
                isDeafened
                  ? 'bg-amber-500/25 border-amber-400/40 text-amber-200'
                  : 'bg-white/5 border-white/10 text-white/60'
              }`}
            >
              <div className="flex items-center gap-2">
                {isDeafened ? <VolumeX className="w-4 h-4 text-amber-300" /> : <Volume2 className="w-4 h-4" />}
                <span>سکوت کل</span>
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${isDeafened ? 'bg-amber-400/20 text-amber-300' : 'bg-white/10 text-white/40'}`}>
                {isDeafened ? 'روشن' : 'خاموش'}
              </span>
            </button>

            {/* Participants & Nicknames */}
            <button
              type="button"
              onClick={() => {
                setShowMoreMenu(false);
                onOpenNicknames();
              }}
              className="p-2.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs flex items-center justify-between transition-all text-white/80"
            >
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-300" />
                <span>حاضرین ({participantsCount})</span>
              </div>
              <span className="text-[10px] text-white/50 font-mono">ویرایش</span>
            </button>

            {/* Screen Share (if on mobile) */}
            <button
              type="button"
              onClick={() => {
                onToggleScreenShare();
                setShowMoreMenu(false);
              }}
              className={`p-2.5 rounded-2xl border text-xs flex items-center justify-between transition-all ${
                isScreenSharing
                  ? 'bg-indigo-500/25 border-indigo-400/40 text-indigo-200'
                  : 'bg-white/5 border-white/10 text-white/60'
              }`}
            >
              <div className="flex items-center gap-2">
                {isScreenSharing ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                <span>اشتراک صفحه</span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Main Control Pill */}
      <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-3 px-3 sm:px-6 py-2 sm:py-3 rounded-full bg-[#0f172a]/90 sm:bg-white/10 border border-white/20 shadow-2xl backdrop-blur-xl transition-all">
        {/* Mic Button */}
        <button
          type="button"
          id="btn-toggle-mic"
          onClick={onToggleMute}
          className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all flex items-center justify-center active:scale-90 cursor-pointer ${
            isMuted
              ? 'bg-rose-500/30 text-rose-200 border border-rose-400/40 hover:bg-rose-500/40'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
          }`}
          title={isMuted ? 'وصل کردن میکروفون (Unmute)' : 'قطع میکروفون (Mute)'}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Noise Suppression Toggle (Desktop / Tablet) */}
        <button
          type="button"
          id="btn-toggle-noise-suppression"
          onClick={onToggleNoiseSuppression}
          className={`relative w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all hidden sm:flex items-center justify-center cursor-pointer active:scale-90 ${
            isNoiseSuppression
              ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 hover:bg-indigo-500/40 shadow-sm'
              : 'bg-white/5 hover:bg-white/10 text-white/40 border border-white/5'
          }`}
          title={
            isNoiseSuppression
              ? 'کاهش نویز صدا فعال است (Noise Suppression: ON)'
              : 'کاهش نویز صدا خاموش است (Noise Suppression: OFF)'
          }
        >
          <Sparkles className={`w-5 h-5 ${isNoiseSuppression ? 'text-indigo-300' : 'text-white/40'}`} />
          <span
            className={`absolute bottom-1 right-1 w-2 h-2 rounded-full border border-black/40 ${
              isNoiseSuppression ? 'bg-emerald-400' : 'bg-white/30'
            }`}
          />
        </button>

        {/* Camera Toggle Button */}
        <button
          type="button"
          id="btn-toggle-camera"
          onClick={onToggleCamera}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all flex items-center justify-center active:scale-90 cursor-pointer ${
            isCameraOn
              ? 'bg-teal-500/40 text-teal-100 border border-teal-400/50 hover:bg-teal-500/50'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
          }`}
          title={isCameraOn ? 'خاموش کردن دوربین' : 'روشن کردن دوربین'}
        >
          {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {/* Screen Share Button (Desktop / Tablet) */}
        <button
          type="button"
          id="btn-toggle-screenshare"
          onClick={onToggleScreenShare}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all hidden sm:flex items-center justify-center active:scale-90 cursor-pointer ${
            isScreenSharing
              ? 'bg-indigo-500 text-white border border-indigo-400 shadow-lg shadow-indigo-500/30 hover:bg-indigo-600'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
          }`}
          title={isScreenSharing ? 'توقف اشتراک صفحه' : 'اشتراک‌گذاری صفحه نمایش (Share Screen)'}
        >
          {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
        </button>

        {/* Deafen Button (Desktop / Tablet) */}
        <button
          type="button"
          id="btn-toggle-deafen"
          onClick={onToggleDeafen}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all hidden sm:flex items-center justify-center active:scale-90 cursor-pointer ${
            isDeafened
              ? 'bg-amber-500/30 text-amber-200 border border-amber-400/40 hover:bg-amber-500/40'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
          }`}
          title={isDeafened ? 'وصل کردن صدای ورودی' : 'بی‌صدا کردن همه (Deafen)'}
        >
          {isDeafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        {/* Reactions Toggle */}
        <button
          type="button"
          id="btn-toggle-reactions"
          onClick={() => setShowReactions(!showReactions)}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all flex items-center justify-center active:scale-90 cursor-pointer ${
            showReactions
              ? 'bg-indigo-500/40 text-indigo-200 border border-indigo-400/50'
              : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
          }`}
          title="ارسال واکنش و ایموجی"
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* Chat Toggle Button */}
        <button
          type="button"
          id="btn-toggle-chat"
          onClick={onToggleChat}
          className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all flex items-center justify-center active:scale-90 cursor-pointer"
          title="چت متنی داخل تماس"
        >
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-500 text-white border border-white/20">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Participants & Nicknames Button (Desktop / Tablet) */}
        <button
          type="button"
          id="btn-open-nicknames"
          onClick={onOpenNicknames}
          className="relative w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all hidden sm:flex items-center justify-center active:scale-90 cursor-pointer"
          title="لیست حاضرین و تنظیم نام‌های مستعار"
        >
          <Users className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-indigo-500 text-white border border-white/20">
            {participantsCount}
          </span>
        </button>

        {/* Sound FX Toggle (Desktop only) */}
        <button
          type="button"
          onClick={handleToggleSoundFx}
          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full transition-all hidden lg:flex items-center justify-center active:scale-90 cursor-pointer ${
            soundFxEnabled
              ? 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
              : 'bg-white/5 text-white/30 border border-white/5'
          }`}
          title={soundFxEnabled ? 'افکت صوتی فعال است' : 'افکت صوتی خاموش است'}
        >
          <Volume1 className="w-4 h-4" />
        </button>

        {/* Mobile "More" Menu Toggle (•••) */}
        <button
          type="button"
          id="btn-mobile-more"
          onClick={() => setShowMoreMenu(!showMoreMenu)}
          className={`w-11 h-11 rounded-full transition-all flex sm:hidden items-center justify-center active:scale-90 cursor-pointer ${
            showMoreMenu
              ? 'bg-indigo-500/40 text-indigo-200 border border-indigo-400/50'
              : 'bg-white/10 text-white border border-white/10'
          }`}
          title="تنظیمات بیشتر"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>

        {/* End Call / Disconnect Button */}
        <button
          type="button"
          id="btn-disconnect-call"
          onClick={onDisconnect}
          className="w-11 h-11 sm:w-auto sm:px-7 py-2.5 sm:py-3 rounded-full bg-rose-500 hover:bg-rose-600 active:scale-90 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-rose-500/30 transition-all cursor-pointer shrink-0"
          title="قطع تماس و خروج از اتاق"
        >
          <PhoneOff className="w-4 h-4 sm:w-5 sm:h-5 rotate-[135deg]" />
          <span className="hidden sm:inline font-bold">End Call</span>
        </button>
      </div>
    </div>
  );
}
