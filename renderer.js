// ====== PRE-BOOT: tema + evita FOUC/shift ===================================
(() => {
  try {
    const savedTheme = localStorage.getItem('mark-theme');
    if (savedTheme === 'dark') {
      // Applica subito il tema scuro prima che il DOM venga dipinto
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (_) { /* ignore */ }
  // Evita flicker/shift visivo durante il primo layout
  document.documentElement.style.visibility = 'hidden';
})();

// ====== IMPORTS ==============================================================
const { ipcRenderer, remote, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog } = require("@electron/remote");

// ====== STATO ================================================================
let currentFilePath = null;
let isDirty = false;
let currentFolderPath = null;
let isSyncingScroll = false;
let userIsScrollingEditor = false;
let userIsScrollingPreview = false;
let scrollTimeoutEditor = null;
let scrollTimeoutPreview = null;

// ====== AUTO-UPDATE NOTIFICATIONS ===========================================
ipcRenderer.on('update-available', () => {
  showNotification('Aggiornamento disponibile! Verrà scaricato in background.', 'info');
});

ipcRenderer.on('update-downloaded', () => {
  showNotification('Aggiornamento scaricato! Riavvia per applicare.', 'success');
});

// ====== GROQ AI (facoltativo) ===============================================
let GROQ_API_KEY = '';
try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^GROQ_API_KEY=(.+)$/m);
    if (match) {
      GROQ_API_KEY = match[1].trim();
      console.log('[GROQ] API key loaded from .env.local');
    } else {
      console.warn('[GROQ] API key not found in .env.local');
    }
  } else {
    console.warn('[GROQ] .env.local not found');
  }
} catch (err) {
  console.error('[GROQ] Error reading .env.local:', err);
}
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `ai-notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed; top: 20px; right: 20px;
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    color: white; padding: 12px 20px; border-radius: 4px; z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: opacity 0.3s ease;
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

async function queryGroqAI(selectedText, query) {
  if (!GROQ_API_KEY) {
    showNotification('API Groq key missing.', 'error');
    return null;
  }
  const prompt = `Selected Text: "${selectedText}"

Query utente: ${query}

