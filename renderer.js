const { ipcRenderer, remote, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog } = require("@electron/remote");
let currentFilePath = null;
let isDirty = false;
let currentFolderPath = null;
let isSyncingScroll = false;
let userIsScrollingEditor = false;
let userIsScrollingPreview = false;
let scrollTimeoutEditor = null;
let scrollTimeoutPreview = null;

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
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    transition: opacity 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 300);
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
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
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

function showAISearchDialog(selectedText) {
  const existingDialog = document.getElementById('ai-search-dialog');
  if (existingDialog) {
    existingDialog.remove();
  }

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
            <div class="ai-response-header">
              <strong>Response:</strong>
            </div>
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

  // Aggiungi stili CSS
  const style = document.createElement('style');
  style.textContent = `
    .ai-dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }

    .ai-dialog-content {
      background: var(--bg-color, #fff);
      border-radius: 8px;
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .ai-dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 1px solid var(--border-color, #ddd);
    }

    .ai-dialog-header h3 {
      margin: 0;
      color: var(--text-color, #333);
    }

    .ai-dialog-close {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      padding: 5px;
      color: var(--text-color, #666);
    }

    .ai-dialog-body {
      padding: 20px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .ai-selected-text {
      margin-bottom: 20px;
    }

    .selected-text-preview {
      background: var(--code-bg, #f5f5f5);
      padding: 10px;
      border-radius: 4px;
      margin-top: 8px;
      font-family: monospace;
      font-size: 12px;
      max-height: 100px;
      overflow-y: auto;
      color: var(--text-color, #333);
    }

    .ai-query-section {
      margin-bottom: 20px;
    }

    .ai-query-wrapper {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    #ai-query-input {
      width: 100%;
      padding: 12px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      font-size: 14px;
      background: var(--input-bg, #fff);
      color: var(--text-color, #333);
      box-sizing: border-box;
    }

    .ai-primary-btn {
      background: #28a745;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    }

    .ai-primary-btn:hover {
      background: #218838;
    }

    .ai-blocks {
      margin-top: 15px;
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .ai-block {
      background-color: #007bff;
      color: white;
      border: none;
      padding: 8px 20px;
      border-radius: 50px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.3s;
    }

    .ai-block:hover {
      background-color: #0056b3;
    }

    .ai-response-section {
      border-top: 1px solid var(--border-color, #ddd);
      padding-top: 20px;
      overflow: hidden; /* Rimuove la scrollbar */
    }

    .ai-response-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .ai-response-content {
      background: var(--code-bg, #f8f9fa);
      padding: 15px;
      border-radius: 4px;
      white-space: pre-wrap;
      color: var(--text-color, #333);
      line-height: 1.5;
      cursor: pointer; /* Permette di cliccare sul contenuto per copiarlo */
      transition: background-color 0.3s ease; /* Aggiunto effetto hover */
    }

    .ai-response-content:hover {
      background-color: --bg-color;
    }

    .ai-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px;
      justify-content: center;
    }

    .ai-spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border-color, #ddd);
      border-top: 2px solid var(--accent-color, #007bff);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .hidden {
      display: none !important;
    }

    /* Dark mode support */
    .dark .ai-dialog-content {
      --bg-color: #2d2d2d;
      --text-color: #fff;
      --border-color: #444;
      --code-bg: #1e1e1e;
      --input-bg: #3d3d3d;
      --secondary-bg: #555;
      --accent-color: #0d6efd;
      --accent-hover: #0b5ed7;
    }
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

  // Submit action (on click of the "Invio" button or press Enter)
  const performAISearch = async () => {
    const query = queryInput.value.trim();
    if (!query) {
      showNotification('Inserisci una domanda!', 'error');
      return;
    }

    submitBtn.disabled = true;
    loading.classList.remove('hidden');
    responseSection.classList.add('hidden');

    const response = await queryGroqAI(selectedText, query);
    
    loading.classList.add('hidden');
    submitBtn.disabled = false;

    if (response) {
      responseContent.textContent = response;
      responseSection.classList.remove('hidden');
      // Scroll automatico verso il basso con scroll fluido
      const dialogBody = dialog.querySelector('.ai-dialog-body');
      dialogBody.scrollTo({
        top: dialogBody.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  submitBtn.addEventListener('click', performAISearch);
  
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      performAISearch();
    }
  });

  responseContent.addEventListener('click', () => {
    navigator.clipboard.writeText(responseContent.textContent)
      .then(() => showNotification('Risposta copiata!', 'success'))
      .catch(() => showNotification('Errore nella copia', 'error'));
  });

  const closeDialog = () => {
    dialog.remove();
  };

  closeBtn.addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog.querySelector('.ai-dialog-overlay')) {
      closeDialog();
    }
  });

  // ESC key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}


const SCROLL_DEBOUNCE_DELAY = 200;

function debounce(func, delay) {
   let timeout;
   return (...args) => {
     clearTimeout(timeout);
     timeout = setTimeout(() => func.apply(this, args), delay);
   };
}

let searchMatches = [];
let currentMatchIndex = -1;

function toggleSearchPanel(show = true) {
  const searchContainer = document.getElementById("search-container");
  if (show) {
    searchContainer.classList.remove("hidden");
    document.getElementById("search-input").focus();
    document.getElementById("search-input").select(); // Seleziona tutto il testo nella casella
  } else {
    searchContainer.classList.add("hidden");
    clearSearchHighlights();
    document.getElementById("search-input").value = ""; // Pulisci l'input quando chiudi
    document.getElementById("search-results").textContent = "0/0"; // Resetta il contatore
  }
}

function performSearch() {
  const searchTerm = document.getElementById("search-input").value;
  const editor = document.getElementById("editor");
  const text = editor.value;
  
  clearSearchHighlights();
  
  if (!searchTerm) {
    document.getElementById("search-results").textContent = "0/0";
    currentMatchIndex = -1;
    return;
  }
  
  searchMatches = [];
  let match;
  const regex = new RegExp(escapeRegExp(searchTerm), "gi");
  
  while ((match = regex.exec(text)) !== null) {
    searchMatches.push({
      start: match.index,
      end: match.index + searchTerm.length
    });
  }
  
  updateSearchResultsCounter();
  
  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    navigateToMatch(currentMatchIndex);
  }
}

function goToPreviousMatch() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  navigateToMatch(currentMatchIndex);
}

function goToNextMatch() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  navigateToMatch(currentMatchIndex);
}

function navigateToMatch(index) {
  const editor = document.getElementById("editor");
  const match = searchMatches[index];
  
  if (!match) return;
  
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  
  const temp = document.createElement('textarea');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  temp.style.top = '-9999px';
  temp.style.width = editor.clientWidth + 'px';
  temp.style.height = 'auto';
  temp.style.fontSize = window.getComputedStyle(editor).fontSize;
  temp.style.fontFamily = window.getComputedStyle(editor).fontFamily;
  temp.style.lineHeight = window.getComputedStyle(editor).lineHeight;
  temp.style.whiteSpace = window.getComputedStyle(editor).whiteSpace;
  temp.style.wordWrap = window.getComputedStyle(editor).wordWrap;
  temp.style.padding = window.getComputedStyle(editor).padding;
  temp.style.border = window.getComputedStyle(editor).border;
  temp.style.boxSizing = window.getComputedStyle(editor).boxSizing;
  
  temp.value = editor.value.substring(0, match.start);
  document.body.appendChild(temp);
  
  const matchPosition = temp.scrollHeight;
  
  document.body.removeChild(temp);
  
  try {
    const scrollPosition = matchPosition - (editor.clientHeight / 2);
    
    editor.scrollTop = Math.max(0, scrollPosition);
    
    const origBackground = editor.style.background;
    const origTransition = editor.style.transition;
    
    editor.style.transition = 'background-color 0.3s ease';
    editor.style.backgroundColor = '#ffff9980'; 
    setTimeout(() => {
      editor.style.backgroundColor = origBackground;
      editor.style.transition = origTransition;
    }, 500);
  } catch (e) {
    console.error("Errore nel calcolo della posizione di scorrimento:", e);
    
    const textBeforeMatch = editor.value.substring(0, match.start);
    const lineBreaks = textBeforeMatch.split("\n").length - 1;
    
    const computedLineHeight = parseInt(window.getComputedStyle(editor).lineHeight) || 20;
    const scrollPosition = lineBreaks * computedLineHeight;
    editor.scrollTop = scrollPosition - editor.clientHeight / 2;
  }
  
  updateSearchResultsCounter();
}

function calculateLineHeights() {
  const editor = document.getElementById('editor');
  if (!editor) return;
  
  const style = window.getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight);
  
  if (!isNaN(lineHeight)) {
    editor.dataset.lineHeight = lineHeight;
    return lineHeight;
  }
  
  const fontSize = parseFloat(style.fontSize);
  if (!isNaN(fontSize)) {
    const calculatedLineHeight = fontSize * 1.2;
    editor.dataset.lineHeight = calculatedLineHeight;
    return calculatedLineHeight;
  }
  
  editor.dataset.lineHeight = 20;
  return 20;
}

function formatAsCode() {
  const editor = document.getElementById("editor");
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  
  if (start !== end) {
    const selectedText = editor.value.substring(start, end);
    editor.value = editor.value.substring(0, start) + "`" + selectedText + "`" + editor.value.substring(end);
    
    editor.selectionStart = start;
    editor.selectionEnd = end + 2; // +2 per i due backtick aggiunti
  } else {
    const codeBlock = "```\n\n```";
    editor.value = editor.value.substring(0, start) + codeBlock + editor.value.substring(end);
    
    const newCursorPos = start + 4; // 4 = "```\n".length
    editor.selectionStart = newCursorPos;
    editor.selectionEnd = newCursorPos;
  }
  
  updatePreview();
  setDirty(true);
  
  editor.focus();
}

