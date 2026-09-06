'use client';

import { useState } from 'react';
import { X, Check, RotateCcw, User, Tag, Sparkles } from 'lucide-react';
import { Participant } from '@/types/voice-chat';
import { sounds } from '@/lib/sound-effects';

interface NicknameModalProps {
  isOpen: boolean;
  onClose: () => void;
  participants: Participant[];
  self: Participant | null;
  nicknames: Record<string, string>;
  onSetNickname: (id: string, name: string) => void;
  onRemoveNickname: (id: string) => void;
  selectedParticipantId?: string | null;
}

export default function NicknameModal({
  isOpen,
  onClose,
  participants,
  self,
  nicknames,
  onSetNickname,
  onRemoveNickname,
  selectedParticipantId,
}: NicknameModalProps) {
  const allMembers = self ? [self, ...participants] : participants;
  const [editingId, setEditingId] = useState<string | null>(selectedParticipantId || null);
  const [inputValue, setInputValue] = useState<string>('');

  if (!isOpen) return null;

  const handleStartEdit = (p: Participant) => {
    setEditingId(p.id);
    setInputValue(nicknames[p.id] || p.name);
  };

  const handleSave = (id: string) => {
    if (inputValue.trim()) {
      onSetNickname(id, inputValue.trim());
      sounds.playPop();
    } else {
      onRemoveNickname(id);
    }
    setEditingId(null);
  };

  const handleReset = (id: string) => {
    onRemoveNickname(id);
    setInputValue('');
    setEditingId(null);
    sounds.playPop();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[90dvh] bg-[#0f172a]/95 border-t sm:border border-white/15 rounded-t-3xl sm:rounded-3xl shadow-2xl backdrop-blur-2xl overflow-hidden text-white flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4 border-b border-white/10 bg-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/30">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white">تنظیم نام‌های مستعار</h2>
              <p className="text-[10px] sm:text-[11px] text-white/50">
                ذخیره در حافظه محلی مرورگر شما (localStorage)
              </p>
            </div>
          </div>
          <button
            id="btn-close-nickname-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 text-white/60 hover:text-white hover:bg-white/20 active:scale-90 flex items-center justify-center transition-all border border-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notice banner */}
        <div className="px-5 sm:px-6 py-2.5 sm:py-3 bg-white/5 border-b border-white/10 flex items-start gap-2.5 text-[11px] sm:text-xs text-white/70 leading-relaxed backdrop-blur-md shrink-0">
          <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <span>
            نام‌های مستعاری که در اینجا تعریف می‌کنید فقط در این دستگاه برای شما نشان داده می‌شوند.
          </span>
        </div>

        {/* Members List */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-2.5 sm:space-y-3 flex-1 overscroll-contain">
          {allMembers.length === 0 && (
            <div className="text-center py-8 text-xs text-white/40">
              هنوز کاربری در اتاق حاضر نیست
            </div>
          )}

          {allMembers.map((member) => {
            const isSelf = member.id === self?.id;
            const hasCustom = !!nicknames[member.id];
            const currentDisplay = nicknames[member.id] || member.name;
            const isEditing = editingId === member.id;

            return (
              <div
                key={member.id}
                className={`p-3 sm:p-3.5 rounded-2xl border transition-all ${
                  isEditing
                    ? 'bg-white/10 border-indigo-400/60 shadow-lg'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 sm:gap-3">
                  {/* Left info: avatar and names */}
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm text-white shrink-0 shadow-lg"
                      style={{
                        backgroundColor: member.color.bg,
                        boxShadow: `0 0 12px ${member.color.glow}`,
                      }}
                    >
                      {currentDisplay.charAt(0).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span className="font-semibold text-xs sm:text-sm text-white truncate">
                          {currentDisplay}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-mono shrink-0">
                            شما
                          </span>
                        )}
                        <span
                          className="text-[9px] sm:text-[10px] px-1.5 py-0.2 rounded-full font-mono shrink-0"
                          style={{
                            backgroundColor: `${member.color.bg}33`,
                            color: member.color.border,
                            border: `1px solid ${member.color.border}66`,
                          }}
                        >
                          #{member.joinOrder + 1}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5 text-[11px] sm:text-xs text-white/50 truncate">
                        {hasCustom && (
                          <span className="truncate">نام اصلی: <strong className="text-white/80 font-normal">{member.name}</strong></span>
                        )}
                        {!hasCustom && (
                          <span className="text-white/40">نام اصلی: {member.name}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                      {hasCustom && (
                        <button
                          type="button"
                          onClick={() => handleReset(member.id)}
                          title="حذف نام مستعار و بازگشت به نام اصلی"
                          className="w-8 h-8 rounded-full bg-white/10 text-white/60 hover:text-rose-300 active:scale-90 flex items-center justify-center transition-all border border-white/10 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleStartEdit(member)}
                        className="px-2.5 sm:px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 text-white border border-white/15 text-xs font-medium transition-all cursor-pointer backdrop-blur-md"
                      >
                        {hasCustom ? 'ویرایش' : 'تنظیم نام'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline Edit Form */}
                {isEditing && (
                  <div className="mt-3 pt-3 border-t border-white/10 flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        autoFocus
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(member.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        placeholder={`نام مستعار برای ${member.name}...`}
                        className="w-full bg-black/40 border border-indigo-400/60 rounded-xl px-3 py-2 text-base sm:text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSave(member.id)}
                      className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white text-xs font-medium flex items-center gap-1 transition-all cursor-pointer shadow-md shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>ذخیره</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="px-2.5 py-2 rounded-xl bg-white/10 text-white/60 hover:text-white active:scale-95 text-xs transition-all cursor-pointer border border-white/10 shrink-0"
                    >
                      لغو
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3 sm:py-4 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-white/10 bg-white/5 flex items-center justify-between text-xs text-white/50 shrink-0">
          <span>حاضرین: {allMembers.length} نفر</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 active:scale-95 border border-white/15 text-white font-medium text-xs transition-all cursor-pointer backdrop-blur-md"
          >
            بستن پنجره
          </button>
        </div>
      </div>
    </div>
  );
}
