// ====== PRE-BOOT: tema + evita FOUC/shift ===================================
(() => {
  try {
    const savedTheme = localStorage.getItem('mark-theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (_) { /* ignore */ }
  document.documentElement.style.visibility = 'hidden';
})();

// ====== IMPORTS ==============================================================
const { ipcRenderer, remote, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog, clipboard } = require("@electron/remote");

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
    if (match) GROQ_API_KEY = match[1].trim();
  }
} catch (err) { /* noop */ }
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
  if (!GROQ_API_KEY) { showNotification('API Groq key missing.', 'error'); return null; }
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

// ====== UTILS ================================================================
const SCROLL_DEBOUNCE_DELAY = 200;
function debounce(func, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
let searchMatches = []; let currentMatchIndex = -1;
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function extToLang(ext) {
  const map = {
    js: 'javascript', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    py: 'python', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', java: 'java', rs: 'rust',
    go: 'go', rb: 'ruby', php: 'php', cs: 'csharp', swift: 'swift', kt: 'kotlin',
    r: 'r', m: 'objectivec', mm: 'objectivec', sh: 'bash', bash: 'bash', zsh: 'bash',
    ps1: 'powershell', sql: 'sql', html: 'html', css: 'css', scss: 'scss', json: 'json',
    yml: 'yaml', yaml: 'yaml', md: 'markdown', tex: 'latex'
  };
  return map[(ext || '').toLowerCase()] || (ext || '').toLowerCase();
}
function looksLikeImage(p) { return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(p || ''); }

// ====== INCLUDE DI CODICE ====================================================
// Supporta: !(Alt)[path[#Lx-Ly]]  e  ![Alt](path[#Lx-Ly])
// Inoltre accetta :x-y come alternativa (es. file.c:10-40)
function preprocessCodeIncludes(raw) {
  if (!raw) return raw;

  const baseDir = currentFilePath ? path.dirname(currentFilePath)
    : (currentFolderPath || process.cwd());

  const handleDirective = (alt, fileSpec) => {
    // Evita di trasformare vere immagini
    if (looksLikeImage(fileSpec)) return null;

    let range = null;
    let filePath = fileSpec;
    const hashMatch = fileSpec.match(/^(.*)#L(\d+)-L(\d+)$/i);
    const colonMatch = fileSpec.match(/^(.*):(\d+)-(\d+)$/);
    if (hashMatch) { filePath = hashMatch[1]; range = [parseInt(hashMatch[2], 10), parseInt(hashMatch[3], 10)]; }
    else if (colonMatch) { filePath = colonMatch[1]; range = [parseInt(colonMatch[2], 10), parseInt(colonMatch[3], 10)]; }

    // Risolvi path assoluto
    const abs = path.resolve(baseDir, filePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      const nice = escapeHtml(filePath);
      const caption = alt ? `<figcaption class="code-figcaption">${escapeHtml(alt)}</figcaption>` : '';
      return `<figure class="code-include error"><div class="include-error">⚠️ File not found: <code>${nice}</code></div>${caption}</figure>`;
    }
    let content = fs.readFileSync(abs, 'utf8');
    let from = 1, to = content.split(/\r?\n/).length;
    if (range && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] <= range[1]) {
      const lines = content.split(/\r?\n/);
      from = Math.max(1, range[0]); to = Math.min(lines.length, range[1]);
      content = lines.slice(from - 1, to).join('\n');
    }
    const ext = path.extname(abs).slice(1);
    const lang = extToLang(ext);
    const caption = alt ? `\n<figcaption class="code-figcaption">${escapeHtml(alt)} — <code>${escapeHtml(filePath)}${range ? ` [L${from}-L${to}]` : ''}</code></figcaption>` : '';
    return `<pre><code class="language-${lang}">${escapeHtml(content)}</code></pre>${caption}`;
  };



  // Pattern 1: !(Alt)[path]
  raw = raw.replace(/!\(([^)]+)\)\[([^\]]+)\]/g, (_, alt, fileSpec) => {
    const rep = handleDirective(alt.trim(), fileSpec.trim());
    return rep ?? `!(${alt})[${fileSpec}]`;
  });

  // Pattern 2: ![Alt](path) — solo se NON è immagine
  raw = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, fileSpec) => {
    if (looksLikeImage(fileSpec)) return `![${alt}](${fileSpec})`;
    const rep = handleDirective((alt || '').trim(), fileSpec.trim());
    return rep ?? `![${alt}](${fileSpec})`;
  });

  return raw;
}

