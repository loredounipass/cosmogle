// ============================================
// TYPES — Strangers Server
// ============================================

export interface Peer {
  socketId: string;
  clientId: string | null;
}

export interface Room {
  roomId: string;
  p1: Peer | null;
  p2: Peer | null;
  createdAt: number;
}

export type PeerRole = 'p1' | 'p2';

export interface PeerInfo {
  role: PeerRole;
  partnerId: string | null;
  roomId: string;
}

export type GetTypesResult =
  | { type: PeerRole; partnerId: string | null; roomId: string }
  | false;