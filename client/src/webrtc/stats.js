// Stats Module

const QUALITY_PRESETS = {
  high: { maxBitrate: 5000000, minBitrate: 1500000 },
  medium: { maxBitrate: 2500000, minBitrate: 800000 },
  low: { maxBitrate: 1000000, minBitrate: 300000 }
};

let currentQualityLevel = 'high';
let statsInterval = null;
let lastBytesReceived = 0;
let lastCheckTime = 0;

export function getConnectionStats(pc, callback) {
  if (!pc || !callback) return;
  
  pc.getStats().then(stats => {
    let videoInbound = null;
    let candidatePair = null;
    
    stats.forEach(report => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') {
        videoInbound = report;
      }
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        candidatePair = report;
      }
    });
    
    callback({ videoInbound, candidatePair });
  }).catch(err => {
    console.warn('[STATS] Error:', err.message);
  });
}

export function startStatsMonitoring(pc, onStats, interval = 5000) {
  stopStatsMonitoring();
  
  statsInterval = setInterval(() => {
    getConnectionStats(pc, ({ videoInbound, candidatePair }) => {
      if (!videoInbound) return;
      
      const now = Date.now();
      if (lastCheckTime > 0) {
        const timeDiff = (now - lastCheckTime) / 1000;
        const bytesDiff = (videoInbound.bytesReceived || 0) - lastBytesReceived;
        const bitrateReceived = timeDiff > 0 ? Math.round((bytesDiff * 8) / timeDiff) : 0;
        
        onStats({ bitrateReceived, candidatePair, videoInbound });
      }
      
      lastBytesReceived = videoInbound.bytesReceived || 0;
      lastCheckTime = now;
    });
  }, interval);
}

export function stopStatsMonitoring() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  lastBytesReceived = 0;
  lastCheckTime = 0;
}

export function adaptBitrate(pc, bitrate, candidatePair) {
  if (!pc) return;
  
  const rtt = candidatePair?.currentRoundTripTime 
    ? candidatePair.currentRoundTripTime * 1000 
    : 0;
  
  let newQualityLevel = 'high';
  
  if (rtt > 400 || bitrate < 300000) {
    newQualityLevel = 'low';
  } else if (rtt > 200 || bitrate < 800000) {
    newQualityLevel = 'medium';
  }
  
  if (newQualityLevel !== currentQualityLevel) {
    const preset = QUALITY_PRESETS[newQualityLevel];
    console.log('[QUALITY] Changing:', currentQualityLevel, '->', newQualityLevel);
    currentQualityLevel = newQualityLevel;
    
    pc.getSenders().forEach(sender => {
      if (sender.track?.kind === 'video') {
        const params = sender.getParameters();
        if (params.encodings?.[0]) {
          params.encodings[0].maxBitrate = preset.maxBitrate;
          params.encodings[0].minBitrate = preset.minBitrate;
          sender.setParameters(params).catch(() => {});
        }
      }
    });
  }
}

export function checkPacketLoss(videoInbound) {
  if (!videoInbound) return 0;
  
  const packetsLost = videoInbound.packetsLost || 0;
  const totalPackets = (videoInbound.packetsReceived || 0) + packetsLost;
  
  return totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
}