Fornisci una risposta utile e precisa basata sul testo selezionato. Se la query non è correlata al testo, fornisci comunque una risposta informativa evitando introduzioni e conclusioni.`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
    }
    const data = await response.json();
    return data.choices[0]?.message?.content || 'Nessuna risposta ricevuta.';
  } catch (error) {
    console.error('Errore API Groq:', error);
    showNotification(`Errore: ${error.message}`, 'error');
    return null;
  }
}

// ====== AI Dialog ============================================================
function showAISearchDialog(selectedText) {
  const existingDialog = document.getElementById('ai-search-dialog');
  if (existingDialog) existingDialog.remove();

  const dialog = document.createElement('div');
  dialog.id = 'ai-search-dialog';
  dialog.innerHTML = `
    <div class="ai-dialog-overlay">
      <div class="ai-dialog-content">
        <div class="ai-dialog-header">
          <h3>AI Tool</h3>
          <button class="ai-dialog-close">✕</button>
        </div>
        <div class="ai-dialog-body">
          <div class="ai-selected-text">
            <strong>Selected text:</strong>
            <div class="selected-text-preview">${selectedText.substring(0, 200)}${selectedText.length > 200 ? '...' : ''}</div>
          </div>
          <div class="ai-query-section">
            <label for="ai-query-input">What do you want to know about this text?</label>
            <div class="ai-query-wrapper">
              <input type="text" id="ai-query-input" placeholder="es. Spiega questo concetto, Traduci in inglese..." />
              <button id="ai-submit-btn" class="ai-primary-btn">Send</button>
            </div>
            <div class="ai-blocks">
              <button class="ai-block" id="explain-btn">Explain</button>
              <button class="ai-block" id="translate-btn">Translate</button>
              <button class="ai-block" id="correct-btn">Check</button>
            </div>
          </div>
          <div id="ai-response-section" class="ai-response-section hidden">
            <div class="ai-response-header"><strong>Response:</strong></div>
            <div id="ai-response-content" class="ai-response-content"></div>
          </div>
          <div id="ai-loading" class="ai-loading hidden">
            <div class="ai-spinner"></div>
            <span>llama-3.3-70b-versatile thinking...</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .ai-dialog-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:10000}
    .ai-dialog-content{background:var(--bg-color,#fff);border-radius:8px;width:90%;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,.3)}
    .ai-dialog-header{display:flex;justify-content:space-between;align-items:center;padding:20px;border-bottom:1px solid var(--border-color,#ddd)}
    .ai-dialog-header h3{margin:0;color:var(--text-color,#333)}
    .ai-dialog-close{background:none;border:none;font-size:18px;cursor:pointer;padding:5px;color:var(--text-color,#666)}
    .ai-dialog-body{padding:20px;max-height:60vh;overflow-y:auto}
    .ai-selected-text{margin-bottom:20px}
    .selected-text-preview{background:var(--code-bg,#f5f5f5);padding:10px;border-radius:4px;margin-top:8px;font-family:monospace;font-size:12px;max-height:100px;overflow-y:auto;color:var(--text-color,#333)}
    .ai-query-section{margin-bottom:20px}
    .ai-query-wrapper{display:flex;align-items:center;gap:10px}
    #ai-query-input{width:100%;padding:12px;border:1px solid var(--border-color,#ddd);border-radius:4px;font-size:14px;background:var(--input-bg,#fff);color:var(--text-color,#333);box-sizing:border-box}
    .ai-primary-btn{background:#28a745;color:#fff;border:none;padding:12px 24px;border-radius:4px;cursor:pointer;font-size:14px;font-weight:bold}
    .ai-primary-btn:hover{background:#218838}
    .ai-blocks{margin-top:15px;display:flex;gap:10px;justify-content:center}
    .ai-block{background:#007bff;color:#fff;border:none;padding:8px 20px;border-radius:50px;cursor:pointer;font-size:14px;transition:background-color .3s}
    .ai-block:hover{background:#0056b3}
    .ai-response-section{border-top:1px solid var(--border-color,#ddd);padding-top:20px;overflow:hidden}
    .ai-response-content{background:var(--code-bg,#f8f9fa);padding:15px;border-radius:4px;white-space:pre-wrap;color:var(--text-color,#333);line-height:1.5;cursor:pointer;transition:background-color .3s ease}
    .ai-response-content:hover{background-color:--bg-color}
    .ai-loading{display:flex;align-items:center;gap:12px;padding:20px;justify-content:center}
    .ai-spinner{width:20px;height:20px;border:2px solid var(--border-color,#ddd);border-top:2px solid var(--accent-color,#007bff);border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .hidden{display:none!important}
    .dark .ai-dialog-content{--bg-color:#2d2d2d;--text-color:#fff;--border-color:#444;--code-bg:#1e1e1e;--input-bg:#3d3d3d;--secondary-bg:#555;--accent-color:#0d6efd;--accent-hover:#0b5ed7}
  `;
  document.head.appendChild(style);
  document.body.appendChild(dialog);

  const queryInput = document.getElementById('ai-query-input');
  const submitBtn = document.getElementById('ai-submit-btn');
  const explainBtn = document.getElementById('explain-btn');
  const translateBtn = document.getElementById('translate-btn');
  const correctBtn = document.getElementById('correct-btn');
  const closeBtn = dialog.querySelector('.ai-dialog-close');
  const responseSection = document.getElementById('ai-response-section');
  const responseContent = document.getElementById('ai-response-content');
  const loading = document.getElementById('ai-loading');

  setTimeout(() => queryInput.focus(), 100);
  explainBtn.addEventListener('click', () => queryInput.value = 'Spiega questo concetto');
  translateBtn.addEventListener('click', () => queryInput.value = 'Traduci in inglese');
  correctBtn.addEventListener('click', () => queryInput.value = 'Correggi eventuali errori grammaticali');

  const performAISearch = async () => {
    const query = queryInput.value.trim();
    if (!query) { showNotification('Inserisci una domanda!', 'error'); return; }
    submitBtn.disabled = true;
    loading.classList.remove('hidden');
    responseSection.classList.add('hidden');
    const response = await queryGroqAI(selectedText, query);
    loading.classList.add('hidden');
    submitBtn.disabled = false;
    if (response) {
      responseContent.textContent = response;
      responseSection.classList.remove('hidden');
      dialog.querySelector('.ai-dialog-body')
        .scrollTo({ top: 999999, behavior: 'smooth' });
    }
  };
  submitBtn.addEventListener('click', performAISearch);
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); performAISearch(); }
  });
  responseContent.addEventListener('click', () => {
    navigator.clipboard.writeText(responseContent.textContent)
      .then(() => showNotification('Risposta copiata!', 'success'))
      .catch(() => showNotification('Errore nella copia', 'error'));
  });
  const closeDialog = () => dialog.remove();
  closeBtn.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog.querySelector('.ai-dialog-overlay')) closeDialog();
  });
  const handleEscape = (e) => { if (e.key === 'Escape') { closeDialog(); document.removeEventListener('keydown', handleEscape); } };
  document.addEventListener('keydown', handleEscape);
}

// ====== UTILS ================================================================
const SCROLL_DEBOUNCE_DELAY = 200;
function debounce(func, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
let searchMatches = []; let currentMatchIndex = -1;

function toggleSearchPanel(show = true) {
  const searchContainer = document.getElementById("search-container");
  if (!searchContainer) return;
  if (show) {
    searchContainer.classList.remove("hidden");
    const si = document.getElementById("search-input");
    si && (si.focus(), si.select());
  } else {
    searchContainer.classList.add("hidden");
    clearSearchHighlights();
    const si = document.getElementById("search-input");
    const sr = document.getElementById("search-results");
    si && (si.value = ""); sr && (sr.textContent = "0/0");
  }
}
function performSearch() {
  const si = document.getElementById("search-input");
  const editor = document.getElementById("editor");
  const sr = document.getElementById("search-results");
  if (!si || !editor || !sr) return;
  const searchTerm = si.value;
  const text = editor.value;
  clearSearchHighlights();
  if (!searchTerm) { sr.textContent = "0/0"; currentMatchIndex = -1; return; }
  searchMatches = [];
  let match; const regex = new RegExp(escapeRegExp(searchTerm), "gi");
  while ((match = regex.exec(text)) !== null) searchMatches.push({ start: match.index, end: match.index + searchTerm.length });
  updateSearchResultsCounter();
  if (searchMatches.length > 0) { currentMatchIndex = 0; navigateToMatch(currentMatchIndex); }
}
function goToPreviousMatch() { if (!searchMatches.length) return; currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length; navigateToMatch(currentMatchIndex); }
function goToNextMatch() { if (!searchMatches.length) return; currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length; navigateToMatch(currentMatchIndex); }
function navigateToMatch(index) {
  const editor = document.getElementById("editor");
  const match = searchMatches[index]; if (!match || !editor) return;
  editor.focus(); editor.setSelectionRange(match.start, match.end);
  const temp = document.createElement('textarea');
  const cs = window.getComputedStyle(editor);
  Object.assign(temp.style, { position: 'absolute', left: '-9999px', top: '-9999px', width: editor.clientWidth + 'px', height: 'auto' });
  temp.style.fontSize = cs.fontSize; temp.style.fontFamily = cs.fontFamily; temp.style.lineHeight = cs.lineHeight;
  temp.style.whiteSpace = cs.whiteSpace; temp.style.wordWrap = cs.wordWrap; temp.style.padding = cs.padding;
  temp.style.border = cs.border; temp.style.boxSizing = cs.boxSizing;
  temp.value = editor.value.substring(0, match.start); document.body.appendChild(temp);
  const matchPosition = temp.scrollHeight; temp.remove();
  try {
    const scrollPosition = matchPosition - (editor.clientHeight / 2);
    editor.scrollTop = Math.max(0, scrollPosition);
    const ob = editor.style.background, ot = editor.style.transition;
    editor.style.transition = 'background-color 0.3s ease';
    editor.style.backgroundColor = '#ffff9980';
    setTimeout(() => { editor.style.backgroundColor = ob; editor.style.transition = ot; }, 500);
  } catch (e) {
    const textBeforeMatch = editor.value.substring(0, match.start);
    const lineBreaks = textBeforeMatch.split("\n").length - 1;
    const computedLineHeight = parseInt(window.getComputedStyle(editor).lineHeight) || 20;
    const scrollPosition = lineBreaks * computedLineHeight;
    editor.scrollTop = scrollPosition - editor.clientHeight / 2;
  }
  updateSearchResultsCounter();
}
function calculateLineHeights() {
  const editor = document.getElementById('editor'); if (!editor) return 20;
  const style = window.getComputedStyle(editor);
  const lh = parseFloat(style.lineHeight);
  if (!isNaN(lh)) { editor.dataset.lineHeight = lh; return lh; }
  const fs = parseFloat(style.fontSize);
  const calc = !isNaN(fs) ? fs * 1.2 : 20;
  editor.dataset.lineHeight = calc; return calc;
}
function updateSearchResultsCounter() {
  const counter = document.getElementById("search-results");
  if (!counter) return;
  counter.textContent = searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : "0/0";
}
function clearSearchHighlights() { searchMatches = []; currentMatchIndex = -1; }
function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function setupExternalLinks() {
  const preview = document.getElementById("preview");
  if (!preview) return;
  preview.addEventListener("click", (event) => {
    let target = event.target;
    while (target && target !== preview) {
      if (target.tagName === "A" && target.href) { event.preventDefault(); shell.openExternal(target.href); return; }
      target = target.parentNode;
    }
  });
}
function insertMarkdownLink() {
  const editor = document.getElementById("editor"); if (!editor) return;
  const start = editor.selectionStart; const end = editor.selectionEnd;
  if (start !== end) {
    const selectedText = editor.value.substring(start, end);
    const linkText = `[${selectedText}](url)`;
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    const linkStart = start + selectedText.length + 3; const linkEnd = linkStart + 3;
    editor.setSelectionRange(linkStart, linkEnd);
  } else {
    const linkText = "[text](url)";
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    const linkStart = start + 7; const linkEnd = linkStart + 3;
    editor.setSelectionRange(linkStart, linkEnd);
  }
  updatePreview(); setDirty(true); editor.focus();
}

// ====== ONLINE/OFFLINE ======================================================
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
function updateOnlineStatus() {
  const statusIndicator = document.querySelector('.status-indicator');
  const statusText = document.getElementById('connection-text');
  if (!statusIndicator || !statusText) return;
  if (navigator.onLine) { statusIndicator.classList.remove('offline'); statusText.textContent = 'Online'; }
  else { statusIndicator.classList.add('offline'); statusText.textContent = 'Offline'; }
}

// ====== DOM READY ===========================================================
window.addEventListener("DOMContentLoaded", () => {
  updateOnlineStatus();

  // Elementi base
  const editor = document.getElementById("editor");
  const preview = document.getElementById("preview");
  const wordCountEl = document.getElementById("word-count");
  const title = document.getElementById("title");
  const explorerPanel = document.getElementById("explorer-panel");
  const fileTree = document.getElementById("file-tree");
  const folderPathEl = document.getElementById("folder-path");
  const openFolderBtn = document.getElementById("open-folder");
  const collapseAllBtn = document.getElementById("collapse-all");
  const refreshExplorerBtn = document.getElementById("refresh-explorer");
  const newFileBtn = document.getElementById("new-file");
  const searchInput = document.getElementById("search-input");
  const searchPrevBtn = document.getElementById("search-prev");
  const searchNextBtn = document.getElementById("search-next");
  const searchCloseBtn = document.getElementById("search-close");
  const autosaveSwitch = document.getElementById("toggle-autosave");
  const autoscrollSwitch = document.getElementById("toggle-autoscroll");
  const themeSwitch = document.getElementById("toggle-theme-switch");
  let autosaveInterval = null;

  // Imposta layout iniziale stabile (split)
  const container = document.getElementById('container');
  if (container && editor && preview) {
    container.style.cssText = "display:flex;";
    editor.parentElement && (editor.parentElement.style.cssText = "display:block;flex:1;min-width:0;");
    preview.style.cssText = "display:block;flex:1;min-width:0;overflow:auto;";
  }

  // Sincronizza stato del tema con il toggle (evita “salta” al primo input)
  try {
    const savedTheme = localStorage.getItem("mark-theme") || "light";
    if (themeSwitch) {
      themeSwitch.checked = savedTheme === "dark";
    }
  } catch(_) {}

  // ===== AUTOSAVE =====
  const AUTOSAVE_KEY = 'mark.autosaveEnabled';
  const AUTOSAVE_MS = 2000;
  if (autosaveSwitch) {
    const savedAutosave = localStorage.getItem(AUTOSAVE_KEY);
    if (savedAutosave !== null) autosaveSwitch.checked = savedAutosave === 'true';
  }
  function startAutosave() {
    if (autosaveInterval) return;
    autosaveInterval = setInterval(() => {
      try {
        if (autosaveSwitch && autosaveSwitch.checked && currentFilePath && isDirty && typeof saveCurrentFile === 'function') {
          document.dispatchEvent(new Event('autosave'));
          saveCurrentFile();
        }
      } catch (err) { console.error('[autosave] error:', err); }
    }, AUTOSAVE_MS);
  }
  function stopAutosave() { if (autosaveInterval) { clearInterval(autosaveInterval); autosaveInterval = null; } }
  if (autosaveSwitch) {
    autosaveSwitch.addEventListener("change", function () {
      const enabled = this.checked; localStorage.setItem(AUTOSAVE_KEY, String(enabled));
      if (enabled) {
        if (!currentFilePath) {
          this.checked = false; localStorage.setItem(AUTOSAVE_KEY, 'false');
          showNotification && showNotification('You must save the file first to enable autosave.', 'error');
          return;
        }
        startAutosave(); showNotification && showNotification('Autosave attivato.', 'success');
      } else { stopAutosave(); showNotification && showNotification('Autosave disattivato.', 'info'); }
    });
    if (autosaveSwitch.checked && currentFilePath) startAutosave();
  }
  window.addEventListener('blur', () => {
    if (autosaveSwitch && autosaveSwitch.checked && currentFilePath && isDirty && typeof saveCurrentFile === 'function') {
      saveCurrentFile();
    }
  });

  // ===== EXPLORER =====
  if (explorerPanel) explorerPanel.classList.add("hidden");
  openFolderBtn && openFolderBtn.addEventListener("click", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths.length > 0) openFolder(result.filePaths[0]);
  });
  collapseAllBtn && collapseAllBtn.addEventListener("click", () => explorerPanel && explorerPanel.classList.add("hidden"));
  refreshExplorerBtn && refreshExplorerBtn.addEventListener("click", () => { if (currentFolderPath) openFolder(currentFolderPath); });

  // ===== WORD COUNT =====
  const updateWordCount = () => {
    if (!wordCountEl || !editor) return;
    const text = editor.value;
    let clean = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/(^|\n)[*\-]{3,}(\n|$)/g, ' ')
      .replace(/(^|\n)#+\s+/g, ' ')
      .replace(/(^|\n)[*\-]\s+/g, ' ')
      .replace(/(^|\n)\d+\.\s+/g, ' ')
      .replace(/[*_]{1,3}/g, '')
      .replace(/(^|\n)>+/g, ' ')
      .replace(/(^|\n)-{3,}(\n|$)/g, ' ')
      .replace(/\b\d+\b/g, ' ')
      .replace(/[.,!?;:()\[\]{}<>"'`~|\\/]/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/\s+/g, ' ');
    const words = clean.match(/\b[a-zA-ZÀ-ÿ]{2,}\b/g);
    wordCountEl.textContent = `word-count: ${words ? words.length : 0}`;
  };

  // ===== DIRTY FLAG =====
  const setDirty = (dirty) => { isDirty = dirty; if (title) title.textContent = dirty ? "*" : ""; };

  // ===== PREVIEW RENDER =====
  function updatePreview() {
    if (!editor || !preview) return;
    const raw = editor.value;
    const scrollPercent = (preview.scrollHeight > preview.clientHeight)
      ? preview.scrollTop / (preview.scrollHeight - preview.clientHeight)
      : 0;

    let html = marked.parse(raw, {
      highlight: (code) => hljs.highlightAuto(code).value
    });

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Rendi immagini stabili e lazy per evitare shift
    const imgs = tempDiv.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.getAttribute('src');
      img.setAttribute('loading', 'lazy');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      if (src && !src.match(/^(?:[a-z]+:)?\/\//i) && currentFilePath) {
        const folder = path.dirname(currentFilePath);
        const absolutePath = path.resolve(folder, src);
        const fileUrl = 'file://' + absolutePath.replace(/\\/g, '/');
        img.setAttribute('src', fileUrl);
      }
    });

    html = tempDiv.innerHTML;
    html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, code) => `<div class="mermaid">${code}</div>`);
    preview.innerHTML = html;

    // Re-sincronizza scroll
    const maxScroll = (preview.scrollHeight - preview.clientHeight);
    if (maxScroll > 0) preview.scrollTop = scrollPercent * maxScroll;

    // Abilita copia rapida dei blocchi codice
    preview.querySelectorAll('pre code').forEach(codeBlock => {
      codeBlock.classList.add('clickable-code');
      codeBlock.title = 'Click to copy the code';
      codeBlock.addEventListener('click', function () {
        const text = this.textContent;
        navigator.clipboard.writeText(text)
          .then(() => {
            const originalBg = this.style.backgroundColor;
            this.style.backgroundColor = '#4CAF50';
            setTimeout(() => { this.style.backgroundColor = originalBg; }, 500);
            const notification = document.createElement('div');
            notification.className = 'copy-notification';
            notification.textContent = 'Copied!';
            notification.style.position = 'absolute';
            notification.style.top = `${window.scrollY + this.getBoundingClientRect().top - 30}px`;
            notification.style.left = `${window.scrollX + this.getBoundingClientRect().left + this.offsetWidth / 2}px`;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 1500);
          })
          .catch(err => console.error('Errore durante la copia: ', err));
      });
    });

    // Inizializza Mermaid una volta popolato l'HTML
    if (window.mermaid) {
      try {
        if (!window.__mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false });
          window.__mermaidInitialized = true;
        }
        mermaid.init(undefined, ".mermaid");
      } catch (e) { console.warn('Mermaid init warning:', e); }
    }

    // Math
    if (window.renderMathInElement) {
      renderMathInElement(preview, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
        ],
        throwOnError: false, output: 'html', trust: true,
        macros: { "\\eqref": "\\href{#1}{}" }
      });
      preview.querySelectorAll('.katex-display').forEach(display => {
        display.style.overflowX = 'auto'; display.style.maxWidth = '100%';
      });
      preview.querySelectorAll('.katex').forEach(inline => {
        if (!inline.closest('.katex-display')) {
          inline.style.maxWidth = '100%'; inline.style.whiteSpace = 'normal';
        }
      });
    }
  }

  // ===== Input Editor =====
  editor && editor.addEventListener('keydown', (e) => {
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', '`': '`' };
    if (Object.keys(pairs).includes(e.key)) {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      const left = editor.value.substring(0, start), right = editor.value.substring(end);
      const pair = pairs[e.key];
      editor.value = left + e.key + pair + right;
      editor.selectionStart = editor.selectionEnd = start + 1;
      updatePreview(); setDirty(true); return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      const before = editor.value.substring(0, start);
      const selected = editor.value.substring(start, end);
      const after = editor.value.substring(end);
      if (start === end) {
        editor.value = before + "    " + after;
        editor.selectionStart = editor.selectionEnd = start + 4;
      } else if (selected.includes('\n')) {
        const indented = selected.replace(/^/gm, "    ");
        editor.value = before + indented + after;
        editor.selectionStart = start; editor.selectionEnd = start + indented.length;
      } else {
        editor.value = before + "    " + selected + after;
        editor.selectionStart = start + 4; editor.selectionEnd = end + 4;
      }
      return;
    }
    if (e.ctrlKey) {
      const start = editor.selectionStart, end = editor.selectionEnd;
      if (start === end) return;
      const selected = editor.value.substring(start, end);
      const before = editor.value.substring(0, start), after = editor.value.substring(end);
      let formatted = selected; let handled = true;
      switch (e.key) {
        case "1": formatted = `# ${selected}`; break;
        case "2": formatted = `## ${selected}`; break;
        case "3": formatted = `### ${selected}`; break;
        case "b": case "B": formatted = `**${selected}**`; break;
        case "i": case "I": formatted = `*${selected}*`; break;
        case "u": case "U": formatted = `<u>${selected}</u>`; break;
        default: handled = false;
      }
      if (handled) {
        e.preventDefault();
        editor.value = before + formatted + after;
        editor.selectionStart = start; editor.selectionEnd = start + formatted.length;
        updatePreview(); setDirty(true);
      }
    }
    if (e.key === "Enter") {
      const cursorPos = editor.selectionStart;
      const before = editor.value.substring(0, cursorPos);
      const currentLine = before.split('\n').pop();
      const listMatch = currentLine.match(/^(\s*)([*-])\s(.*)$/);
      const numberedListMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
      if (numberedListMatch) {
        const [, indent, number, content] = numberedListMatch;
        if (content.trim() === '') {
          e.preventDefault();
          const lineStart = cursorPos - currentLine.length;
          editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
          updatePreview(); setDirty(true); return;
        }
        e.preventDefault();
        const nextNumber = parseInt(number, 10) + 1;
        const newLine = `\n${indent}${nextNumber}. `;
        editor.value = editor.value.substring(0, cursorPos) + newLine + editor.value.substring(cursorPos);
        editor.selectionStart = editor.selectionEnd = cursorPos + newLine.length;
        updatePreview(); setDirty(true); return;
      }
      if (listMatch) {
        const [, indent, marker, content] = listMatch;
        if (content.trim() === '') {
          e.preventDefault();
          const lineStart = cursorPos - currentLine.length;
          editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
          updatePreview(); setDirty(true); return;
        }
        e.preventDefault();
        const newListItem = `\n${indent}${marker} `;
        editor.value = editor.value.substring(0, cursorPos) + newListItem + editor.value.substring(cursorPos);
        editor.selectionStart = editor.selectionEnd = cursorPos + newListItem.length;
        updatePreview(); setDirty(true);
      }
    }
  });

  // ===== Autoscroll Sync =====
  let autoscrollEnabled = true;
  const savedAutoscroll = localStorage.getItem('autoscrollEnabled');
  if (savedAutoscroll !== null) {
    autoscrollEnabled = savedAutoscroll === 'true';
    autoscrollSwitch && (autoscrollSwitch.checked = autoscrollEnabled);
  }
  autoscrollSwitch && autoscrollSwitch.addEventListener("change", function () {
    autoscrollEnabled = this.checked; localStorage.setItem('autoscrollEnabled', autoscrollEnabled);
  });
  editor && editor.addEventListener('scroll', () => {
    if (!autoscrollEnabled || isSyncingScroll) return;
    userIsScrollingEditor = true;
    clearTimeout(scrollTimeoutEditor);
    scrollTimeoutEditor = setTimeout(() => { userIsScrollingEditor = false; }, SCROLL_DEBOUNCE_DELAY);
    if (!userIsScrollingPreview && preview) {
      isSyncingScroll = true;
      const scrollPercent = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
      preview.scrollTop = scrollPercent * (preview.scrollHeight - preview.clientHeight);
      setTimeout(() => { isSyncingScroll = false; }, 50);
    }
  });
  preview && preview.addEventListener('scroll', () => {
    if (!autoscrollEnabled || isSyncingScroll || !editor) return;
    userIsScrollingPreview = true;
    clearTimeout(scrollTimeoutPreview);
    scrollTimeoutPreview = setTimeout(() => { userIsScrollingPreview = false; }, SCROLL_DEBOUNCE_DELAY);
    if (!userIsScrollingEditor) {
      isSyncingScroll = true;
      const scrollPercent = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
      editor.scrollTop = scrollPercent * (editor.scrollHeight - editor.clientHeight);
      setTimeout(() => { isSyncingScroll = false; }, 50);
    }
  });

  const debouncedUpdate = debounce(() => { updatePreview(); updateWordCount(); }, 300);
  editor && editor.addEventListener("input", () => { debouncedUpdate(); setDirty(true); });

  // ===== Paste immagini =====
  editor && editor.addEventListener('paste', async (e) => {
    const clipboardItems = e.clipboardData?.items || [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        if (!currentFilePath) {
          dialog.showMessageBoxSync({ type: 'info', title: 'File non salvato', message: 'Per incollare un\'immagine, devi prima salvare il file.' });
          const file = dialog.showSaveDialogSync({ filters: [{ name: "Markdown", extensions: ["md"] }] });
          if (!file) return;
          fs.writeFileSync(file, editor.value, "utf8");
          currentFilePath = file; setDirty(false);
        }
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = () => {
          const buffer = Buffer.from(reader.result);
          const timestamp = Date.now();
          const imageExt = (blob.type.split('/')[1] || 'png').split('+')[0];
          const imageName = `image_${timestamp}.${imageExt}`;
          const folderPath = path.dirname(currentFilePath);
          const imagesDir = path.join(folderPath, "images");
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);
          const imagePath = path.join(imagesDir, imageName);
          fs.writeFileSync(imagePath, buffer);
          const relativeImagePath = path.relative(folderPath, imagePath).replace(/\\/g, "/");
          const markdownImage = `![immagine](${relativeImagePath})`;
          const start = editor.selectionStart; const end = editor.selectionEnd;
          editor.value = editor.value.slice(0, start) + markdownImage + editor.value.slice(end);
          const newCursorPos = start + markdownImage.length;
          editor.setSelectionRange(newCursorPos, newCursorPos);
          updatePreview(); updateWordCount(); setDirty(true);
        };
        reader.readAsArrayBuffer(blob);
      }
    }
  });

  // ===== Context Menu + AI =====
  editor && editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { Menu, MenuItem } = require('@electron/remote');
    const menu = new Menu();
    const selectedText = editor.value.substring(editor.selectionStart, editor.selectionEnd).trim();
    menu.append(new MenuItem({ label: 'Cut', accelerator: 'CmdOrCtrl+X', click: () => document.execCommand('cut') }));
    menu.append(new MenuItem({ label: 'Copy', accelerator: 'CmdOrCtrl+C', click: () => document.execCommand('copy') }));
    menu.append(new MenuItem({ label: 'Paste', accelerator: 'CmdOrCtrl+V', click: () => document.execCommand('paste') }));
    menu.append(new MenuItem({ label: 'Format', accelerator: 'CmdOrCtrl+K', click: () => formatMarkdown() }));
    if (selectedText) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'AI Tool', accelerator: 'CmdOrCtrl+Shift+A', click: () => showAISearchDialog(selectedText) }));
    }
    menu.popup();
  });

  // ===== IPC handlers (file/load/view/theme) =====
  ipcRenderer.on("load-md", (event, filePath, content) => {
    if (!editor) return;
    editor.value = content; updatePreview(); wordCountEl && updateWordCount();
    currentFilePath = filePath; setDirty(false);
    document.querySelectorAll('.tree-item').forEach(item => {
      item.classList.remove('active'); if (item.dataset.path === filePath) item.classList.add('active');
    });
  });
  ipcRenderer.on("export-pdf", () => exportToPdf());
  ipcRenderer.on("new-file", () => createNewFile());
  ipcRenderer.on("open-folder", (event, folderPath) => openFolder(folderPath));
  ipcRenderer.on("trigger-save", () => saveCurrentFile());
  ipcRenderer.on("toggle-explorer", () => { const p = document.getElementById("explorer-panel"); p && p.classList.toggle("hidden"); });
  ipcRenderer.on("toggle-preview", () => {
    if (!editor || !preview) return;
    if (preview.style.display === 'none') { preview.style.display = 'block'; editor.style.width = '50%'; }
    else { preview.style.display = 'none'; editor.style.width = '100%'; }
    setTimeout(calculateLineHeights, 100);
  });
  ipcRenderer.on("toggle-editor", () => {
    if (!editor || !preview) return;
    if (editor.style.display === 'none') { editor.style.display = 'block'; preview.style.width = '50%'; }
    else { editor.style.display = 'none'; preview.style.width = '100%'; }
    setTimeout(calculateLineHeights, 100);
  });
  ipcRenderer.on("toggle-theme", () => { document.body.classList.toggle("dark"); });

  // ===== Tema switch coerente =====
  themeSwitch && themeSwitch.addEventListener("change", function () {
    if (this.checked) {
      document.body.classList.add("dark");
      localStorage.setItem("mark-theme", "dark");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("mark-theme", "light");
    }
  });

  // ===== Inserimento immagini via menu =====
  ipcRenderer.on("insert-image-from-file", async (event, imagePath) => {
    if (!editor) return;
    if (!currentFilePath) {
      dialog.showMessageBoxSync({ type: 'info', title: 'File non salvato', message: 'Per inserire un\'immagine, devi prima salvare il file.' });
      const file = dialog.showSaveDialogSync({ filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!file) return;
      fs.writeFileSync(file, editor.value, "utf8");
      currentFilePath = file; setDirty(false);
    }
    let fileName = path.basename(imagePath).replace(/\s+/g, '_');
    const folderPath = path.dirname(currentFilePath);
    const destDir = path.join(folderPath, "images");
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
    const destPath = path.join(destDir, fileName);
    if (imagePath !== destPath) fs.copyFileSync(imagePath, destPath);
    const relativeImagePath = path.relative(folderPath, destPath).replace(/\\/g, '/');
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const textAfter = editor.value.substring(cursorPos);
    const imageTag = `![${fileName}](${relativeImagePath})`;
    editor.value = textBefore + imageTag + textAfter;
    const newCursorPos = cursorPos + imageTag.length;
    editor.setSelectionRange(newCursorPos, newCursorPos);
    updatePreview(); wordCountEl && updateWordCount(); setDirty(true); editor.focus();
  });

  // ===== Paste image (scorciatoia) =====
  ipcRenderer.on("paste-image-from-clipboard", () => {
    if (!editor) return;
    editor.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: clipboard.availableFormats().some(format => format.includes('image'))
        ? clipboard
        : new DataTransfer()
    }));
  });

  // ===== Search panel =====
  searchInput && searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
      if (e.shiftKey) goToPreviousMatch(); else goToNextMatch();
    }
  });
  const searchButton = document.getElementById("search-button");
  if (searchButton) {
    searchButton.replaceWith(searchButton.cloneNode(true));
    const newSearchButton = document.getElementById("search-button");
    newSearchButton && newSearchButton.addEventListener("click", () => { performSearch(); goToNextMatch(); });
  }
  searchPrevBtn && searchPrevBtn.addEventListener("click", goToPreviousMatch);
  searchNextBtn && searchNextBtn.addEventListener("click", goToNextMatch);
  searchCloseBtn && searchCloseBtn.addEventListener("click", () => toggleSearchPanel(false));

  // ===== Shortcut globali =====
  document.addEventListener("keydown", (e) => {
    const sc = document.getElementById("search-container");
    if (e.ctrlKey && e.key === "f") { e.preventDefault(); toggleSearchPanel(true); }
    if (e.ctrlKey && e.key === "l") { e.preventDefault(); insertMarkdownLink(); }
    if (e.ctrlKey && e.key === "h") { e.preventDefault(); formatAsCode(); }
    if (e.ctrlKey && e.key === "k") { e.preventDefault(); formatMarkdown(); }
    if (e.key === "Escape" && sc && !sc.classList.contains("hidden")) toggleSearchPanel(false);
    if (e.key === "Enter" && sc && !sc.classList.contains("hidden")) { if (e.shiftKey) goToPreviousMatch(); else goToNextMatch(); }
  });

  ipcRenderer.on("open-search", () => toggleSearchPanel(true));

  // ===== PDF export =====
  function exportToPdf() {
    if (!preview) return;
    const content = preview.innerHTML;
    ipcRenderer.send("print-to-pdf", content, path.basename(currentFilePath || ""));
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Preparazione PDF in corso...';
    Object.assign(notification.style, { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    document.body.appendChild(notification);
    ipcRenderer.once('pdf-saved', () => notification.remove());
  }

  // ===== File tree / IO =====
  function openFolder(folderPath) {
    currentFolderPath = folderPath;
    folderPathEl && (folderPathEl.textContent = folderPath);
    if (fileTree) fileTree.innerHTML = '';
    explorerPanel && explorerPanel.classList.remove("hidden");
    createFileTree(folderPath, fileTree);
  }
  function saveCurrentFile() {
    if (!editor) return;
    const content = editor.value;
    if (currentFilePath) { fs.writeFileSync(currentFilePath, content, "utf8"); setDirty(false); }
    else {
      const file = dialog.showSaveDialogSync({ filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (file) {
        fs.writeFileSync(file, content, "utf8");
        currentFilePath = file; setDirty(false);
        if (currentFolderPath && file.startsWith(currentFolderPath)) openFolder(currentFolderPath);
      }
    }
  }
  function createNewFile() {
    if (isDirty) {
      const answer = dialog.showMessageBoxSync({
        type: 'question', buttons: ['Salva', 'Non salvare', 'Annulla'], defaultId: 0,
        title: 'File non salvato', message: 'Ci sono modifiche non salvate. Vuoi salvare prima di creare un nuovo file?'
      });
      if (answer === 0) saveCurrentFile(); else if (answer === 2) return;
    }
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath || '', 'nuovo-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: 'Crea nuovo file'
    });
    if (!filename) return;
    fs.writeFileSync(filename, '', 'utf8');
    editor.value = ''; updatePreview(); updateWordCount();
    currentFilePath = filename; setDirty(false);
    if (currentFolderPath) openFolder(currentFolderPath);
    setTimeout(() => {
      document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.path === filename) {
          item.classList.add('active');
          item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }, 100);
  }
  function isMarkdownFile(filePath) { return filePath.toLowerCase().endsWith('.md'); }
  function createFileTree(folderPath, parentElement) {
    if (!parentElement) return;
    try {
      const items = fs.readdirSync(folderPath);
      // Folders
      items
        .filter(item => fs.statSync(path.join(folderPath, item)).isDirectory())
        .sort((a, b) => a.localeCompare(b))
        .forEach(item => {
          const itemPath = path.join(folderPath, item);
          const folderElement = document.createElement('div');
          folderElement.className = 'tree-folder collapsed';
          const folderHeader = document.createElement('div'); folderHeader.className = 'tree-folder-header';
          const folderIcon = document.createElement('span'); folderIcon.className = 'tree-folder-icon'; folderIcon.textContent = '📁 ';
          const folderName = document.createElement('span'); folderName.textContent = item;
          folderHeader.appendChild(folderIcon); folderHeader.appendChild(folderName);
          const folderContent = document.createElement('div'); folderContent.className = 'tree-folder-content';
          folderElement.appendChild(folderHeader); folderElement.appendChild(folderContent);
          parentElement.appendChild(folderElement);
          folderHeader.addEventListener('click', () => {
            folderElement.classList.toggle('collapsed');
            if (!folderElement.dataset.loaded && !folderElement.classList.contains('collapsed')) {
              createFileTree(itemPath, folderContent);
              folderElement.dataset.loaded = 'true';
            }
          });
        });
      // Files (.md)
      items
        .filter(item => {
          const itemPath = path.join(folderPath, item);
          return fs.statSync(itemPath).isFile() && isMarkdownFile(itemPath);
        })
        .sort((a, b) => a.localeCompare(b))
        .forEach(item => {
          const itemPath = path.join(folderPath, item);
          const fileElement = document.createElement('div');
          fileElement.className = 'tree-item tree-file';
          fileElement.textContent = `📄 ${item}`;
          fileElement.dataset.path = itemPath;
          fileElement.addEventListener('click', () => {
            if (isDirty) {
              const answer = dialog.showMessageBoxSync({
                type: 'question', buttons: ['Salva', 'Non salvare', 'Annulla'], defaultId: 0,
                title: 'File non salvato', message: 'Ci sono modifiche non salvate. Vuoi salvare prima di aprire un nuovo file?'
              });
              if (answer === 0) saveCurrentFile();
              else if (answer === 2) return;
            }
            document.querySelectorAll('.tree-item').forEach(item => item.classList.remove('active'));
            fileElement.classList.add('active');
            const content = fs.readFileSync(itemPath, 'utf8');
            editor.value = content; updatePreview(); updateWordCount(); currentFilePath = itemPath; setDirty(false);
          });
          parentElement.appendChild(fileElement);
        });
    } catch (error) { console.error('Errore durante la lettura della directory:', error); }
  }

  // ===== Toolbar (estratto necessario) =====
  const btnBold = document.getElementById("btn-bold");
  const btnItalic = document.getElementById("btn-italic");
  const btnCode = document.getElementById("btn-code");
  const btnImage = document.getElementById("btn-image");
  const btnUl = document.getElementById("btn-ul");
  const btnOl = document.getElementById("btn-ol");
  const btnLink = document.getElementById("btn-link");
  const btnHr = document.getElementById("btn-hr");
  const dropdownTitle = document.getElementById("dropdown-title");
  const btnTitle = document.getElementById("btn-title");
  const dropdownContent = document.getElementById("dropdown-content");
  const dropdownItems = document.querySelectorAll(".dropdown-item");
  const btnUnderline = document.getElementById("btn-underline");
  const btnViewEditor = document.getElementById("btn-view-editor");
  const btnViewPreview = document.getElementById("btn-view-preview");
  const btnViewSplit = document.getElementById("btn-view-split");
  const btnQuote = document.getElementById("btn-quote");
  const btnTable = document.getElementById("btn-table");
  const btnExtra = document.getElementById("btn-extra");
  const dropdownExtra = document.getElementById("dropdown-extra");
  const btnOptions = document.getElementById("btn-options");
  const dropdownOptions = document.getElementById("dropdown-options");

  function preserveScroll(fn) { const s = editor.scrollTop; fn(); editor.scrollTop = s; }
  function formatAsCode() {
    const start = editor.selectionStart; const end = editor.selectionEnd;
    if (start !== end) {
      const selected = editor.value.substring(start, end);
      editor.value = editor.value.substring(0, start) + "`" + selected + "`" + editor.value.substring(end);
      editor.selectionStart = start; editor.selectionEnd = end + 2;
    } else {
      const block = "```\n\n```"; editor.value = editor.value.substring(0, start) + block + editor.value.substring(end);
      const pos = start + 4; editor.selectionStart = pos; editor.selectionEnd = pos;
    }
    updatePreview(); setDirty(true); editor.focus();
  }
  function insertMarkdownLinkBtn() { insertMarkdownLink(); }

  btnBold && btnBold.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const text = `**${selected || 'text'}**`; editor.setRangeText(text, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
    updatePreview(); setDirty(true); }); });
  btnItalic && btnItalic.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const text = `*${selected || 'text'}*`; editor.setRangeText(text, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 1, start + 1 + (selected ? selected.length : 4));
    updatePreview(); setDirty(true); }); });
  btnCode && btnCode.addEventListener("click", () => preserveScroll(() => { formatAsCode(); }));
  btnImage && btnImage.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const imageMd = `![alt](${selected || 'url'})`; editor.setRangeText(imageMd, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 7, start + 10); updatePreview(); setDirty(true); }); });
  btnUl && btnUl.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const listMd = `* ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
    updatePreview(); setDirty(true); }); });
  btnOl && btnOl.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const listMd = `1. ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
    updatePreview(); setDirty(true); }); });
  btnLink && btnLink.addEventListener("click", () => preserveScroll(() => insertMarkdownLinkBtn()));
  btnHr && btnHr.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; editor.setRangeText("***\n", start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 4, start + 4); updatePreview(); setDirty(true); }); });
  btnUnderline && btnUnderline.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const text = `<u>${selected || 'text'}</u>`; editor.setRangeText(text, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
    updatePreview(); setDirty(true); }); });
  btnQuote && btnQuote.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
    const quoteMd = `> ${selected || 'quote'}`;
    editor.value = editor.value.substring(0, start) + quoteMd + editor.value.substring(end);
    editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 5));
    updatePreview(); setDirty(true); }); });
  btnTable && btnTable.addEventListener("click", () => { preserveScroll(() => {
    const start = editor.selectionStart; const end = editor.selectionEnd;
    const tableMd = `| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |`;
    editor.setRangeText(tableMd, start, end, 'end');
    editor.focus(); editor.setSelectionRange(start + tableMd.length, start + tableMd.length);
    editor.dispatchEvent(new Event('input', { bubbles: true })); updatePreview(); setDirty(true); }); });

  btnExtra && btnExtra.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownExtra.classList.toggle("open");
    document.getElementById("dropdown-title")?.classList.remove("open");
    document.getElementById("dropdown-options")?.classList.remove("open");
    btnExtra.classList.toggle("active");
  });
  btnOptions && btnOptions.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownOptions.classList.toggle("open");
    document.getElementById("dropdown-title")?.classList.remove("open");
    document.getElementById("dropdown-extra")?.classList.remove("open");
    btnOptions.classList.toggle("active");
  });
  btnTitle && btnTitle.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownTitle.classList.toggle("open");
    document.getElementById("dropdown-extra")?.classList.remove("open");
    document.getElementById("dropdown-options")?.classList.remove("open");
    btnTitle.classList.toggle("active");
  });
  document.addEventListener("click", (e) => {
    if (dropdownExtra && !dropdownExtra.contains(e.target)) { dropdownExtra.classList.remove("open"); btnExtra?.classList.remove("active"); }
    if (dropdownOptions && !dropdownOptions.contains(e.target)) { dropdownOptions.classList.remove("open"); btnOptions?.classList.remove("active"); }
    if (dropdownTitle && !dropdownTitle.contains(e.target)) { dropdownTitle.classList.remove("open"); btnTitle?.classList.remove("active"); }
  });

  btnViewEditor && btnViewEditor.addEventListener("click", () => {
    if (!container || !editor || !preview) return;
    container.style.cssText = "display:flex;";
    editor.parentElement && (editor.parentElement.style.cssText = "display:block;flex:1;");
    preview.style.cssText = "display:none;flex:0;";
  });
  btnViewSplit && btnViewSplit.addEventListener("click", () => {
    if (!container || !editor || !preview) return;
    container.style.cssText = "display:flex;";
    editor.parentElement && (editor.parentElement.style.cssText = "display:block;flex:1;");
    preview.style.cssText = "display:block;flex:1;";
  });
  btnViewPreview && btnViewPreview.addEventListener("click", () => {
    if (!container || !editor || !preview) return;
    container.style.cssText = "display:flex;";
    editor.parentElement && (editor.parentElement.style.cssText = "display:none;flex:0;");
    preview.style.cssText = "display:block;flex:1;";
  });

  // ===== PRIMO RENDER + link esterni =====
  setupExternalLinks();
  updatePreview();
  updateWordCount();

  // ===== MOSTRA DOCUMENTO (fine preload) =====
  requestAnimationFrame(() => {
    document.documentElement.style.visibility = 'visible';
  });
});