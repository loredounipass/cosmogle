// WebRTC Peer Connection Module

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  { urls: 'stun:stun.voiparound.com' },
  { urls: 'stun:stun.voipbuster.com' },
  { urls: 'turn:turn.bistriz.com:80', username: 'homeo', credential: 'homeo' },
  { urls: 'turn:turn.bistriz.com:443', username: 'homeo', credential: 'homeo' }
];

let iceFailedNotified = false;
let iceDisconnectedStartTime = 0;
let lastIceStateChange = Date.now();

export function createPeerConnection(config = {}) {
  const pc = new RTCPeerConnection({
    iceServers: config.iceServers || ICE_SERVERS,
    iceCandidatePoolSize: 20,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceTransportPolicy: 'all'
  });
  
  // Set up codec preferences
  const codecs = RTCRtpSender.getCapabilities('video')?.codecs || [];
  const codecPriority = ['vp8', 'vp9', 'av1', 'h264'];
  const sortedCodecs = codecPriority
    .map(prefix => codecs.filter(c => c.mimeType.toLowerCase().includes(prefix)))
    .filter(group => group.length > 0)
    .reduce((acc, group) => acc.concat(group), []);
  
  if (sortedCodecs.length > 0 && typeof pc.setCodecPreferences === 'function') {
    try {
      pc.setCodecPreferences(sortedCodecs);
    } catch (e) {
      console.warn('[PEER] Codec preferences not supported');
    }
  }
  
  return pc;
}

export function setupPeerConnectionHandlers(pc, handlers = {}) {
  const {
    onIceCandidate,
    onTrack,
    onConnectionStateChange,
    onIceConnectionStateChange,
    onNegotiationNeeded
  } = handlers;
  
  if (onIceCandidate) {
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        onIceCandidate(e.candidate);
      }
    };
  }
  
  if (onTrack) {
    pc.ontrack = (e) => {
      onTrack(e.streams[0], e.track.kind);
    };
  }
  
  if (onConnectionStateChange) {
    pc.onconnectionstatechange = () => {
      onConnectionStateChange(pc.connectionState);
    };
  }
  
  if (onIceConnectionStateChange) {
    pc.oniceconnectionstatechange = () => {
      onIceConnectionStateChange(pc.iceConnectionState, pc.iceGatheringState);
    };
  }
  
  if (onNegotiationNeeded) {
    pc.onnegotiationneeded = () => {
      onNegotiationNeeded();
    };
  }
}

export function addTracksToPeer(pc, stream) {
  if (!stream || !pc) return;
  
  stream.getTracks().forEach(track => {
    const existingSender = pc.getSenders().find(s => s.track?.kind === track.kind);
    if (!existingSender) {
      pc.addTrack(track, stream);
    }
  });
}

export function configureTrackQuality(pc, preferredConstraints) {
  if (!pc) return;
  
  const isHD = preferredConstraints?.width?.ideal >= 1920;
  const maxBitrate = isHD ? 6000000 : 4000000;
  const minBitrate = isHD ? 1500000 : 800000;
  
  pc.getSenders().forEach(sender => {
    if (!sender.track) return;
    
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    
    if (sender.track.kind === 'video') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate,
        minBitrate,
        scalabilityMode: 'L1T3',
        networkPriority: 'high'
      };
    } else if (sender.track.kind === 'audio') {
      params.encodings[0] = {
        ...params.encodings[0],
        maxBitrate: 128000,
        priority: 'high',
        networkPriority: 'high'
      };
    }
    
    sender.setParameters(params).catch(() => {});
  });
}

export function closePeerConnection(pc) {
  if (pc) {
    pc.close();
  }
}
