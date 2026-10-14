// ====== MARK COLLABORATION MODULE (Yjs + WebRTC) ======
const Y = require('yjs');
const { WebrtcProvider } = require('y-webrtc');

let ydoc = null;
let provider = null;
let yText = null;
let isApplyingRemote = false;
let currentRoomId = null;
let localEditorRef = null;
let inputHandlerRef = null;

// Calcola il diff minimo tra il vecchio e il nuovo testo e lo applica a Y.Text
function applyDiffToYText(yTextTarget, oldVal, newVal) {
  let commonStart = 0;
  while (
    commonStart < oldVal.length &&
    commonStart < newVal.length &&
    oldVal[commonStart] === newVal[commonStart]
  ) {
    commonStart++;
  }

  let commonEnd = 0;
  while (
    commonEnd < oldVal.length - commonStart &&
    commonEnd < newVal.length - commonStart &&
    oldVal[oldVal.length - 1 - commonEnd] === newVal[newVal.length - 1 - commonEnd]
  ) {
    commonEnd++;
  }

  const deleteCount = oldVal.length - commonStart - commonEnd;
  const insertText = newVal.slice(commonStart, newVal.length - commonEnd);

  if (deleteCount > 0) {
    yTextTarget.delete(commonStart, deleteCount);
  }
  if (insertText.length > 0) {
    yTextTarget.insert(commonStart, insertText);
  }
}

/**
 * Avvia o si unisce a una sessione collaborativa.
 * @param {Object} options
 * @param {string} options.roomId - Nome/ID univoco della stanza
 * @param {string|null} [options.password] - Password facoltativa per crittografia E2EE
 * @param {HTMLTextAreaElement} options.editor - Riferimento alla textarea dell'editor
 * @param {Function} options.onRemoteUpdate - Callback dopo una modifica remota
 * @param {Function} options.onUsersChange - Callback per aggiornare il numero di utenti online
 * @param {Function} options.onStatusChange - Callback per lo stato di connessione (connesso/sconnesso)
 * @param {Function} options.showNotification - Funzione notifiche toast
 */
