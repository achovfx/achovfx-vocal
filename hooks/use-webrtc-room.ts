'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Participant, SignalPayload, ChatMessage, ReactionItem } from '@/types/voice-chat';
import { sounds } from '@/lib/sound-effects';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
    { urls: 'stun:stun.relay.metered.ca:80' },
  ],
  iceCandidatePoolSize: 10,
};

interface UseWebRTCRoomProps {
  roomId: string;
  userName: string;
  onLeave?: () => void;
}

export function useWebRTCRoom({ roomId, userName, onLeave }: UseWebRTCRoomProps) {
  const [self, setSelf] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isNoiseSuppression, setIsNoiseSuppression] = useState(true);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [remoteSpeaking, setRemoteSpeaking] = useState<Record<string, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionItem[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'fair' | 'poor'>('good');

  // Refs for WebRTC & Audio internals
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const remoteAnalysersRef = useRef<Map<string, { ctx: AudioContext; analyser: AnalyserNode }>>(new Map());
  const lastSignalTimeRef = useRef<number>(0);
  const processedSignals = useRef<Set<string>>(new Set());
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const selfRef = useRef<Participant | null>(null);
  const participantIdRef = useRef<string>('');
  const isDeafenedRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const isNoiseSuppressionRef = useRef<boolean>(true);
  const isLocalSpeakingRef = useRef<boolean>(false);

  useEffect(() => {
    isNoiseSuppressionRef.current = isNoiseSuppression;
  }, [isNoiseSuppression]);

  useEffect(() => {
    selfRef.current = self;
  }, [self]);

  useEffect(() => {
    isDeafenedRef.current = isDeafened;
  }, [isDeafened]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isLocalSpeakingRef.current = isLocalSpeaking;
  }, [isLocalSpeaking]);

  // Audio measurement loop for local speech detection
  const setupLocalAudioAnalyser = useCallback((stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current || isMutedRef.current) {
          setIsLocalSpeaking(false);
          animFrameRef.current = requestAnimationFrame(checkVolume);
          return;
        }

        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        const speaking = avg > 14; // threshold
        setIsLocalSpeaking(speaking);

        animFrameRef.current = requestAnimationFrame(checkVolume);
      };

      animFrameRef.current = requestAnimationFrame(checkVolume);
    } catch {
      // Ignore audio analyser error
    }
  }, []);

  // Setup remote audio analyser for speaking detection
  const setupRemoteAudioAnalyser = useCallback((participantId: string, stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      remoteAnalysersRef.current.set(participantId, { ctx, analyser });

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const interval = setInterval(() => {
        if (!remoteAnalysersRef.current.has(participantId)) {
          clearInterval(interval);
          return;
        }
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length;
        const speaking = avg > 14 && !isDeafenedRef.current;
        setRemoteSpeaking((prev) => {
          if (prev[participantId] === speaking) return prev;
          return { ...prev, [participantId]: speaking };
        });
      }, 150);
    } catch {
      // ignore
    }
  }, []);

  // Broadcast signaling via both BroadcastChannel and API
  const emitSignal = useCallback(
    async (payload: SignalPayload, toId?: string) => {
      const selfId = selfRef.current?.id || participantIdRef.current;
      if (!selfId) return;

      // BroadcastChannel for instant local cross-tab sync
      if (broadcastChannelRef.current) {
        try {
          broadcastChannelRef.current.postMessage({
            from: selfId,
            to: toId,
            payload,
            timestamp: Date.now(),
          });
        } catch {
          // ignore
        }
      }

      // API for cross-device / remote sync
      try {
        await fetch('/api/room/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            fromId: selfId,
            toId,
            payload,
          }),
        });
      } catch {
        // ignore
      }
    },
    [roomId]
  );

  // Initialize RTCPeerConnection for a remote peer
  const getOrCreatePeerConnection = useCallback(
    (remotePeerId: string): RTCPeerConnection => {
      let pc = peerConnections.current.get(remotePeerId);
      if (pc && pc.signalingState !== 'closed') {
        return pc;
      }

      pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnections.current.set(remotePeerId, pc);

      // Pre-add transceivers to guarantee bidirectional audio & video negotiation
      try {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
        pc.addTransceiver('video', { direction: 'sendrecv' });
      } catch {
        // ignore if not supported
      }

      // Add local audio tracks if available
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          try {
            const sender = pc?.getSenders().find((s) => s.track?.kind === 'audio');
            if (sender) {
              sender.replaceTrack(track);
            } else {
              pc?.addTrack(track, localStreamRef.current!);
            }
          } catch {
            // ignore
          }
        });
      }

      // Add active video track (screen share has priority over camera)
      const activeVideoStream = screenStreamRef.current || cameraStreamRef.current;
      const activeVideoTrack = activeVideoStream?.getVideoTracks()[0];
      if (activeVideoTrack && activeVideoStream) {
        try {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(activeVideoTrack);
          } else {
            pc.addTrack(activeVideoTrack, activeVideoStream);
          }
        } catch {
          // ignore
        }
      }

      // Handle remote tracks (both audio and video)
      pc.ontrack = (event) => {
        const [incomingStream] = event.streams;

        setRemoteStreams((prev) => {
          const existing = prev[remotePeerId];
          const combined = new MediaStream();

          // Retain live tracks from previous stream of other kinds
          if (existing) {
            existing.getTracks().forEach((t) => {
              if (t.readyState === 'live' && t.kind !== event.track.kind) {
                combined.addTrack(t);
              }
            });
          }

          if (incomingStream) {
            incomingStream.getTracks().forEach((t) => {
              if (!combined.getTracks().some((ct) => ct.id === t.id)) {
                combined.addTrack(t);
              }
            });
          } else {
            combined.addTrack(event.track);
          }

          if (event.track.kind === 'audio') {
            setupRemoteAudioAnalyser(remotePeerId, combined);

            // Directly play remote audio in background
            try {
              let audioEl = remoteAudioElementsRef.current.get(remotePeerId);
              if (!audioEl) {
                audioEl = new Audio();
                audioEl.autoplay = true;
                (audioEl as unknown as { playsInline: boolean }).playsInline = true;
                remoteAudioElementsRef.current.set(remotePeerId, audioEl);
              }
              audioEl.srcObject = combined;
              audioEl.muted = isDeafenedRef.current;
              const playPromise = audioEl.play();
              if (playPromise !== undefined) {
                playPromise.catch(() => {});
              }
            } catch {
              // ignore
            }
          }

          return {
            ...prev,
            [remotePeerId]: combined,
          };
        });

        event.track.onended = () => {
          setRemoteStreams((prev) => {
            const existing = prev[remotePeerId];
            if (!existing) return prev;
            existing.removeTrack(event.track);
            return {
              ...prev,
              [remotePeerId]: new MediaStream(existing.getTracks()),
            };
          });
        };
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const myId = selfRef.current?.id || participantIdRef.current;
          emitSignal(
            {
              type: 'ice-candidate',
              from: myId,
              to: remotePeerId,
              candidate: event.candidate.toJSON(),
            },
            remotePeerId
          );
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'failed' || pc?.connectionState === 'disconnected') {
          setConnectionQuality('fair');
        } else if (pc?.connectionState === 'connected') {
          setConnectionQuality('good');
        }
      };

      return pc;
    },
    [emitSignal, setupRemoteAudioAnalyser]
  );

  // Initiate call with peer (offer)
  const initiateOfferToPeer = useCallback(
    async (remotePeerId: string) => {
      try {
        const pc = getOrCreatePeerConnection(remotePeerId);
        const myId = selfRef.current?.id || participantIdRef.current;
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);

        emitSignal(
          {
            type: 'sdp-offer',
            from: myId,
            to: remotePeerId,
            sdp: offer,
          },
          remotePeerId
        );
      } catch (err) {
        console.warn('Error creating offer:', err);
      }
    },
    [emitSignal, getOrCreatePeerConnection]
  );

  // Handle incoming signaling message
  const handleIncomingSignal = useCallback(
    async (payload: SignalPayload, fromId: string) => {
      const myId = selfRef.current?.id || participantIdRef.current;
      if (!myId || fromId === myId || fromId === participantIdRef.current) return;

      switch (payload.type) {
        case 'join': {
          const newParticipant = payload.participant;
          // Never add self as a remote participant
          if (
            newParticipant.id === myId ||
            newParticipant.id === participantIdRef.current
          ) {
            return;
          }
          sounds.playJoin();
          setParticipants((prev) => {
            if (prev.some((p) => p.id === newParticipant.id)) return prev;
            return [...prev, newParticipant];
          });
          initiateOfferToPeer(newParticipant.id);
          break;
        }

        case 'leave': {
          sounds.playLeave();
          const pId = payload.participantId;
          setParticipants((prev) => prev.filter((p) => p.id !== pId));
          setRemoteSpeaking((prev) => {
            const next = { ...prev };
            delete next[pId];
            return next;
          });
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[pId];
            return next;
          });
          const audioEl = remoteAudioElementsRef.current.get(pId);
          if (audioEl) {
            audioEl.srcObject = null;
            remoteAudioElementsRef.current.delete(pId);
          }
          const pc = peerConnections.current.get(pId);
          if (pc) {
            pc.close();
            peerConnections.current.delete(pId);
          }
          pendingCandidatesRef.current.delete(pId);
          const analyserObj = remoteAnalysersRef.current.get(pId);
          if (analyserObj) {
            analyserObj.ctx.close().catch(() => {});
            remoteAnalysersRef.current.delete(pId);
          }
          break;
        }

        case 'state-update': {
          setParticipants((prev) =>
            prev.map((p) =>
              p.id === payload.participantId ? { ...p, ...payload.updates } : p
            )
          );
          if (payload.participantId === myId) {
            setSelf((prev) => (prev ? { ...prev, ...payload.updates } : null));
          }
          break;
        }

        case 'sdp-offer': {
          if (!payload.to || payload.to === myId) {
            try {
              const pc = getOrCreatePeerConnection(fromId);
              if (pc.signalingState !== 'stable') {
                if (myId < fromId) {
                  // Polite peer rolls back in case of glare collision
                  await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
                } else {
                  return;
                }
              }
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

              // Flush queued candidates
              const pending = pendingCandidatesRef.current.get(fromId) || [];
              for (const cand of pending) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
              }
              pendingCandidatesRef.current.delete(fromId);

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              emitSignal(
                {
                  type: 'sdp-answer',
                  from: myId,
                  to: fromId,
                  sdp: answer,
                },
                fromId
              );
            } catch (err) {
              console.warn('Error handling SDP offer:', err);
            }
          }
          break;
        }

        case 'sdp-answer': {
          if (!payload.to || payload.to === myId) {
            try {
              const pc = peerConnections.current.get(fromId);
              if (pc && pc.signalingState !== 'stable') {
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

                // Flush queued candidates
                const pending = pendingCandidatesRef.current.get(fromId) || [];
                for (const cand of pending) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
                pendingCandidatesRef.current.delete(fromId);
              }
            } catch (err) {
              console.warn('Error handling SDP answer:', err);
            }
          }
          break;
        }

        case 'ice-candidate': {
          if (!payload.to || payload.to === myId) {
            try {
              const pc = getOrCreatePeerConnection(fromId);
              if (pc.remoteDescription && pc.remoteDescription.type) {
                if (payload.candidate) {
                  await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
                }
              } else {
                // Queue candidate until remoteDescription is ready
                if (payload.candidate) {
                  const list = pendingCandidatesRef.current.get(fromId) || [];
                  list.push(payload.candidate);
                  pendingCandidatesRef.current.set(fromId, list);
                }
              }
            } catch (err) {
              console.warn('Error handling ICE candidate:', err);
            }
          }
          break;
        }

        case 'chat-message': {
          sounds.playPop();
          setMessages((prev) => [
            ...prev,
            {
              id: payload.id,
              from: payload.from,
              senderName: payload.senderName,
              text: payload.text,
              timestamp: payload.timestamp,
            },
          ]);
          break;
        }

        case 'reaction': {
          sounds.playPop();
          setReactions((prev) => [
            ...prev,
            {
              id: payload.id,
              from: payload.from,
              emoji: payload.emoji,
              xOffset: Math.random() * 80 + 10,
            },
          ]);
          setTimeout(() => {
            setReactions((prev) => prev.filter((r) => r.id !== payload.id));
          }, 3500);
          break;
        }
      }
    },
    [emitSignal, getOrCreatePeerConnection, initiateOfferToPeer]
  );

  // Initialize room, audio, and network listeners
  useEffect(() => {
    let isMounted = true;

    // Stable participantId per tab session to avoid ghost clones upon remounts or refreshes
    let participantId = '';
    try {
      const key = `aura_p_${roomId}`;
      const existing = typeof window !== 'undefined' ? sessionStorage.getItem(key) : null;
      if (existing && existing.startsWith('user_')) {
        participantId = existing;
      } else {
        participantId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        if (typeof window !== 'undefined') sessionStorage.setItem(key, participantId);
      }
    } catch {
      participantId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    participantIdRef.current = participantId;

    const currentPCs = peerConnections.current;
    const currentAnalysers = remoteAnalysersRef.current;
    const currentPendingCandidates = pendingCandidatesRef.current;
    const currentAudioElements = remoteAudioElementsRef.current;

    const handlePageUnload = () => {
      const idToLeave = selfRef.current?.id || participantIdRef.current || participantId;
      if (!idToLeave) return;
      const payload = JSON.stringify({ roomId, participantId: idToLeave });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/room/leave', blob);
      } else {
        fetch('/api/room/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', handlePageUnload);
    window.addEventListener('pagehide', handlePageUnload);

    async function initRoom() {
      setIsConnecting(true);

      // Get local microphone audio
      let audioStream: MediaStream | null = null;
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        if (isMounted) {
          setLocalStream(audioStream);
          localStreamRef.current = audioStream;
          setupLocalAudioAnalyser(audioStream);
        }
      } catch (err) {
        console.warn('Microphone access not granted or unavailable:', err);
      }

      // Join room via API
      try {
        const res = await fetch('/api/room/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            participantId,
            name: userName,
          }),
        });

        const data = await res.json();
        if (!isMounted) {
          // If unmounted before fetch resolved (e.g. React Strict Mode in dev), leave immediately
          fetch('/api/room/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, participantId }),
            keepalive: true,
          }).catch(() => {});
          return;
        }

        if (data.success) {
          const myId = data.self.id;
          setSelf(data.self);
          selfRef.current = data.self;

          // Filter out self or any stale clone with own ID from remote participants
          const cleanOthers = (data.others || []).filter(
            (o: Participant) => o.id !== myId && o.id !== participantId
          );
          setParticipants(cleanOthers);
          setIsConnected(true);
          setIsConnecting(false);
          sounds.playJoin();

          // Connect with existing members
          if (cleanOthers.length > 0) {
            cleanOthers.forEach((other: Participant) => {
              initiateOfferToPeer(other.id);
            });
          }
        }
      } catch (err) {
        console.error('Failed to join room:', err);
        if (isMounted) setIsConnecting(false);
      }

      // Setup BroadcastChannel for zero-latency local multi-tab sync
      try {
        const channelName = `aura_room_${roomId}`;
        const bc = new BroadcastChannel(channelName);
        broadcastChannelRef.current = bc;

        bc.onmessage = (e) => {
          const { from, to, payload, timestamp } = e.data;
          const myId = selfRef.current?.id || participantIdRef.current;
          if (!from || from === myId || from === participantId) return;
          if (to && to !== myId && to !== participantId) return;

          const signalKey = `${from}_${payload.type}_${timestamp}`;
          if (processedSignals.current.has(signalKey)) return;
          processedSignals.current.add(signalKey);

          handleIncomingSignal(payload, from);
        };
      } catch {
        // BroadcastChannel might not be supported in some embedded contexts
      }

      // Start Polling for remote updates (every 600ms for fast signaling)
      const pollInterval = setInterval(async () => {
        if (!isMounted || (!selfRef.current && !participantIdRef.current)) return;
        const currentId = selfRef.current?.id || participantIdRef.current;
        try {
          const res = await fetch('/api/room/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId,
              participantId: currentId,
              lastSignalTimestamp: lastSignalTimeRef.current,
              updates: {
                isMuted: isMutedRef.current,
                isDeafened: isDeafenedRef.current,
                isCameraOn: !!cameraStreamRef.current,
                isScreenSharing: !!screenStreamRef.current,
                isSpeaking: isLocalSpeakingRef.current,
              },
            }),
          });

          if (!res.ok) return;
          const data = await res.json();

          if (data.signals && data.signals.length > 0) {
            for (const sig of data.signals) {
              const signalKey = `${sig.from}_${sig.payload.type}_${sig.timestamp}`;
              if (!processedSignals.current.has(signalKey)) {
                processedSignals.current.add(signalKey);
                handleIncomingSignal(sig.payload, sig.from);
              }
              if (sig.timestamp > lastSignalTimeRef.current) {
                lastSignalTimeRef.current = sig.timestamp;
              }
            }
          }

          // Sync members list if members disconnected or joined
          if (data.currentMembers) {
            const myId = selfRef.current?.id || participantIdRef.current;
            const remoteMembers = data.currentMembers.filter(
              (m: Participant) => m.id !== myId && m.id !== participantId
            );
            setParticipants(remoteMembers);

            // Ensure connection to all remote members
            remoteMembers.forEach((peer: Participant) => {
              const pc = peerConnections.current.get(peer.id);
              const isDisconnected =
                !pc || pc.connectionState === 'closed' || pc.connectionState === 'failed';
              if (isDisconnected) {
                initiateOfferToPeer(peer.id);
              }
            });
          }
        } catch {
          // network hiccup
        }
      }, 600);

      pollingTimerRef.current = pollInterval;
    }

    initRoom();

    return () => {
      isMounted = false;
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      window.removeEventListener('beforeunload', handlePageUnload);
      window.removeEventListener('pagehide', handlePageUnload);

      const idToLeave = selfRef.current?.id || participantIdRef.current || participantId;
      if (idToLeave) {
        // Notify others
        if (broadcastChannelRef.current) {
          try {
            broadcastChannelRef.current.postMessage({
              from: idToLeave,
              payload: { type: 'leave', participantId: idToLeave },
              timestamp: Date.now(),
            });
            broadcastChannelRef.current.close();
          } catch {
            // ignore
          }
        }
        fetch('/api/room/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, participantId: idToLeave }),
          keepalive: true,
        }).catch(() => {});
      }

      // Cleanup media tracks
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());

      // Cleanup WebRTC connections
      currentPCs.forEach((pc) => pc.close());
      currentPCs.clear();
      currentPendingCandidates.clear();

      // Cleanup remote audio elements
      currentAudioElements.forEach((el) => {
        el.pause();
        el.srcObject = null;
      });
      currentAudioElements.clear();

      // Cleanup AudioContexts
      audioContextRef.current?.close().catch(() => {});
      currentAnalysers.forEach(({ ctx }) => ctx.close().catch(() => {}));
      currentAnalysers.clear();
    };
  }, [roomId, userName, handleIncomingSignal, initiateOfferToPeer, setupLocalAudioAnalyser]);

  // Unlock browser audio upon initial user interaction (mobile Safari / Chrome autoplay policy)
  useEffect(() => {
    const unlockAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
      remoteAudioElementsRef.current.forEach((audioEl) => {
        if (audioEl.paused && audioEl.srcObject) {
          audioEl.play().catch(() => {});
        }
      });
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // Toggle Microphone
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;

    const newMuted = !isMuted;
    audioTrack.enabled = !newMuted;
    setIsMuted(newMuted);
    setSelf((prev) => (prev ? { ...prev, isMuted: newMuted } : null));

    if (newMuted) {
      sounds.playMute();
      setIsLocalSpeaking(false);
    } else {
      sounds.playUnmute();
    }

    if (selfRef.current) {
      emitSignal({
        type: 'state-update',
        participantId: selfRef.current.id,
        updates: { isMuted: newMuted },
      });
    }
  }, [isMuted, emitSignal]);

  // Toggle Deafen (Mute all incoming sound)
  const toggleDeafen = useCallback(() => {
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);
    setSelf((prev) => (prev ? { ...prev, isDeafened: newDeafened } : null));

    if (newDeafened) {
      sounds.playMute();
    } else {
      sounds.playUnmute();
    }

    remoteAudioElementsRef.current.forEach((audioEl) => {
      audioEl.muted = newDeafened;
    });

    if (selfRef.current) {
      emitSignal({
        type: 'state-update',
        participantId: selfRef.current.id,
        updates: { isDeafened: newDeafened },
      });
    }
  }, [isDeafened, emitSignal]);

  // Toggle Local Noise Suppression
  const toggleNoiseSuppression = useCallback(async () => {
    const nextVal = !isNoiseSuppression;
    setIsNoiseSuppression(nextVal);
    sounds.playPop();

    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        try {
          if (typeof audioTrack.applyConstraints === 'function') {
            await audioTrack.applyConstraints({
              noiseSuppression: nextVal,
              echoCancellation: true,
              autoGainControl: true,
            });
            return;
          }
        } catch (err) {
          console.warn('Direct applyConstraints failed, falling back to track replacement:', err);
        }

        // Fallback: Re-acquire stream with updated constraint and replaceTrack
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              noiseSuppression: nextVal,
              echoCancellation: true,
              autoGainControl: true,
            },
            video: false,
          });

          const newAudioTrack = newStream.getAudioTracks()[0];
          if (newAudioTrack) {
            newAudioTrack.enabled = !isMutedRef.current;

            // Replace track in peer connections seamlessly without dropping call
            peerConnections.current.forEach((pc) => {
              const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
              if (sender) {
                sender.replaceTrack(newAudioTrack);
              }
            });

            // Stop old audio track
            audioTrack.stop();

            // Replace in local stream
            localStreamRef.current.removeTrack(audioTrack);
            localStreamRef.current.addTrack(newAudioTrack);
            setLocalStream(localStreamRef.current);
            setupLocalAudioAnalyser(localStreamRef.current);
          }
        } catch (fallbackErr) {
          console.warn('Could not re-acquire audio stream with updated noise suppression:', fallbackErr);
        }
      }
    }
  }, [isNoiseSuppression, setupLocalAudioAnalyser]);

  // Toggle Camera
  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      // Stop Camera
      cameraStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      // Update peer connection senders
      peerConnections.current.forEach((pc) => {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video' || (s.track === null && (s as unknown as { track?: MediaStreamTrack; kind?: string }).kind === 'video'));
        if (videoSender) {
          // If screen share is still active, fall back to screen track
          const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
          if (screenTrack) {
            videoSender.replaceTrack(screenTrack).catch(() => {});
          } else {
            videoSender.replaceTrack(null).catch(() => {});
          }
        }
      });

      cameraStreamRef.current = null;
      setCameraStream(null);
      setIsCameraOn(false);
      setSelf((prev) => (prev ? { ...prev, isCameraOn: false } : null));

      // Renegotiate with peers so they know camera has stopped
      peerConnections.current.forEach((_pc, peerId) => {
        initiateOfferToPeer(peerId);
      });

      if (selfRef.current) {
        emitSignal({
          type: 'state-update',
          participantId: selfRef.current.id,
          updates: { isCameraOn: false },
        });
      }
    } else {
      // Start Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });

        cameraStreamRef.current = stream;
        setCameraStream(stream);
        setIsCameraOn(true);
        setSelf((prev) => (prev ? { ...prev, isCameraOn: true } : null));

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          // If not currently screen sharing, broadcast camera track
          if (!screenStreamRef.current) {
            peerConnections.current.forEach((pc, peerId) => {
              const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video' || (s.track === null && (s as unknown as { track?: MediaStreamTrack; kind?: string }).kind === 'video'));
              if (videoSender) {
                videoSender.replaceTrack(videoTrack).catch(() => {});
              } else {
                try {
                  pc.addTrack(videoTrack, stream);
                } catch {
                  // ignore
                }
              }
              initiateOfferToPeer(peerId);
            });
          }

          videoTrack.onended = () => {
            setIsCameraOn(false);
            setCameraStream(null);
            cameraStreamRef.current = null;
            setSelf((prev) => (prev ? { ...prev, isCameraOn: false } : null));

            peerConnections.current.forEach((pc) => {
              const videoSender = pc.getSenders().find((s) => s.track === videoTrack);
              if (videoSender) {
                const screenTrack = screenStreamRef.current?.getVideoTracks()[0];
                if (screenTrack) {
                  videoSender.replaceTrack(screenTrack).catch(() => {});
                } else {
                  videoSender.replaceTrack(null).catch(() => {});
                }
              }
            });

            peerConnections.current.forEach((_pc, peerId) => {
              initiateOfferToPeer(peerId);
            });

            if (selfRef.current) {
              emitSignal({
                type: 'state-update',
                participantId: selfRef.current.id,
                updates: { isCameraOn: false },
              });
            }
          };
        }

        if (selfRef.current) {
          emitSignal({
            type: 'state-update',
            participantId: selfRef.current.id,
            updates: { isCameraOn: true },
          });
        }
      } catch (err) {
        console.warn('Camera access denied or error:', err);
      }
    }
  }, [isCameraOn, emitSignal, initiateOfferToPeer]);

  // Toggle Screen Sharing
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen share
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      peerConnections.current.forEach((pc) => {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video' || (s.track === null && (s as unknown as { track?: MediaStreamTrack; kind?: string }).kind === 'video'));
        if (videoSender) {
          // Fall back to camera track if camera is still active
          const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
          if (cameraTrack) {
            videoSender.replaceTrack(cameraTrack).catch(() => {});
          } else {
            videoSender.replaceTrack(null).catch(() => {});
          }
        }
      });

      screenStreamRef.current = null;
      setScreenStream(null);
      setIsScreenSharing(false);
      setSelf((prev) => (prev ? { ...prev, isScreenSharing: false } : null));

      peerConnections.current.forEach((_pc, peerId) => {
        initiateOfferToPeer(peerId);
      });

      if (selfRef.current) {
        emitSignal({
          type: 'state-update',
          participantId: selfRef.current.id,
          updates: { isScreenSharing: false },
        });
      }
    } else {
      // Start screen share
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });

        screenStreamRef.current = stream;
        setScreenStream(stream);
        setIsScreenSharing(true);
        setSelf((prev) => (prev ? { ...prev, isScreenSharing: true } : null));

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          peerConnections.current.forEach((pc, peerId) => {
            const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video' || (s.track === null && (s as unknown as { track?: MediaStreamTrack; kind?: string }).kind === 'video'));
            if (videoSender) {
              videoSender.replaceTrack(videoTrack).catch(() => {});
            } else {
              try {
                pc.addTrack(videoTrack, stream);
              } catch {
                // ignore
              }
            }
            initiateOfferToPeer(peerId);
          });

          // Handle user clicking "Stop sharing" on system bar
          videoTrack.onended = () => {
            setIsScreenSharing(false);
            setScreenStream(null);
            screenStreamRef.current = null;
            setSelf((prev) => (prev ? { ...prev, isScreenSharing: false } : null));

            peerConnections.current.forEach((pc) => {
              const videoSender = pc.getSenders().find((s) => s.track === videoTrack);
              if (videoSender) {
                const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0];
                if (cameraTrack) {
                  videoSender.replaceTrack(cameraTrack).catch(() => {});
                } else {
                  videoSender.replaceTrack(null).catch(() => {});
                }
              }
            });

            peerConnections.current.forEach((_pc, peerId) => {
              initiateOfferToPeer(peerId);
            });

            if (selfRef.current) {
              emitSignal({
                type: 'state-update',
                participantId: selfRef.current.id,
                updates: { isScreenSharing: false },
              });
            }
          };
        }

        if (selfRef.current) {
          emitSignal({
            type: 'state-update',
            participantId: selfRef.current.id,
            updates: { isScreenSharing: true },
          });
        }
      } catch (err) {
        console.warn('Screen share cancelled or error:', err);
      }
    }
  }, [isScreenSharing, emitSignal, initiateOfferToPeer]);

  // Send Text Message
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || !selfRef.current) return;
      const msg: ChatMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        from: selfRef.current.id,
        senderName: selfRef.current.name,
        text: text.trim(),
        timestamp: Date.now(),
        colorHex: selfRef.current.color.border,
      };

      setMessages((prev) => [...prev, msg]);
      sounds.playPop();

      emitSignal({
        type: 'chat-message',
        id: msg.id,
        from: msg.from,
        senderName: msg.senderName,
        text: msg.text,
        timestamp: msg.timestamp,
      });
    },
    [emitSignal]
  );

  // Send Reaction
  const sendReaction = useCallback(
    (emoji: string) => {
      if (!selfRef.current) return;
      const id = `react_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      sounds.playPop();

      setReactions((prev) => [
        ...prev,
        {
          id,
          from: selfRef.current!.id,
          emoji,
          xOffset: Math.random() * 80 + 10,
        },
      ]);

      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, 3500);

      emitSignal({
        type: 'reaction',
        id,
        from: selfRef.current.id,
        emoji,
        timestamp: Date.now(),
      });
    },
    [emitSignal]
  );

  // Leave Call / Disconnect
  const disconnect = useCallback(() => {
    sounds.playLeave();
    const myId = selfRef.current?.id || participantIdRef.current;
    if (myId) {
      if (broadcastChannelRef.current) {
        try {
          broadcastChannelRef.current.postMessage({
            from: myId,
            payload: { type: 'leave', participantId: myId },
            timestamp: Date.now(),
          });
        } catch {
          // ignore
        }
      }
      fetch('/api/room/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, participantId: myId }),
        keepalive: true,
      }).catch(() => {});
    }

    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`aura_p_${roomId}`);
      }
    } catch {
      // ignore
    }

    if (onLeave) {
      onLeave();
    }
  }, [roomId, onLeave]);

  return {
    self,
    participants,
    isConnected,
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
    localStream,
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
  };
}
