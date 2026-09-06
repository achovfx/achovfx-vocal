'use client';

import { useState, Suspense } from 'react';
import Lobby from '@/components/Lobby';
import LiveKitVoiceRoom from '@/components/LiveKitVoiceRoom';

function VoiceChatApp() {
  const [roomId, setRoomId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room')?.trim() || '';
    }
    return '';
  });
  const [userName, setUserName] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  const handleJoin = (targetRoomId: string, targetUserName: string) => {
    setRoomId(targetRoomId);
    setUserName(targetUserName);
    setIsJoined(true);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('room', targetRoomId);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleLeave = () => {
    setIsJoined(false);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  };

  if (!isJoined) {
    return <Lobby onJoin={handleJoin} initialRoomId={roomId} />;
  }

  return <LiveKitVoiceRoom roomId={roomId} userName={userName} onLeave={handleLeave} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-white/50">در حال بارگذاری...</div>}>
      <VoiceChatApp />
    </Suspense>
  );
}
