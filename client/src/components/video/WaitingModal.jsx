import { AppState } from '../../hooks/useAppState.js';

// M-01: Map FSM states to human-readable labels shown in the waiting overlay
const STATE_LABELS = {
  [AppState.IDLE]:         'Preparando todo',
  [AppState.CONNECTING]:   'Buscando amigos disponibles\u2026',
  [AppState.MATCHED]:      '\u00a1Alguien se uni\u00f3!',
  [AppState.NEGOTIATING]:  'Conectando con tu amigo\u2026',
  [AppState.CONNECTED]:    'Conectado',
  [AppState.RECONNECTING]: 'Reconectando\u2026',
  [AppState.DISCONNECTED]: 'Buscando nueva persona\u2026',
};

/**
 * WaitingModal — Modal de "Waiting" con spinner animado.
 * Ahora muestra texto din\u00e1mico seg\u00fan el estado FSM (M-01).
 */
export default function WaitingModal({ visible, appState }) {
  if (!visible) return null;

  const label = STATE_LABELS[appState] ?? 'Buscando pareja\u2026';

  return (
    <div className="modal" id="modal">
      <div id="spinner">
        <span className="loading-text">{label}</span>
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
}