function updateSearchResultsCounter() {
  const counter = document.getElementById("search-results");
  if (searchMatches.length > 0) {
    counter.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
  } else {
    counter.textContent = "0/0";
  }
}

function clearSearchHighlights() {
  searchMatches = [];
  currentMatchIndex = -1;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setupExternalLinks() {
  const preview = document.getElementById("preview");
  
  preview.addEventListener("click", (event) => {
    let target = event.target;
    
    while (target && target !== preview) {
      if (target.tagName === "A" && target.href) {
        event.preventDefault();
        
        shell.openExternal(target.href);
        return;
      }
      target = target.parentNode;
    }
  });
}

function insertMarkdownLink() {
  const editor = document.getElementById("editor");
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  
  if (start !== end) {
    const selectedText = editor.value.substring(start, end);
    const linkText = `[${selectedText}](url)`;
    
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    
    const linkStart = start + selectedText.length + 3;
    const linkEnd = linkStart + 3;
    editor.setSelectionRange(linkStart, linkEnd);
    
    updatePreview();
    setDirty(true);
  } else {
    const linkText = "[text](url)";
    
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    const linkStart = start + 7;
    const linkEnd = linkStart + 3;
    editor.setSelectionRange(linkStart, linkEnd);
    
    updatePreview();
    setDirty(true);
  }
  editor.focus();
}

window.addEventListener("DOMContentLoaded", () => {
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
  let autosaveInterval = null;

  autosaveSwitch.addEventListener("change", function() {
    if (!currentFilePath) {
      this.checked = false;
      showNotification('You must save the file first to enable autosave.', 'error');
      return;
    }
    if (this.checked) {
      if (!autosaveInterval) {
        autosaveInterval = setInterval(() => {
          if (isDirty) {
            const event = new Event('autosave');
            document.dispatchEvent(event);
            saveCurrentFile();
          }
        }, 2000);
      }
    } else {
      if (autosaveInterval) {
        clearInterval(autosaveInterval);
        autosaveInterval = null;
      }
    }
  });

  document.addEventListener('autosave', () => {
  });

  explorerPanel.classList.add("hidden");
  openFolderBtn.addEventListener("click", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      openFolder(result.filePaths[0]);
    }
  });

  collapseAllBtn.addEventListener("click", () => {
    explorerPanel.classList.add("hidden");
  });

  refreshExplorerBtn.addEventListener("click", () => {
    if (currentFolderPath) {
      openFolder(currentFolderPath);
    }
  });

  const updateWordCount = () => {
    const text = editor.value;
    const words = text.trim().split(/\s+/).filter(Boolean);
    wordCountEl.textContent = `word-count: ${words.length}`;
  };
  
  const setDirty = (dirty) => {
    isDirty = dirty;
    title.textContent = dirty ? "*" : "";
  };

  const updatePreview = () => {
    const raw = editor.value;

    const scrollPercent = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    let html = marked.parse(raw, {
      highlight: (code, lang) => {
        return hljs.highlightAuto(code).value;
      }
    });

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const imgs = tempDiv.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.match(/^(?:[a-z]+:)?\/\//i) && currentFilePath) {
        const folder = path.dirname(currentFilePath);
        const absolutePath = path.resolve(folder, src);
        const fileUrl = 'file://' + absolutePath.replace(/\\/g, '/');
        img.setAttribute('src', fileUrl);
      }
    });

    html = tempDiv.innerHTML;

    html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
      return `<div class="mermaid">${code}</div>`;
    });

    preview.innerHTML = html;

    const newScrollTop = scrollPercent * (preview.scrollHeight - preview.clientHeight);
    preview.scrollTop = newScrollTop;

    const codeBlocks = preview.querySelectorAll('pre code');
    codeBlocks.forEach(codeBlock => {
      codeBlock.classList.add('clickable-code');
      codeBlock.title = 'Click to copy the code';
      codeBlock.addEventListener('click', function () {
        const text = this.textContent;

        navigator.clipboard.writeText(text)
          .then(() => {
            const originalBg = this.style.backgroundColor;
            this.style.backgroundColor = '#4CAF50';

            setTimeout(() => {
              this.style.backgroundColor = originalBg;
            }, 500);

            const notification = document.createElement('div');
            notification.className = 'copy-notification';
            notification.textContent = 'Copied!';
            notification.style.position = 'absolute';
            notification.style.top = `${window.scrollY + this.getBoundingClientRect().top - 30}px`;
            notification.style.left = `${window.scrollX + this.getBoundingClientRect().left + this.offsetWidth / 2}px`;
            document.body.appendChild(notification);

            setTimeout(() => {
              document.body.removeChild(notification);
            }, 1500);
          })
          .catch(err => {
            console.error('Errore durante la copia: ', err);
          });
      });
    });

    mermaid.init(undefined, ".mermaid");

    if (window.renderMathInElement) {
      renderMathInElement(preview, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false,
        output: 'html',
        trust: true,
        macros: {
          "\\eqref": "\\href{#1}{}",
        }
      });

      const katexDisplays = preview.querySelectorAll('.katex-display');
      katexDisplays.forEach(display => {
        display.style.overflowX = 'auto';
        display.style.maxWidth = '100%';
      });

      const katexInlines = preview.querySelectorAll('.katex');
      katexInlines.forEach(inline => {
        if (!inline.closest('.katex-display')) {
          inline.style.maxWidth = '100%';
          inline.style.whiteSpace = 'normal';
        }
      });
    }
  };

  editor.addEventListener("keydown", function (e) {

    const pairs = {
      '(': ')',
      '[': ']',
      '{': '}',
      '"': '"',
      '`': '`'
    };

    if (Object.keys(pairs).includes(e.key)) {
      e.preventDefault();

      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const left = editor.value.substring(0, start);
      const right = editor.value.substring(end);
      const pair = pairs[e.key];

      editor.value = left + e.key + pair + right;
      editor.selectionStart = editor.selectionEnd = start + 1;

      updatePreview();
      setDirty(true);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      
      const textBefore = this.value.substring(0, start);
      const selectedText = this.value.substring(start, end);
      const textAfter = this.value.substring(end);
      
      if (start === end) {
        this.value = textBefore + "    " + textAfter;
        this.selectionStart = this.selectionEnd = start + 4;
      } else if (selectedText.includes('\n')) {
        const indentedText = selectedText.replace(/^/gm, "    ");
        this.value = textBefore + indentedText + textAfter;
        
        this.selectionStart = start;
        this.selectionEnd = start + indentedText.length;
      } else {
        this.value = textBefore + "    " + selectedText + textAfter;
        this.selectionStart = start + 4;
        this.selectionEnd = end + 4;
      }
      return;
    }
    
    if (e.ctrlKey) {
      const start = this.selectionStart;
      const end = this.selectionEnd;
      
      if (start === end) return;
      
      const selectedText = this.value.substring(start, end);
      const textBefore = this.value.substring(0, start);
      const textAfter = this.value.substring(end);
      let formattedText = selectedText;
      let newCursorPos = end;
      let handled = true;
      
      switch (e.key) {
        case "1": // H1 - # Testo
          formattedText = `# ${selectedText}`;
          newCursorPos = start + formattedText.length;
          break;
        case "2": // H2 - ## Testo
          formattedText = `## ${selectedText}`;
          newCursorPos = start + formattedText.length;
          break;
        case "3": // H3 - ### Testo
          formattedText = `### ${selectedText}`;
          newCursorPos = start + formattedText.length;
          break;
        case "b": // Bold - **Testo**
        case "B":
          formattedText = `**${selectedText}**`;
          newCursorPos = start + formattedText.length;
          break;
        case "i": // Italic - *Testo*
        case "I":
          formattedText = `*${selectedText}*`;
          newCursorPos = start + formattedText.length;
          break;
        case "u": // Underline - <u>Testo</u>
        case "U":
          formattedText = `<u>${selectedText}</u>`;
          newCursorPos = start + formattedText.length;
          break;
        default:
          handled = false;
      }
      
      if (handled) {
        e.preventDefault();
        this.value = textBefore + formattedText + textAfter;
        this.selectionStart = start;
        this.selectionEnd = start + formattedText.length;
        updatePreview();
        setDirty(true);
      }
    }

    if (e.key === "Enter") {
      const cursorPos = this.selectionStart;
      const textBefore = this.value.substring(0, cursorPos);
      const currentLine = textBefore.split('\n').pop();
      
      const listMatch = currentLine.match(/^(\s*)([*-])\s(.*)$/);
      const numberedListMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
    
      if (numberedListMatch) {
        const [, indent, number, content] = numberedListMatch;
    
        if (content.trim() === '') {
          e.preventDefault();
          const lineStart = cursorPos - currentLine.length;
          this.value = this.value.substring(0, lineStart) + indent + this.value.substring(cursorPos);
          this.selectionStart = this.selectionEnd = lineStart + indent.length;
          updatePreview();
          setDirty(true);
          return;
        }
    
        e.preventDefault();
        const nextNumber = parseInt(number, 10) + 1;
        const newLine = `\n${indent}${nextNumber}. `;
        this.value = this.value.substring(0, cursorPos) + newLine + this.value.substring(cursorPos);
        this.selectionStart = this.selectionEnd = cursorPos + newLine.length;
        updatePreview();
        setDirty(true);
        return;
      }
    
      if (listMatch) {
        const [, indent, marker, content] = listMatch;
        
        if (content.trim() === '') {
          e.preventDefault();
          const lineStart = cursorPos - currentLine.length;
          this.value = this.value.substring(0, lineStart) + 
                      indent + 
                      this.value.substring(cursorPos);
          this.selectionStart = this.selectionEnd = lineStart + indent.length;
          updatePreview();
          setDirty(true);
          return;
        }
        
        e.preventDefault();
        const newListItem = `\n${indent}${marker} `;
        this.value = this.value.substring(0, cursorPos) + 
                    newListItem + 
                    this.value.substring(cursorPos);
        this.selectionStart = this.selectionEnd = cursorPos + newListItem.length;
        updatePreview();
        setDirty(true);
      }
    }
  });


  editor.addEventListener('scroll', () => {
    if (isSyncingScroll) return;

    userIsScrollingEditor = true;
    clearTimeout(scrollTimeoutEditor);
    scrollTimeoutEditor = setTimeout(() => {
      userIsScrollingEditor = false;
    }, SCROLL_DEBOUNCE_DELAY);

    if (!userIsScrollingPreview) {
      isSyncingScroll = true;

      const scrollPercent = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
      preview.scrollTop = scrollPercent * (preview.scrollHeight - preview.clientHeight);

      setTimeout(() => { isSyncingScroll = false; }, 50);
    }
  });

  preview.addEventListener('scroll', () => {
    if (isSyncingScroll) return;

    userIsScrollingPreview = true;
    clearTimeout(scrollTimeoutPreview);
    scrollTimeoutPreview = setTimeout(() => {
      userIsScrollingPreview = false;
    }, SCROLL_DEBOUNCE_DELAY);

    if (!userIsScrollingEditor) {
      isSyncingScroll = true;

      const scrollPercent = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
      editor.scrollTop = scrollPercent * (editor.scrollHeight - editor.clientHeight);

      setTimeout(() => { isSyncingScroll = false; }, 50);
    }
  });
  
  const debouncedUpdate = debounce(() => {
    updatePreview();
    updateWordCount();
  }, 300);
 
  editor.addEventListener("input", () => {
    debouncedUpdate();
    setDirty(true);
  });

  function isMarkdownFile(filePath) {
    return filePath.toLowerCase().endsWith('.md');
  }

  function createFileTree(folderPath, parentElement) {
    try {
      const items = fs.readdirSync(folderPath);
      
      items
        .filter(item => {
          const itemPath = path.join(folderPath, item);
          return fs.statSync(itemPath).isDirectory();
        })
        .sort((a, b) => a.localeCompare(b))
        .forEach(item => {
          const itemPath = path.join(folderPath, item);
          const folderElement = document.createElement('div');
          folderElement.className = 'tree-folder collapsed';
          
          const folderHeader = document.createElement('div');
          folderHeader.className = 'tree-folder-header';
          
          const folderIcon = document.createElement('span');
          folderIcon.className = 'tree-folder-icon';
          folderIcon.textContent = '📁 ';
          
          const folderName = document.createElement('span');
          folderName.textContent = item;
          
          folderHeader.appendChild(folderIcon);
          folderHeader.appendChild(folderName);
          
          const folderContent = document.createElement('div');
          folderContent.className = 'tree-folder-content';
          
          folderElement.appendChild(folderHeader);
          folderElement.appendChild(folderContent);
          parentElement.appendChild(folderElement);
          
          folderHeader.addEventListener('click', () => {
            folderElement.classList.toggle('collapsed');
            
            if (!folderElement.dataset.loaded && !folderElement.classList.contains('collapsed')) {
              createFileTree(itemPath, folderContent);
              folderElement.dataset.loaded = 'true';
            }
          });
        });
      
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
                type: 'question',
                buttons: ['Salva', 'Non salvare', 'Annulla'],
                defaultId: 0,
                title: 'File non salvato',
                message: 'Ci sono modifiche non salvate. Vuoi salvare prima di aprire un nuovo file?'
              });
              
              if (answer === 0) { 
                saveCurrentFile();
              } else if (answer === 2) {
                return;
              }
            }
            
            document.querySelectorAll('.tree-item').forEach(item => {
              item.classList.remove('active');
            });
            
            fileElement.classList.add('active');
            
            const content = fs.readFileSync(itemPath, 'utf8');
            editor.value = content;
            updatePreview();
            updateWordCount();
            currentFilePath = itemPath;
            setDirty(false);
          });
          
          parentElement.appendChild(fileElement);
        });
    } catch (error) {
      console.error('Errore durante la lettura della directory:', error);
    }
  }

  function exportToPdf() {
    const content = preview.innerHTML;
    
    ipcRenderer.send("print-to-pdf", content, path.basename(currentFilePath || ""));
    
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Preparazione PDF in corso...';
    notification.style.position = 'absolute';
    notification.style.top = '50%';
    notification.style.left = '50%';
    notification.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(notification);
    
    ipcRenderer.once('pdf-saved', (event, filePath) => {
      document.body.removeChild(notification);
    });
  }


  function openFolder(folderPath) {
    currentFolderPath = folderPath;
    folderPathEl.textContent = folderPath;
    
    fileTree.innerHTML = '';
    
    explorerPanel.classList.remove("hidden");
    
    createFileTree(folderPath, fileTree);
  }

  function saveCurrentFile() {
    const content = editor.value;

    if (currentFilePath) {
      fs.writeFileSync(currentFilePath, content, "utf8");
      setDirty(false);
    } else {
      const file = dialog.showSaveDialogSync({
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });
      if (file) {
        fs.writeFileSync(file, content, "utf8");
        currentFilePath = file;
        setDirty(false);
        
        if (currentFolderPath && file.startsWith(currentFolderPath)) {
          openFolder(currentFolderPath);
        }
      }
    }
  }

  function createNewFile() {
    if (isDirty) {
      const answer = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Salva', 'Non salvare', 'Annulla'],
        defaultId: 0,
        title: 'File non salvato',
        message: 'Ci sono modifiche non salvate. Vuoi salvare prima di creare un nuovo file?'
      });
      
      if (answer === 0) {
        saveCurrentFile();
      } else if (answer === 2) {
        return;
      }
    }
    
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath, 'nuovo-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: 'Crea nuovo file'
    });
    
    if (!filename) return;
    
    fs.writeFileSync(filename, '', 'utf8');
    
    editor.value = '';
    updatePreview();
    updateWordCount();
    currentFilePath = filename;
    setDirty(false);
    
    openFolder(currentFolderPath);
    
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
  

  newFileBtn.addEventListener("click", () => {
    if (!currentFolderPath) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Nessuna cartella aperta',
        message: 'Per creare un nuovo file, devi prima aprire una cartella.'
      });
      return;
    }
    
    createNewFile();
  });

  editor.addEventListener('paste', async (e) => {
    const clipboardItems = e.clipboardData.items;
    
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        
        if (!currentFilePath) {
          dialog.showMessageBoxSync({
            type: 'info',
            title: 'File non salvato',
            message: 'Per incollare un\'immagine, devi prima salvare il file.'
          });
          
          const file = dialog.showSaveDialogSync({
            filters: [{ name: "Markdown", extensions: ["md"] }]
          });
          
          if (!file) return; // L'utente ha annullato
          
          fs.writeFileSync(file, editor.value, "utf8");
          currentFilePath = file;
          setDirty(false);
        }
        
        const blob = item.getAsFile();
        const reader = new FileReader();
        
        reader.onload = () => {
          const buffer = Buffer.from(reader.result);
          
          const timestamp = new Date().getTime();
          const imageExt = blob.type.split('/')[1]; // es. png, jpeg, gif
          const imageName = `image_${timestamp}.${imageExt}`;
          
          const folderPath = path.dirname(currentFilePath);
          const imagesDir = path.join(folderPath, "images");
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir);
          const imagePath = path.join(imagesDir, imageName);
          
          fs.writeFileSync(imagePath, buffer);
          
          const relativeImagePath = path.relative(folderPath, imagePath).replace(/\\/g, "/");
          const markdownImage = `![immagine](${relativeImagePath})`;

          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          
          editor.value = editor.value.slice(0, start) + markdownImage + editor.value.slice(end);
          
          const newCursorPos = start + markdownImage.length;
          editor.setSelectionRange(newCursorPos, newCursorPos);
      
          updatePreview();
          updateWordCount();
          setDirty(true);
        };
        
        reader.readAsArrayBuffer(blob);
      }
    }
  });

  editor.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    
    const { Menu, MenuItem } = require('@electron/remote');
    const menu = new Menu();
    
    const selectedText = editor.value.substring(editor.selectionStart, editor.selectionEnd).trim();
    
    menu.append(new MenuItem({
      label: 'Cut',
      accelerator: 'CmdOrCtrl+X',
      click: () => document.execCommand('cut')
    }));
    
    menu.append(new MenuItem({
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      click: () => document.execCommand('copy')
    }));
    
    menu.append(new MenuItem({
      label: 'Paste',
      accelerator: 'CmdOrCtrl+V',
      click: () => document.execCommand('paste')
    }));

    menu.append(new MenuItem({
      label: 'Format',
      accelerator: 'CmdOrCtrl+K',
      click: () => formatMarkdown()
    }));
    
    if (selectedText) {
      menu.append(new MenuItem({ type: 'separator' }));

      menu.append(new MenuItem({
        label: 'AI Tool',
        accelerator: 'CmdOrCtrl+Shift+A',
        click: () => showAISearchDialog(selectedText)
      }));
    }

    menu.popup();
  });


  ipcRenderer.on("load-md", (event, filePath, content) => {
    editor.value = content;
    updatePreview();
    updateWordCount();
    currentFilePath = filePath;
    setDirty(false);
    
    document.querySelectorAll('.tree-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.path === filePath) {
        item.classList.add('active');
      }
    });
  });

  ipcRenderer.on("export-pdf", () => {
    exportToPdf();
  });

  ipcRenderer.on("new-file", () => {
    createNewFile();
  });

  ipcRenderer.on("open-folder", (event, folderPath) => {
    openFolder(folderPath);
  });

  ipcRenderer.on("trigger-save", () => {
    saveCurrentFile();
  });

  ipcRenderer.on("toggle-explorer", () => {
    const explorerPanel = document.getElementById("explorer-panel");
    explorerPanel.classList.toggle("hidden");  
  });

  ipcRenderer.on("toggle-preview", () => {
    const preview = document.getElementById('preview');
    const editor = document.getElementById('editor');
    
    if (preview.style.display === 'none') {
      preview.style.display = 'block';
      editor.style.width = '50%';
    } else {
      preview.style.display = 'none';
      editor.style.width = '100%';
    }
    
    setTimeout(calculateLineHeights, 100);  
  });

  ipcRenderer.on("toggle-editor", () => {
    const preview = document.getElementById('preview');
    const editor = document.getElementById('editor');
    
    if (editor.style.display === 'none') {
      editor.style.display = 'block';
      preview.style.width = '50%';
    } else {
      editor.style.display = 'none';
      preview.style.width = '100%';
    }
    
    setTimeout(calculateLineHeights, 100);  
  });

  ipcRenderer.on("toggle-theme", () => {
    document.body.classList.toggle("dark");
  });

  const themeSwitch = document.getElementById("toggle-theme-switch");

  themeSwitch.addEventListener("change", function() {
    if (this.checked) {
      document.body.classList.add("dark");
      localStorage.setItem("mark-theme", "dark");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("mark-theme", "light");
    }
  });

  ipcRenderer.on("insert-image-from-file", async (event, imagePath) => {
    if (!currentFilePath) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'File non salvato',
        message: 'Per inserire un\'immagine, devi prima salvare il file.'
      });

      const file = dialog.showSaveDialogSync({
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });

      if (!file) return;

      fs.writeFileSync(file, editor.value, "utf8");
      currentFilePath = file;
      setDirty(false);
    }

    let fileName = path.basename(imagePath);
    fileName = fileName.replace(/\s+/g, '_');

    const folderPath = path.dirname(currentFilePath);
    const destDir = path.join(folderPath, "images");
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);

    const destPath = path.join(destDir, fileName);

    if (imagePath !== destPath) {
      fs.copyFileSync(imagePath, destPath);
    }
    const relativeImagePath = path.relative(folderPath, destPath).replace(/\\/g, '/');
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const textAfter = editor.value.substring(cursorPos);
    const imageTag = `![${fileName}](${relativeImagePath})`;
    
    editor.value = textBefore + imageTag + textAfter;
    
    const newCursorPos = cursorPos + imageTag.length;
    editor.setSelectionRange(newCursorPos, newCursorPos);
    
    updatePreview();
    updateWordCount();
    setDirty(true);
    editor.focus();
  });


  ipcRenderer.on("paste-image-from-clipboard", () => {
    editor.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: clipboard.availableFormats().some(format => format.includes('image'))
        ? clipboard
        : new DataTransfer()
    }));
  });

  updatePreview();
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
      
      if (e.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  });

  const searchButton = document.getElementById("search-button");
  if (searchButton) {
    searchButton.replaceWith(searchButton.cloneNode(true));
    
    const newSearchButton = document.getElementById("search-button");
    
    newSearchButton.addEventListener("click", () => {
      performSearch();
      goToNextMatch();
    });
  }

  
  searchPrevBtn.addEventListener("click", goToPreviousMatch);
  
  searchNextBtn.addEventListener("click", goToNextMatch);
  
  searchCloseBtn.addEventListener("click", () => {
    toggleSearchPanel(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      toggleSearchPanel(true);
    }

    if (e.ctrlKey && e.key === "l") {
      e.preventDefault();
      insertMarkdownLink();
    }


    if (e.ctrlKey && e.key === "h") {
      e.preventDefault();
      formatAsCode();
    }

    if (e.ctrlKey && e.key === "k") {
      e.preventDefault();
      formatMarkdown();
    }

    if (e.key === "Escape" && !document.getElementById("search-container").classList.contains("hidden")) {
      toggleSearchPanel(false);
    }
    
    if (e.key === "Enter" && !document.getElementById("search-container").classList.contains("hidden")) {
      if (e.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  });
  
  ipcRenderer.on("open-search", () => {
    toggleSearchPanel(true);
  });

  function formatMarkdown() {
    const editor = document.getElementById("editor");
    const originalText = editor.value;
  
    const blocks = originalText.split(/(```[\s\S]*?```)/g);
  
    const formatted = blocks.map(block => {
      if (block.startsWith('```')) {
        return `\n\n${block.trim()}\n\n`;
      }
  
      const patterns = [];
      let text = block.replace(/(\*\*.*?\*\*|\*.*?\*|!\[.*?\]\(.*?\)|\[.*?\]\(.*?\))/g, (match) => {
        patterns.push(match);
        return `§§${patterns.length - 1}§§`;
      });
  
      text = text.replace(/([.,!?;:])(?=[^\s])/g, '$1 ');
      text = text.replace(/\s+([.,!?;:)"])/g, '$1');
      text = text.replace(/\n{3,}/g, '\n\n');
      text = text.replace(/\n?\s*\*{3,}\s*\n?/g, '\n\n***\n\n');
  
      text = text.replace(/([^\n])\n(#{1,6} .+)/g, '$1\n\n$2');
      text = text.replace(/(#{1,6} .+)\n([^\n])/g, '$1\n\n$2');
  
      text = text.replace(/§§(\d+)§§/g, (match, index) => {
        const pattern = patterns[parseInt(index)];
        
        if (pattern.startsWith('![') || (pattern.startsWith('[') && pattern.includes('](')) ) {
          return `\n\n${pattern}\n\n`;
        }
        
        return pattern;
      });
  
      text = text.replace(/\n{3,}/g, '\n\n');
  
      return text.trim();
    });
  
    const finalText = formatted.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  
    editor.value = finalText;
    editor.focus();
    editor.setSelectionRange(finalText.length, finalText.length);
    updatePreview();
  }


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

  function preserveScroll(fn) {
    const scroll = editor.scrollTop;
    fn();
    editor.scrollTop = scroll;
  }

  btnBold && btnBold.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      editor.value = editor.value.substring(0, start) + `**${selected || 'text'}**` + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview();
      setDirty(true);
    });
  });

  btnItalic && btnItalic.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      editor.value = editor.value.substring(0, start) + `*${selected || 'text'}*` + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 1, start + 1 + (selected ? selected.length : 4));
      updatePreview();
      setDirty(true);
    });
  });

  btnCode && btnCode.addEventListener("click", () => {
    preserveScroll(() => {
      formatAsCode();
    });
  });

  btnImage && btnImage.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      const imageMd = `![alt](${selected || 'url'})`;
      editor.value = editor.value.substring(0, start) + imageMd + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 7, start + 10);
      updatePreview();
      setDirty(true);
    });
  });

  btnUl && btnUl.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      const listMd = `* ${selected || 'elem'}`;
      editor.value = editor.value.substring(0, start) + listMd + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview();
      setDirty(true);
    });
  });

  btnOl && btnOl.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      const listMd = `1. ${selected || 'elem'}`;
      editor.value = editor.value.substring(0, start) + listMd + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview();
      setDirty(true);
    });
  });

  btnLink && btnLink.addEventListener("click", () => {
    preserveScroll(() => {
      insertMarkdownLink();
    });
  });

  btnHr && btnHr.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + "***\n" + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 4, start + 4);
      updatePreview();
      setDirty(true);
    });
  });

  btnUnderline && btnUnderline.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      editor.value = editor.value.substring(0, start) + `<u>${selected || 'text'}</u>` + editor.value.substring(end);
      editor.focus();
      editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview();
      setDirty(true);
    });
  });

  const btnExtra = document.getElementById("btn-extra");
  const dropdownExtra = document.getElementById("dropdown-extra");
  btnExtra.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownExtra.classList.toggle("open");
    document.getElementById("dropdown-title").classList.remove("open");
    document.getElementById("dropdown-options").classList.remove("open");
    btnExtra.classList.toggle("active");
  });

  const btnOptions = document.getElementById("btn-options");
  const dropdownOptions = document.getElementById("dropdown-options");
  btnOptions.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownOptions.classList.toggle("open");
    document.getElementById("dropdown-title").classList.remove("open");
    document.getElementById("dropdown-extra").classList.remove("open");
    btnOptions.classList.toggle("active");
  });

  btnTitle.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownTitle.classList.toggle("open");
    document.getElementById("dropdown-extra").classList.remove("open");
    document.getElementById("dropdown-options").classList.remove("open");
    btnTitle.classList.toggle("active");
  });

  dropdownItems.forEach(item => {
    item.addEventListener('click', function () {
      preserveScroll(() => {
        const level = this.getAttribute('data-level');
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const selected = editor.value.substring(start, end) || 'Titolo';
        const hashes = '#'.repeat(level);
        editor.value = editor.value.substring(0, start) + `${hashes} ${selected}` + editor.value.substring(end);
        editor.focus();
        editor.setSelectionRange(start + parseInt(level) + 1, start + parseInt(level) + 1 + selected.length);
        updatePreview();
        setDirty(true);
      });
      dropdownTitle.classList.remove('open');
      btnTitle.classList.remove('active');
    });
  });

  document.addEventListener("click", (e) => {
    if (!dropdownExtra.contains(e.target)) {
      dropdownExtra.classList.remove("open");
      btnExtra.classList.remove("active");
    }
    if (!dropdownOptions.contains(e.target)) {
      dropdownOptions.classList.remove("open");
      btnOptions.classList.remove("active");
    }
    if (!dropdownTitle.contains(e.target)) {
      dropdownTitle.classList.remove("open");
      btnTitle.classList.remove("active");
    }
  });

  btnViewEditor.addEventListener("click", () => {
    editor.style.display = "block";
    editor.style.width = "100%";
    preview.style.display = "none";
    preview.style.width = "100%";
  });
  btnViewSplit.addEventListener("click", () => {
    editor.style.display = "block";
    editor.style.width = "50%";
    preview.style.display = "block";
    preview.style.width = "50%";
  });
  btnViewPreview.addEventListener("click", () => {
    editor.style.display = "none";
    preview.style.display = "block";
    preview.style.width = "100%";
  });
});