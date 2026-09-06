import { ColorProfile } from '@/lib/colors';

export interface Participant {
  id: string;
  name: string;
  joinOrder: number;
  color: ColorProfile;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
  joinedAt: number;
  lastHeartbeat: number;
}

export type SignalPayload =
  | { type: 'join'; participant: Participant }
  | { type: 'leave'; participantId: string }
  | { type: 'state-update'; participantId: string; updates: Partial<Participant> }
  | { type: 'sdp-offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'sdp-answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'chat-message'; id: string; from: string; senderName: string; text: string; timestamp: number }
  | { type: 'reaction'; id: string; from: string; emoji: string; timestamp: number };

export interface ChatMessage {
  id: string;
  from: string;
  senderName: string;
  text: string;
  timestamp: number;
  colorHex?: string;
}

export interface ReactionItem {
  id: string;
  from: string;
  emoji: string;
  xOffset: number;
}
