import { useRef, useState, useCallback } from 'react';

export const AppState = {
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  MATCHED: 'MATCHED',
  NEGOTIATING: 'NEGOTIATING',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
};

export function useAppState() {
  const stateRef = useRef({
    appState: AppState.IDLE,
    peer: null,
    localStream: null,
    remoteSocket: null,
    type: null,
    roomid: null,
    socket: null,
    isCameraOff: true,
    isMuted: false,
    isExiting: false,
    isNegotiating: false,
    isReconnecting: false,
    pendingSdp: null,
    pendingIceCandidates: [],
    retryCount: 0,
    videoPlayRetries: 0,
    iceServers: null,
    currentQualityLevel: 'high',
    _iceRestartAttempted: false,
    _iceRestartTime: 0,
  });

  const STATE = stateRef.current;
  const [appState, _setAppStateReact] = useState(AppState.IDLE);


  // UPDATE APP STATE BOTH SYNCHRONOUSLY AND REACTIVELY
  const setAppState = useCallback((newState) => {
    const old = STATE.appState;
    STATE.appState = newState;
    _setAppStateReact(newState);
    console.log(`[FSM] ${old} → ${newState}`);
  }, [STATE]);


  // CHECK IF ACTION IS ALLOWED IN CURRENT STATE
  const canPerformAction = useCallback((action) => {
    const current = STATE.appState;
    if (action === 'cleanup' || action === 'exit') return true;
    if (
      current === AppState.NEGOTIATING &&
      (action === 'match' || action === 'offer')
    ) return false;
    if (
      current === AppState.RECONNECTING &&
      (action === 'match' || action === 'offer')
    ) return false;
    return true;
  }, [STATE]);


  return { STATE, appState, setAppState, canPerformAction };
}