function startCollaboration({
  roomId,
  password = null,
  editor,
  isJoining = false,
  onRemoteUpdate,
  onUsersChange,
  onStatusChange,
  showNotification
}) {
  if (provider) {
    leaveCollaboration();
  }

  currentRoomId = roomId.trim();
  localEditorRef = editor;

  ydoc = new Y.Doc();
  yText = ydoc.getText('markdown-content');

  // Solo se siamo noi ad avviare la sessione (host/creatore) e l'editor ha del testo,
  // popoliamo inizialmente il documento condiviso. Se ci stiamo unendo, aspettiamo i dati della stanza.
  if (!isJoining && editor.value && editor.value.trim().length > 0) {
    ydoc.transact(() => {
      if (yText.length === 0) {
        yText.insert(0, editor.value);
      }
    }, 'local');
  }

  // Opzioni del provider WebRTC con signaling server attivi e server STUN per il NAT traversal
  const providerOpts = {
    signaling: [
      'wss://y-webrtc.fly.dev',
      'wss://y-webrtc-signaling.fly.dev',
      'wss://signaling.fly.dev'
    ],
    peerOpts: {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    }
  };

  if (password && password.trim().length > 0) {
    providerOpts.password = password.trim();
  }

  try {
    provider = new WebrtcProvider(currentRoomId, ydoc, providerOpts);
  } catch (err) {
    console.error('[Collab] Errore creazione WebrtcProvider:', err);
    if (showNotification) showNotification('Errore di connessione WebRTC: ' + err.message, 'error');
    return null;
  }

  // Imposta la presenza dell'utente per l'awareness di rete
  try {
    provider.awareness.setLocalStateField('user', {
      connectedAt: Date.now()
    });
  } catch (_) {}

  function applyRemoteTextToEditor() {
    if (isApplyingRemote || !yText || !editor) return;
    const remoteText = yText.toString();
    if (editor.value === remoteText) return;

    isApplyingRemote = true;
    const currentStart = editor.selectionStart;
    const currentEnd = editor.selectionEnd;
    editor.value = remoteText;
    if (currentStart <= remoteText.length) {
      editor.setSelectionRange(currentStart, Math.min(currentEnd, remoteText.length));
    }
    isApplyingRemote = false;

    if (onRemoteUpdate) {
      onRemoteUpdate();
    }
  }

  // Sincronizzazione iniziale completata (quando ci si unisce o si riceve il documento)
  provider.on('synced', () => {
    applyRemoteTextToEditor();
  });

  // Ricezione aggiornamenti da Yjs
  ydoc.on('update', (_update, origin) => {
    if (origin !== 'local') {
      applyRemoteTextToEditor();
    }
  });

  provider.on('peers', () => {
    applyRemoteTextToEditor();
  });

  provider.on('status', (event) => {
    if (onStatusChange) {
      onStatusChange(event.connected);
    }
  });

  // Gestione presenza e utenti connessi
  provider.awareness.on('change', () => {
    const states = provider.awareness.getStates();
    const count = states.size;
    if (onUsersChange) {
      onUsersChange(count);
    }
  });

  // Ascolta le modifiche remote da Y.Text e aggiorna l'editor
  yText.observe((event) => {
    if (event.transaction.origin === 'local') {
      return; // È una nostra modifica locale, ignoriamo
    }

    const newText = yText.toString();
    if (editor.value === newText) return;

    isApplyingRemote = true;

    // Preserva e adatta la posizione del cursore
    const currentStart = editor.selectionStart;
    const currentEnd = editor.selectionEnd;
    let newStart = currentStart;
    let newEnd = currentEnd;

    let index = 0;
    event.delta.forEach((op) => {
      if (op.retain) {
        index += op.retain;
      }
      if (op.insert) {
        const len = typeof op.insert === 'string' ? op.insert.length : 1;
        if (index <= newStart) newStart += len;
        if (index <= newEnd) newEnd += len;
        index += len;
      }
      if (op.delete) {
        const len = op.delete;
        if (index < newStart) newStart -= Math.min(len, newStart - index);
        if (index < newEnd) newEnd -= Math.min(len, newEnd - index);
      }
    });

    editor.value = newText;
    editor.setSelectionRange(newStart, newEnd);
    isApplyingRemote = false;

    if (onRemoteUpdate) {
      onRemoteUpdate();
    }
  });

  // Ascolta le modifiche locali dall'utente sull'editor e le sincronizza su Y.Text
  inputHandlerRef = () => {
    if (isApplyingRemote || !yText) return;
    const currentVal = editor.value;
    const yVal = yText.toString();
    if (currentVal === yVal) return;

    ydoc.transact(() => {
      applyDiffToYText(yText, yVal, currentVal);
    }, 'local');
  };

  editor.addEventListener('input', inputHandlerRef);

  return {
    roomId: currentRoomId,
    provider,
    ydoc
  };
}

/**
 * Disconnette e pulisce la sessione collaborativa.
 */
function leaveCollaboration() {
  if (localEditorRef && inputHandlerRef) {
    localEditorRef.removeEventListener('input', inputHandlerRef);
    inputHandlerRef = null;
    localEditorRef = null;
  }

  if (provider) {
    try {
      provider.disconnect();
      provider.destroy();
    } catch (e) {
      console.warn('[Collab] Provider cleanup warning:', e);
    }
    provider = null;
  }

  if (ydoc) {
    try {
      ydoc.destroy();
    } catch (e) {
      console.warn('[Collab] Doc cleanup warning:', e);
    }
    ydoc = null;
    yText = null;
  }

  currentRoomId = null;
  isApplyingRemote = false;
}

/**
 * Genera un ID stanza casuale e facile da condividere.
 */
function generateRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let result = 'mark-';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getCollabState() {
  return {
    isActive: !!provider,
    roomId: currentRoomId,
    userCount: provider ? provider.awareness.getStates().size : 0
  };
}

module.exports = {
  startCollaboration,
  leaveCollaboration,
  generateRoomId,
  getCollabState
};
