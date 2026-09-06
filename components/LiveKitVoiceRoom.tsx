'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  LocalAudioTrack,
  Participant,
  RemoteParticipant,
  RemoteTrackPublication,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { LogOut, Mic, MicOff, Users, Volume2, VolumeX } from 'lucide-react';

interface LiveKitVoiceRoomProps {
  roomId: string;
  userName: string;
  onLeave: () => void;
}

function participantName(participant: Participant) {
  return participant.name || participant.identity.split('-').slice(1).join('-') || 'کاربر';
}

export default function LiveKitVoiceRoom({ roomId, userName, onLeave }: LiveKitVoiceRoomProps) {
  const roomRef = useRef<Room | null>(null);
  const localTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Connecting);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [error, setError] = useState('');

  const syncParticipants = useCallback((room: Room) => {
    setParticipants([room.localParticipant, ...Array.from(room.remoteParticipants.values())]);
  }, []);

  const attachTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach() as HTMLAudioElement;
    element.autoplay = true;
    element.setAttribute('data-livekit-participant', participant.identity);
    element.muted = false;
    element.volume = 1;
    document.body.appendChild(element);
    audioElementsRef.current.set(`${participant.identity}:${publication.trackSid}`, element);
  }, []);

  const detachTrack = useCallback((track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
    track.detach().forEach((element) => element.remove());
    audioElementsRef.current.delete(`${participant.identity}:${publication.trackSid}`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const onConnected = () => {
      if (!cancelled) {
        setConnectionState(ConnectionState.Connected);
        syncParticipants(room);
      }
    };
    const onDisconnected = () => {
      if (!cancelled) setConnectionState(ConnectionState.Disconnected);
    };
    const onParticipantChanged = () => syncParticipants(room);
    const onSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      attachTrack(track, publication, participant);
    };
    const onUnsubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      detachTrack(track, publication, participant);
    };

    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.ParticipantConnected, onParticipantChanged)
      .on(RoomEvent.ParticipantDisconnected, onParticipantChanged)
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
      .on(RoomEvent.LocalTrackPublished, onParticipantChanged)
      .on(RoomEvent.LocalTrackUnpublished, onParticipantChanged)
      .on(RoomEvent.ParticipantNameChanged, onParticipantChanged);

    async function connect() {
      try {
        setError('');
        const response = await fetch('/api/livekit/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: roomId, participantName: userName }),
        });
        const data = (await response.json()) as { token?: string; url?: string; error?: string };
        if (!response.ok || !data.token || !data.url) {
          throw new Error(data.error || 'توکن اتصال ساخته نشد');
        }

        await room.connect(data.url, data.token);
        if (cancelled) return;

        const localAudio = await room.localParticipant.setMicrophoneEnabled(true);
        if (localAudio) {
          localTrackRef.current = localAudio.track as LocalAudioTrack;
        }
        syncParticipants(room);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : 'اتصال به اتاق صوتی ناموفق بود');
        setConnectionState(ConnectionState.Disconnected);
      }
    }

    connect();

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ParticipantConnected, onParticipantChanged);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantChanged);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.LocalTrackPublished, onParticipantChanged);
      room.off(RoomEvent.LocalTrackUnpublished, onParticipantChanged);
      room.off(RoomEvent.ParticipantNameChanged, onParticipantChanged);
      audioElementsRef.current.forEach((element) => element.remove());
      audioElementsRef.current.clear();
      localTrackRef.current = null;
      room.disconnect();
      roomRef.current = null;
    };
  }, [attachTrack, detachTrack, roomId, syncParticipants, userName]);

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setIsMuted(next);
    syncParticipants(room);
  };

  const toggleDeafened = () => {
    const next = !isDeafened;
    setIsDeafened(next);
    audioElementsRef.current.forEach((element) => {
      element.muted = next;
    });
  };

  const leave = () => {
    roomRef.current?.disconnect();
    onLeave();
  };

  const statusText = connectionState === ConnectionState.Connected ? 'متصل' : connectionState === ConnectionState.Connecting ? 'در حال اتصال...' : 'قطع شده';

  return (
    <div dir="rtl" className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="border-b border-white/10 px-4 sm:px-8 py-4 flex items-center justify-between gap-4 bg-slate-950/90 backdrop-blur">
        <div>
          <div className="text-xs text-white/50">اتاق صوتی</div>
          <div className="font-semibold text-lg">{roomId}</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={`w-2 h-2 rounded-full ${connectionState === ConnectionState.Connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-white/70">{statusText}</span>
          <span className="text-white/40">{participants.length} نفر</span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-8 flex flex-col justify-center">
        {error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-red-100 mb-6">
            <div className="font-semibold mb-1">اتصال برقرار نشد</div>
            <div className="text-sm text-red-100/70">{error}</div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {participants.map((participant) => {
            const local = participant === roomRef.current?.localParticipant;
            const muted = local ? isMuted : !Array.from(participant.audioTrackPublications.values()).some((pub) => !pub.isMuted);
            return (
              <div key={participant.identity} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 min-h-40 flex flex-col justify-between shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-full bg-indigo-500/20 border border-indigo-300/20 flex items-center justify-center text-lg font-bold">
                    {participantName(participant).slice(0, 1).toUpperCase()}
                  </div>
                  {muted ? <MicOff className="w-5 h-5 text-white/40" /> : <Mic className="w-5 h-5 text-emerald-300" />}
                </div>
                <div>
                  <div className="font-semibold truncate">{participantName(participant)}{local ? ' (شما)' : ''}</div>
                  <div className="text-xs text-white/40 mt-1">{muted ? 'میکروفون خاموش' : 'میکروفون روشن'}</div>
                </div>
              </div>
            );
          })}
        </div>

        {participants.length === 0 && !error && (
          <div className="text-center text-white/50 py-16">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
            در حال پیدا کردن اعضای اتاق...
          </div>
        )}
      </main>

      <footer className="border-t border-white/10 bg-slate-950/95 backdrop-blur p-4 flex justify-center gap-3 sticky bottom-0">
        <button onClick={toggleMute} className="px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 transition flex items-center gap-2" type="button">
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          {isMuted ? 'روشن کردن میکروفون' : 'خاموش کردن میکروفون'}
        </button>
        <button onClick={toggleDeafened} className="p-3 rounded-full bg-white/10 hover:bg-white/15 transition" type="button" aria-label="قطع صدای دریافتی">
          {isDeafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <button onClick={leave} className="px-5 py-3 rounded-full bg-red-500/80 hover:bg-red-500 transition flex items-center gap-2" type="button">
          <LogOut className="w-5 h-5" /> خروج
        </button>
      </footer>
    </div>
  );
}
