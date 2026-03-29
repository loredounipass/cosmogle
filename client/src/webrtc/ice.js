// WebRTC ICE Module

export async function addIceCandidate(pc, candidate) {
  if (!pc) return;
  
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('[ICE] Error adding candidate:', err);
  }
}

export function processPendingIceCandidates(pc, candidates) {
  if (!pc || !candidates.length) return;
  
  candidates.forEach(candidate => {
    addIceCandidate(pc, candidate);
  });
}

export function handleIceMessage(pc, candidate, onAdded) {
  if (!pc) return false;
  
  // Check if remote description is set
  if (!pc.remoteDescription || !pc.remoteDescription.type) {
    return false; // Need to queue
  }
  
  addIceCandidate(pc, candidate);
  return true;
}
