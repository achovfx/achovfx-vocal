'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Lobby from '@/components/Lobby';
import RoomHeader from '@/components/RoomHeader';
import ParticipantCard from '@/components/ParticipantCard';
import ControlsBar from '@/components/ControlsBar';
import NicknameModal from '@/components/NicknameModal';
import ChatAndReactions from '@/components/ChatAndReactions';
import { useWebRTCRoom } from '@/hooks/use-webrtc-room';
import { useLocalNicknames } from '@/hooks/use-local-nicknames';
import { Copy, Check, Users, Sparkles } from 'lucide-react';
import { sounds } from '@/lib/sound-effects';

function VoiceChatApp() {
  const [roomId, setRoomId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room')?.trim() || '';
    }
    return '';
  });
  const [userName, setUserName] = useState<string>('');
  const [isJoined, setIsJoined] = useState(false);
  const [isNicknamesOpen, setIsNicknamesOpen] = useState(false);
  const [selectedPeerForNickname, setSelectedPeerForNickname] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleJoin = (targetRoomId: string, targetUserName: string) => {
    setRoomId(targetRoomId);
    setUserName(targetUserName);
    setIsJoined(true);

    // Update browser URL query without reloading
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('room', targetRoomId);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleLeave = () => {
    setIsJoined(false);
    // Remove query param
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  };

  return isJoined ? (
    <ActiveRoom
      roomId={roomId}
      userName={userName}
      onLeave={handleLeave}
      isNicknamesOpen={isNicknamesOpen}
      setIsNicknamesOpen={setIsNicknamesOpen}
      selectedPeerForNickname={selectedPeerForNickname}
      setSelectedPeerForNickname={setSelectedPeerForNickname}
      isChatOpen={isChatOpen}
      setIsChatOpen={setIsChatOpen}
      copiedLink={copiedLink}
      setCopiedLink={setCopiedLink}
    />
  ) : (
    <Lobby onJoin={handleJoin} initialRoomId={roomId} />
  );
}

interface ActiveRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
  isNicknamesOpen: boolean;
  setIsNicknamesOpen: (val: boolean) => void;
  selectedPeerForNickname: string | null;
  setSelectedPeerForNickname: (val: string | null) => void;
  isChatOpen: boolean;
  setIsChatOpen: (val: boolean | ((p: boolean) => boolean)) => void;
  copiedLink: boolean;
  setCopiedLink: (val: boolean) => void;
}