// ====== SEARCH UI, LINKS, ecc. (come prima) =================================
function toggleSearchPanel(show = true) { /* ... identico a prima ... */ }
function performSearch() { /* ... identico a prima ... */ }
function goToPreviousMatch() { /* ... */ }
function goToNextMatch() { /* ... */ }
function navigateToMatch(index) { /* ... */ }
function calculateLineHeights() { /* ... */ }
function updateSearchResultsCounter() { /* ... */ }
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
function insertMarkdownLink() { /* ... identico a prima ... */ }

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

  // --- Query DOM principali
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

  // Layout iniziale
  const container = document.getElementById('container');
  if (container && editor && preview) {
    container.style.cssText = "display:flex;";
    editor.parentElement && (editor.parentElement.style.cssText = "display:block;flex:1;min-width:0;");
    preview.style.cssText = "display:block;flex:1;min-width:0;overflow:auto;";
  }

  // Tema
  try {
    const savedTheme = localStorage.getItem("mark-theme") || "light";
    if (themeSwitch) themeSwitch.checked = savedTheme === "dark";
  } catch (_) { }

  // ===== AUTOSAVE (come prima) =====
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

  // ===== EXPLORER / FILE TREE (come prima) =====
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

  // ===== PREVIEW RENDER (con include) =====
  function updatePreview() {
    if (!editor || !preview) return;

    const rawOriginal = editor.value;
    const raw = preprocessCodeIncludes(rawOriginal);

    const scrollPercent = (preview.scrollHeight > preview.clientHeight)
      ? preview.scrollTop / (preview.scrollHeight - preview.clientHeight)
      : 0;

    let html = marked.parse(raw, {
      highlight: (code, lang) => {
        if (window.hljs) {
          try { return hljs.highlight(code, { language: lang || 'plaintext' }).value; }
          catch { return hljs.highlightAuto(code).value; }
        }
        return code;
      }
    });

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const imgs = tempDiv.querySelectorAll('img');
    imgs.forEach(img => {
      const src = img.getAttribute('src');
      img.setAttribute('loading', 'lazy');
      img.style.height = 'auto';

      let alt = img.getAttribute('alt') || '';
      const originalAlt = alt.replace(/\u00A0/g, ' ').trim();

      let widthPercent = null;
      let cleanedAlt = originalAlt;

      if (/\[small\]/i.test(originalAlt)) {
        widthPercent = 25;
        cleanedAlt = originalAlt.replace(/\[small\]/ig, '').trim();
      } else if (/\[medium\]/i.test(originalAlt)) {
        widthPercent = 50;
        cleanedAlt = originalAlt.replace(/\[medium\]/ig, '').trim();
      } else if (/\[large\]/i.test(originalAlt)) {
        widthPercent = 75;
        cleanedAlt = originalAlt.replace(/\[large\]/ig, '').trim();
      } else if (/\[full\]/i.test(originalAlt)) {
        widthPercent = 100;
        cleanedAlt = originalAlt.replace(/\[full\]/ig, '').trim();
      }

      if (widthPercent !== null) {
        img.style.maxWidth = widthPercent + '%';
        img.setAttribute('alt', cleanedAlt);
      } else {
        img.style.maxWidth = '70%';
      }

      if (src && !src.match(/^(?:[a-z]+:)?\/\//i) && currentFilePath) {
        const folder = path.dirname(currentFilePath);
        const absolutePath = path.resolve(folder, src);
        const fileUrl = 'file://' + absolutePath.replace(/\\/g, '/');
        img.setAttribute('src', fileUrl);
      }
    });

    let outHtml = tempDiv.innerHTML;
    outHtml = outHtml.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_, code) => `<div class="mermaid">${code}</div>`);
    preview.innerHTML = outHtml;

    if (window.hljs) {
      preview.querySelectorAll('pre code').forEach(block => {
        if (!block.classList.contains('hljs')) {
          try { hljs.highlightElement(block); } catch (_) { }
        }
      });
    }

    const maxScroll = (preview.scrollHeight - preview.clientHeight);
    if (maxScroll > 0) preview.scrollTop = scrollPercent * maxScroll;

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
          .catch(err => console.error('Error ', err));
      });
    });

    // Mermaid init
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
          dialog.showMessageBoxSync({ type: 'info', title: 'File not saved', message: 'If you want to paste an image, you should save the file.' });
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

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = preview.innerHTML;

    const imgs = tempDiv.querySelectorAll('img');

    imgs.forEach(img => {
      img.removeAttribute('loading');
      const src = img.getAttribute('src');
      if (!src) return;

      if (/^data:/i.test(src) || /^https?:\/\//i.test(src)) {
        return;
      }

      let filePath = src;

      try {
        if (/^file:\/\//i.test(src)) {
          const u = new URL(src);
          filePath = decodeURIComponent(u.pathname);
          // Su Windows togliamo lo slash iniziale extra
          if (process.platform === 'win32' && filePath.startsWith('/')) {
            filePath = filePath.slice(1);
          }
        } else if (currentFilePath) {
          // Caso: path relativo rispetto al file .md
          const folder = path.dirname(currentFilePath);
          filePath = path.resolve(folder, decodeURIComponent(src));
        }

        // Se il file non esiste, log e continua
        if (!fs.existsSync(filePath)) {
          console.warn('[PDF export] Immagine non trovata:', filePath);
          return;
        }

        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');

        const ext = (path.extname(filePath) || '').toLowerCase();
        let mime = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.gif') mime = 'image/gif';
        else if (ext === '.svg') mime = 'image/svg+xml';
        else if (ext === '.webp') mime = 'image/webp';

        const dataUrl = `data:${mime};base64,${base64}`;
        img.setAttribute('src', dataUrl);
      } catch (err) {
        console.error('[PDF export] Errore nel leggere/convertire immagine:', src, err);
      }
    });

    // A questo punto tutte le immagini locali sono embeddate come data URL
    const content = tempDiv.innerHTML;

    ipcRenderer.send("print-to-pdf", content, path.basename(currentFilePath || ""));

    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'PDF loading...';
    Object.assign(notification.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)'
    });
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
        type: 'question', buttons: ['Save', 'Don\'t Save', 'Discard'], defaultId: 0,
        title: 'File not saved', message: 'There are some changes not saved. Do you want to save before creating another file?'
      });
      if (answer === 0) saveCurrentFile(); else if (answer === 2) return;
    }
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath || '', 'new-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: 'Create new file'
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

  btnBold && btnBold.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `**${selected || 'text'}**`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true);
    });
  });
  btnItalic && btnItalic.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `*${selected || 'text'}*`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 1, start + 1 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true);
    });
  });
  btnCode && btnCode.addEventListener("click", () => preserveScroll(() => { formatAsCode(); }));
  btnImage && btnImage.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const imageMd = `![alt](${selected || 'url'})`; editor.setRangeText(imageMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 7, start + 10); updatePreview(); setDirty(true);
    });
  });
  btnUl && btnUl.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const listMd = `* ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true);
    });
  });
  btnOl && btnOl.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const listMd = `1. ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true);
    });
  });
  btnLink && btnLink.addEventListener("click", () => preserveScroll(() => insertMarkdownLinkBtn()));
  btnHr && btnHr.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; editor.setRangeText("***\n", start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 4, start + 4); updatePreview(); setDirty(true);
    });
  });
  btnUnderline && btnUnderline.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `<u>${selected || 'text'}</u>`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true);
    });
  });
  btnQuote && btnQuote.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const quoteMd = `> ${selected || 'quote'}`;
      editor.value = editor.value.substring(0, start) + quoteMd + editor.value.substring(end);
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 5));
      updatePreview(); setDirty(true);
    });
  });
  btnTable && btnTable.addEventListener("click", () => {
    preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd;
      const tableMd = `| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |`;
      editor.setRangeText(tableMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + tableMd.length, start + tableMd.length);
      editor.dispatchEvent(new Event('input', { bubbles: true })); updatePreview(); setDirty(true);
    });
  });

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

  // ===== MOSTRA DOCUMENTO =====
  requestAnimationFrame(() => {
    document.documentElement.style.visibility = 'visible';
  });

  // Re-render quando cambiamo cartella (per risolvere include relativi)
  const observer = new MutationObserver(() => { /* noop, ma potresti forzare update se serve */ });
  observer.observe(document.getElementById('file-tree') || document.body, { childList: true, subtree: true });

  // Espone updatePreview per eventi esterni se necessario
  window.__forcePreview = updatePreview;
});

// ===== Language selector (footer) =====
(function () {
  function initLangSelector() {
    const preview = document.getElementById('preview');
    const btn = document.getElementById('lang-button');
    const dropdown = document.getElementById('lang-dropdown');
    if (!preview || !btn || !dropdown) return;

    const saved = localStorage.getItem('previewLang') || preview.getAttribute('lang') || 'it';
    setLang(saved);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display === 'block' || btn.getAttribute('aria-expanded') === 'true';
      if (isOpen) {
        dropdown.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      } else {
        dropdown.style.display = 'block';
        btn.setAttribute('aria-expanded', 'true');
      }
    });

    dropdown.addEventListener('click', (e) => {
      const option = e.target.closest('.lang-option');
      if (!option) return;
      const lang = option.dataset.lang;
      setLang(lang);
      dropdown.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    function setLang(lang) {
      try {
        preview.setAttribute('lang', lang);
        btn.textContent = lang.toUpperCase();
        localStorage.setItem('previewLang', lang);
      } catch (err) {
        console.error('Error setting preview language:', err);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLangSelector);
  } else {
    initLangSelector();
  }
})();
