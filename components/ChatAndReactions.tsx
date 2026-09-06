'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare, Smile } from 'lucide-react';
import { ChatMessage, ReactionItem } from '@/types/voice-chat';

interface ChatAndReactionsProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  reactions: ReactionItem[];
  onSendMessage: (text: string) => void;
  selfId: string;
}

export default function ChatAndReactions({
  isOpen,
  onClose,
  messages,
  reactions,
  onSendMessage,
  selfId,
}: ChatAndReactionsProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <>
      {/* Floating Animated Reaction Emojis floating across the screen */}
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {reactions.map((react) => (
          <div
            key={react.id}
            className="absolute bottom-24 text-4xl animate-float-up opacity-90 filter drop-shadow-md pointer-events-none transition-all"
            style={{
              left: `${react.xOffset}%`,
            }}
          >
            {react.emoji}
          </div>
        ))}
      </div>

      {/* Chat Sidebar / Mobile Bottom Sheet */}
      {isOpen && (
        <>
          {/* Backdrop for tapping outside to dismiss */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in duration-200 cursor-pointer"
            onClick={onClose}
          />

          <div className="fixed inset-x-0 bottom-0 top-14 sm:top-0 sm:bottom-0 sm:left-0 sm:right-auto sm:w-96 z-50 bg-[#0f172a]/95 backdrop-blur-2xl border-t sm:border-t-0 sm:border-r border-white/15 shadow-2xl flex flex-col rounded-t-3xl sm:rounded-none animate-in slide-in-from-bottom sm:slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-3.5 sm:py-4 border-b border-white/10 bg-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-bold text-white">گفتگوی متنی اتاق</span>
              </div>
              <button
                type="button"
                id="btn-close-chat-drawer"
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                title="بستن چت"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 overscroll-contain">
              {messages.length === 0 && (
                <div className="text-center py-12 text-white/40 text-xs">
                  هنوز پیامی ارسال نشده است. اولین پیام را شما بنویسید!
                </div>
              )}

              {messages.map((msg) => {
                const isSelf = msg.from === selfId;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isSelf ? 'items-start' : 'items-end'}`}
                  >
                    <span className="text-[10px] text-white/50 mb-0.5 px-1">
                      {msg.senderName} {isSelf && '(شما)'}
                    </span>
                    <div
                      className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-xs leading-relaxed break-words shadow-sm ${
                        isSelf
                          ? 'bg-indigo-600/80 backdrop-blur-md text-white border border-indigo-400/30 rounded-tr-sm'
                          : 'bg-white/10 backdrop-blur-md border border-white/10 text-white rounded-tl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                    <span className="text-[9px] text-white/40 mt-0.5 px-1 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Box */}
            <form onSubmit={handleSend} className="p-3 sm:p-3.5 pb-[max(14px,env(safe-area-inset-bottom))] border-t border-white/10 bg-white/5 shrink-0">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="پیام خود را بنویسید..."
                  className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3.5 py-2.5 text-base sm:text-xs text-white placeholder-white/40 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  className="w-11 h-11 rounded-xl bg-indigo-500 hover:bg-indigo-600 active:scale-95 disabled:opacity-40 disabled:hover:bg-indigo-500 text-white transition-all cursor-pointer shadow-md shadow-indigo-500/20 flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4 rotate-180" />
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