function ActiveRoom({
  roomId,
  userName,
  onLeave,
  isNicknamesOpen,
  setIsNicknamesOpen,
  selectedPeerForNickname,
  setSelectedPeerForNickname,
  isChatOpen,
  setIsChatOpen,
  copiedLink,
  setCopiedLink,
}: ActiveRoomProps) {
  const {
    self,
    participants,
    isConnecting,
    isMuted,
    isDeafened,
    isCameraOn,
    isScreenSharing,
    isNoiseSuppression,
    isLocalSpeaking,
    remoteSpeaking,
    messages,
    reactions,
    cameraStream,
    screenStream,
    remoteStreams,
    connectionQuality,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    toggleNoiseSuppression,
    sendMessage,
    sendReaction,
    disconnect,
  } = useWebRTCRoom({
    roomId,
    userName,
    onLeave,
  });

  const { nicknames, setNickname, removeNickname, getDisplayName } = useLocalNicknames();

  // Filter out any accidental duplicate of self in remote participants
  const cleanRemoteParticipants = useMemo(() => {
    if (!self) return participants;
    return participants.filter((p) => p.id !== self.id);
  }, [participants, self]);

  const totalMembersCount = (self ? 1 : 0) + cleanRemoteParticipants.length;

  const handleEditNickname = (participantId: string) => {
    setSelectedPeerForNickname(participantId);
    setIsNicknamesOpen(true);
  };

  const handleCopyInvite = async () => {
    try {
      const url = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      sounds.playPop();
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  // Find if anyone is sharing screen (spotlight view)
  const screenSharingParticipant = useMemo(() => {
    if (isScreenSharing && self) return { participant: self, isSelf: true };
    const remoteSharer = cleanRemoteParticipants.find((p) => p.isScreenSharing);
    if (remoteSharer) return { participant: remoteSharer, isSelf: false };
    return null;
  }, [isScreenSharing, self, cleanRemoteParticipants]);

  return (
    <div className="relative min-h-screen w-full flex flex-col bg-gradient-to-tr from-[#0f172a] via-[#1e1b4b] to-[#312e81] text-white overflow-x-hidden pb-24 sm:pb-28">
      {/* Frosted ambient background illumination */}
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed -bottom-40 -right-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Navigation / Header */}
      <RoomHeader
        roomId={roomId}
        participantCount={totalMembersCount}
        onOpenNicknames={() => {
          setSelectedPeerForNickname(null);
          setIsNicknamesOpen(true);
        }}
        quality={connectionQuality}
      />

      {/* Main Grid View Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-2.5 sm:px-6 py-3 sm:py-6 flex flex-col justify-center">
        {/* Loading Spinner during initial setup */}
        {isConnecting && (
          <div className="flex flex-col items-center justify-center py-16 text-white/70 gap-3">
            <div className="w-10 h-10 border-2 border-white/20 border-t-indigo-400 rounded-full animate-spin" />
            <span className="text-xs font-medium">در حال اتصال به اتاق صوتی و آماده‌سازی شبکه...</span>
          </div>
        )}

        {/* Spotlight Layout when someone shares screen */}
        {screenSharingParticipant ? (
          <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 w-full flex-1">
            {/* Spotlighted Screen */}
            <div className="flex-1 min-h-[240px] sm:min-h-[380px] lg:min-h-[500px]">
              <ParticipantCard
                participant={screenSharingParticipant.participant}
                isSelf={screenSharingParticipant.isSelf}
                displayName={getDisplayName(
                  screenSharingParticipant.participant.id,
                  screenSharingParticipant.participant.name
                )}
                isSpeaking={
                  screenSharingParticipant.isSelf
                    ? isLocalSpeaking
                    : !!remoteSpeaking[screenSharingParticipant.participant.id]
                }
                screenStream={screenStream}
                cameraStream={cameraStream}
                stream={
                  screenSharingParticipant.isSelf
                    ? null
                    : remoteStreams[screenSharingParticipant.participant.id]
                }
                isDeafenedLocal={isDeafened}
                onEditNickname={handleEditNickname}
              />
            </div>

            {/* Side participant strip */}
            <div className="w-full lg:w-72 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2.5 sm:gap-3 overflow-y-auto max-h-[500px]">
              {self && !screenSharingParticipant.isSelf && (
                <ParticipantCard
                  participant={self}
                  isSelf={true}
                  displayName={getDisplayName(self.id, self.name)}
                  isSpeaking={isLocalSpeaking}
                  cameraStream={cameraStream}
                  screenStream={screenStream}
                  isDeafenedLocal={isDeafened}
                  onEditNickname={handleEditNickname}
                />
              )}
              {self && screenSharingParticipant.isSelf && isCameraOn && (
                <ParticipantCard
                  participant={{ ...self, isScreenSharing: false }}
                  isSelf={true}
                  displayName={`${getDisplayName(self.id, self.name)} (دوربین)`}
                  isSpeaking={isLocalSpeaking}
                  cameraStream={cameraStream}
                  screenStream={null}
                  isDeafenedLocal={isDeafened}
                  onEditNickname={handleEditNickname}
                />
              )}
              {cleanRemoteParticipants
                .filter((p) => p.id !== screenSharingParticipant.participant.id)
                .map((peer) => (
                  <ParticipantCard
                    key={peer.id}
                    participant={peer}
                    isSelf={false}
                    displayName={getDisplayName(peer.id, peer.name)}
                    isSpeaking={!!remoteSpeaking[peer.id]}
                    stream={remoteStreams[peer.id]}
                    isDeafenedLocal={isDeafened}
                    onEditNickname={handleEditNickname}
                  />
                ))}
            </div>
          </div>
        ) : (
          /* Standard Gallery Grid Layout */
          <div
            className={`grid gap-2.5 sm:gap-4 w-full auto-rows-fr ${
              totalMembersCount === 1
                ? 'grid-cols-1 max-w-md mx-auto my-auto'
                : totalMembersCount === 2
                ? 'grid-cols-1 sm:grid-cols-2 max-w-4xl mx-auto my-auto'
                : totalMembersCount <= 4
                ? 'grid-cols-2 max-w-5xl mx-auto'
                : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
            }`}
          >
            {/* Self Participant Card */}
            {self && (
              <ParticipantCard
                participant={self}
                isSelf={true}
                displayName={getDisplayName(self.id, self.name)}
                isSpeaking={isLocalSpeaking}
                cameraStream={cameraStream}
                screenStream={screenStream}
                isDeafenedLocal={isDeafened}
                onEditNickname={handleEditNickname}
              />
            )}

            {/* Remote Participants Cards */}
            {cleanRemoteParticipants.map((peer) => (
              <ParticipantCard
                key={peer.id}
                participant={peer}
                isSelf={false}
                displayName={getDisplayName(peer.id, peer.name)}
                isSpeaking={!!remoteSpeaking[peer.id]}
                stream={remoteStreams[peer.id]}
                isDeafenedLocal={isDeafened}
                onEditNickname={handleEditNickname}
              />
            ))}
          </div>
        )}

        {/* Solo helper card when waiting for friends */}
        {participants.length === 0 && !isConnecting && (
          <div className="mt-8 mx-auto max-w-md p-6 rounded-3xl bg-white/5 border border-white/10 text-center backdrop-blur-md shadow-2xl">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-white/50 mx-auto mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold tracking-wider text-white uppercase mb-1">
              در انتظار پیوستن دوستان...
            </h3>
            <p className="text-xs text-white/60 mb-5 leading-relaxed">
              لینک یا کد اتاق را برای دوستان بفرستید یا در تبی دیگر باز کنید تا مستقیماً به گفتگوی صوتی و تصویری شما متصل شوند.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                id="btn-copy-invite-empty-state"
                onClick={handleCopyInvite}
                className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 active:scale-95 text-white font-medium text-xs flex items-center gap-2 shadow-lg transition-all cursor-pointer backdrop-blur-md"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? 'لینک کپی شد!' : 'کپی لینک دعوت'}</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Media Controls Bar */}
      <ControlsBar
        isMuted={isMuted}
        isDeafened={isDeafened}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        isNoiseSuppression={isNoiseSuppression}
        onToggleMute={toggleMute}
        onToggleDeafen={toggleDeafen}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
        onToggleNoiseSuppression={toggleNoiseSuppression}
        onDisconnect={disconnect}
        onOpenNicknames={() => {
          setSelectedPeerForNickname(null);
          setIsNicknamesOpen(true);
        }}
        onToggleChat={() => setIsChatOpen((prev) => !prev)}
        onSendReaction={sendReaction}
        participantsCount={totalMembersCount}
        unreadCount={messages.length}
      />

      {/* Nickname Management Modal */}
      <NicknameModal
        isOpen={isNicknamesOpen}
        onClose={() => setIsNicknamesOpen(false)}
        participants={participants}
        self={self}
        nicknames={nicknames}
        onSetNickname={setNickname}
        onRemoveNickname={removeNickname}
        selectedParticipantId={selectedPeerForNickname}
      />

      {/* Chat & Reactions Drawer */}
      <ChatAndReactions
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        messages={messages}
        reactions={reactions}
        onSendMessage={sendMessage}
        selfId={self?.id || ''}
      />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#090d16] flex items-center justify-center text-slate-500">در حال بارگذاری...</div>}>
      <VoiceChatApp />
    </Suspense>
  );
}
