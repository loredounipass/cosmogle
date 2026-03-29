// WebRTC SDP Module

export async function createOffer(pc) {
  if (!pc) return null;
  
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });
  
  await pc.setLocalDescription(offer);
  return pc.localDescription;
}

export async function createAnswer(pc) {
  if (!pc) return null;
  
  const answer = await pc.createAnswer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });
  
  await pc.setLocalDescription(answer);
  return pc.localDescription;
}

export async function setRemoteDescription(pc, sdp) {
  if (!pc) return;
  
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

export function handleSdpMessage(pc, sdp, userType) {
  if (!pc) return;
  
  // If already stable and receiving answer, ignore
  if (pc.signalingState === 'stable' && sdp.type === 'answer') {
    return;
  }
  
  return setRemoteDescription(pc, sdp)
    .then(() => {
      if (userType === 'p2' && sdp.type === 'offer') {
        return createAnswer(pc);
      }
      return null;
    })
    .then(answer => {
      return answer ? pc.setLocalDescription(answer) : Promise.resolve();
    });
}
