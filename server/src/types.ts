// PEER CONNECTION DATA
export interface Peer {
  socketId: string;
  clientId: string | null;
}


// ROOM STATE WITH TWO PEER SLOTS
export interface Room {
  roomId: string;
  p1: Peer | null;
  p2: Peer | null;
  createdAt: number;
}


// PEER ROLE IDENTIFIER
export type PeerRole = 'p1' | 'p2';


// PEER INFO WITH PARTNER REFERENCE
export interface PeerInfo {
  role: PeerRole;
  partnerId: string | null;
  roomId: string;
}


// RESULT TYPE FOR SOCKET ROLE LOOKUP
export type GetTypesResult =
  | { type: PeerRole; partnerId: string | null; roomId: string }
  | false;