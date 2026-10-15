// --- CARICAMENTO INIZIALE DEL TEMA E DELLA LINGUA ---
const i18n = require("./i18n.js");
const savedTheme = localStorage.getItem('mark-theme') || 'light'; 
if (savedTheme === 'dark') {
  document.body.classList.add('dark');
} else {
  document.body.classList.remove('dark');
}

// Lingua predefinita: inglese come richiesto
const savedLang = localStorage.getItem('mark.lang') || 'en';
i18n.setLanguage(savedLang);

// ====== IMPORTS ==============================================================
const { ipcRenderer, remote, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog, clipboard } = require("@electron/remote");
let katexLib = null;
try {
  katexLib = require("./api/katex.min.js");
} catch (e) {
  if (typeof window !== "undefined") katexLib = window.katex;
}

const {
  startCollaboration,
  leaveCollaboration,
  generateRoomId,
  getCollabState
} = require("./collaboration.js");

// ====== UTILS PRECOCI ======
function escapeHtml(s) { 
  if (typeof s !== 'string') return String(s);
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); 
}

// ====== NOTIFICHE POP-UP OPACO LIQUID GLASS & SWIPE A NUVOLA ======
function getOrCreateNotificationContainer() {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
  }
  return container;
}

function showNotification(message, type = 'info') {
  const container = getOrCreateNotificationContainer();
  const notification = document.createElement('div');
  notification.className = `cloud-notification ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    iconSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  notification.innerHTML = `
    <div class="cloud-notification-icon">${iconSvg}</div>
    <div class="cloud-notification-text">${escapeHtml(message)}</div>
  `;

  container.appendChild(notification);

  let isDragging = false;
  let startX = 0;
  let currentX = 0;
  let dismissTimer = null;
  let isDismissed = false;

  function dismiss(direction = 1) {
    if (isDismissed) return;
    isDismissed = true;
    clearTimeout(dismissTimer);
    notification.classList.remove('grabbing');
    if (direction > 0) {
      notification.classList.add('cloud-dismiss-right');
    } else {
      notification.classList.add('cloud-dismiss-left');
    }
    setTimeout(() => {
      try { notification.remove(); } catch (_) {}
    }, 450);
  }

  function startAutoDismiss() {
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismiss(1); // Scompare dolcemente a destra come una nuvola
    }, 3800);
  }

  startAutoDismiss();

  notification.addEventListener('mouseenter', () => {
    if (!isDragging) clearTimeout(dismissTimer);
  });
  notification.addEventListener('mouseleave', () => {
    if (!isDragging && !isDismissed) startAutoDismiss();
  });

  // Swipe / drag a nuvola verso destra o sinistra
  notification.addEventListener('pointerdown', (e) => {
    if (isDismissed) return;
    isDragging = true;
    startX = e.clientX;
    currentX = startX;
    clearTimeout(dismissTimer);
    notification.classList.add('grabbing');
    try { notification.setPointerCapture(e.pointerId); } catch (_) {}
    notification.style.transition = 'none';
  });

  notification.addEventListener('pointermove', (e) => {
    if (!isDragging || isDismissed) return;
    currentX = e.clientX;
    const deltaX = currentX - startX;
    const tilt = deltaX * 0.04;
    const scale = 1 - Math.min(Math.abs(deltaX) / 800, 0.08);
    const opacity = 1 - Math.min(Math.abs(deltaX) / 320, 0.5);

    notification.style.transform = `translate3d(${deltaX}px, 0, 0) rotate(${tilt}deg) scale(${scale})`;
    notification.style.opacity = `${opacity}`;
  });

  const onPointerEnd = (e) => {
    if (!isDragging) return;
    isDragging = false;
    notification.classList.remove('grabbing');
    try { notification.releasePointerCapture(e.pointerId); } catch (_) {}

    const deltaX = currentX - startX;
    if (Math.abs(deltaX) > 60) {
      dismiss(deltaX > 0 ? 1 : -1);
    } else {
      notification.style.transition = 'all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
      notification.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)';
      notification.style.opacity = '1';
      startAutoDismiss();
    }
  };

  notification.addEventListener('pointerup', onPointerEnd);
  notification.addEventListener('pointercancel', onPointerEnd);
}

// ====== STATO ================================================================
let currentFilePath = null;
let isDirty = false;
let currentFolderPath = null;
let isSyncingScroll = false;
let userIsScrollingEditor = false;
let userIsScrollingPreview = false;
let scrollTimeoutEditor = null;
let scrollTimeoutPreview = null;
let currentTabSize = 4;

// ====== AUTO-UPDATE NOTIFICATIONS ===========================================
ipcRenderer.on('update-available', () => {
  showNotification(i18n.t('notif_update_available'), 'info');
});
ipcRenderer.on('update-downloaded', () => {
  showNotification(i18n.t('notif_update_downloaded'), 'success');
});

// ====== PLATFORM DETECTION & WINDOW CONTROLS ================================
const platform = ipcRenderer.sendSync('get-platform');
document.body.classList.add(`platform-${platform}`);

if (platform !== 'darwin') {
  document.getElementById('win-minimize')?.addEventListener('click', () => ipcRenderer.send('window-minimize'));
  document.getElementById('win-maximize')?.addEventListener('click', () => ipcRenderer.send('window-maximize'));
  document.getElementById('win-close')?.addEventListener('click', () => ipcRenderer.send('window-close'));
}

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

async function queryGroqAI(selectedText, query) {
  if (!GROQ_API_KEY) { showNotification(i18n.t('notif_groq_key_missing'), 'error'); return null; }
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
    showNotification(i18n.t('notif_error', { msg: error.message }), 'error');
    return null;
  }
}

// ====== UTILS ================================================================
const SCROLL_DEBOUNCE_DELAY = 200;
function debounce(func, delay) { let timeout; return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); }; }
let searchMatches = []; let currentMatchIndex = -1;
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

// ====== TASK LIST UTILS & MARKED RENDERER ====================================
function toggleTaskInMarkdown(markdown, targetIndex, isChecked) {
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let currentIdx = 0;
  let codeBlockFence = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[2];
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockFence = fence[0];
      } else if (line.trim().startsWith(codeBlockFence.repeat(3))) {
        inCodeBlock = false;
      }
      continue;
    }

    if (!inCodeBlock) {
      const taskMatch = line.match(/^((?:[ \t]*>[ \t]*)*[ \t]*(?:[*+-]|\d+[.)])\s+)\[([ xX\-])\](.*)$/);
      if (taskMatch) {
        if (currentIdx === targetIndex) {
          lines[i] = `${taskMatch[1]}[${isChecked ? 'x' : ' '}]${taskMatch[3]}`;
          return lines.join('\n');
        }
        currentIdx++;
      }
    }
  }
  return markdown;
}

let checkboxCount = 0;
if (typeof marked !== 'undefined' && marked.use) {
  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      checkbox({ checked }) {
        const index = checkboxCount++;
        return `<input type="checkbox" class="task-list-item-checkbox" data-index="${index}" ${checked ? 'checked' : ''}>`;
      }
    }
  });
}

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
      return `<figure class="code-include error"><div class="include-error">File not found: <code>${nice}</code></div>${caption}</figure>`;
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
    // Wrap il contenuto in triple backtick markdown per evitare che marked interpreti il codice come markdown
    return `\`\`\`${lang}\n${content}\n\`\`\`${caption}`;
  };



  raw = raw.replace(/!\(([^)]+)\)\[([^\]]+)\]/g, (_, alt, fileSpec) => {
    const rep = handleDirective(alt.trim(), fileSpec.trim());
    return rep ?? `!(${alt})[${fileSpec}]`;
  });

  return raw;
}

// ====== MATH PREPROCESSOR (KaTeX LaTeX formulas) =============================
function getKatex() {
  if (katexLib) return katexLib;
  if (typeof window !== "undefined" && window.katex) return window.katex;
  try {
    katexLib = require("./api/katex.min.js");
    return katexLib;
  } catch (e) {
    return null;
  }
}

function processMath(markdown) {
  if (!markdown) return markdown;
  const k = getKatex();
  if (!k) return markdown;

  // 1. Proteggi i blocchi di codice (fenced ``` e ~~~ e inline `...`)
  const codeBlocks = [];
  let protectedMd = markdown.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n\r]+`)/g, (match) => {
    const placeholder = `%%MATH_CODE_BLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(match);
    return placeholder;
  });

  const renderDisplay = (math) => {
    const trimmed = math.trim();
    try {
      const rendered = k.renderToString(trimmed, {
        displayMode: true,
        throwOnError: false,
        trust: true,
        macros: { "\\eqref": "\\href{#1}{}" }
      });
      return `\n\n<div class="katex-display-container">${rendered}</div>\n\n`;
    } catch (err) {
      return `\n\n<div class="katex-display-container katex-error">${trimmed}</div>\n\n`;
    }
  };

  const renderInline = (math) => {
    const trimmed = math.trim();
    try {
      const rendered = k.renderToString(trimmed, {
        displayMode: false,
        throwOnError: false,
        trust: true,
        macros: { "\\eqref": "\\href{#1}{}" }
      });
      return `<span class="katex-inline-container">${rendered}</span>`;
    } catch (err) {
      return `<span class="katex-inline-container katex-error">${trimmed}</span>`;
    }
  };

  // 2. Display math: $$...$$ e \[...\]
  protectedMd = protectedMd.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => renderDisplay(math));
  protectedMd = protectedMd.replace(/\\\[([\s\S]+?)\\\]/g, (match, math) => renderDisplay(math));

  // 3. Inline math: \(...\) e $...$
  protectedMd = protectedMd.replace(/\\\(([\s\S]+?)\\\)/g, (match, math) => renderInline(math));
  protectedMd = protectedMd.replace(/(^|[^\\])\$([^\s\$](?:[^\$\n\r]*?[^\s\$\\ ])?)\$/g, (match, prefix, math) => {
    return prefix + renderInline(math);
  });

  // 4. Ripristina i blocchi di codice
  protectedMd = protectedMd.replace(/%%MATH_CODE_BLOCK_(\d+)%%/g, (_, index) => {
    return codeBlocks[parseInt(index, 10)];
  });

  return protectedMd;
}

// ====== SEARCH UI, LINKS, ecc. (come prima) =================================
function toggleSearchPanel(show = true) {
  const container = document.getElementById("search-container");
  const input = document.getElementById("search-input");
  if (!container) return;
  if (show) {
    container.classList.remove("hidden");
    input && input.focus();
    if (input && input.value) performSearch();
  } else {
    container.classList.add("hidden");
    clearSearchHighlights();
    // Return focus to editor
    const editor = document.getElementById("editor");
    editor && editor.focus();
  }
}


let previewSearchMatches = [];
let isPreviewSearchMode = false;

function highlightDOMNode(node, regex) {
  if (node.nodeType === 3) {
    let match = regex.exec(node.data);
    if (match) {
      const mark = document.createElement('mark');
      mark.className = 'search-highlight preview-highlight';
      const matchNode = node.splitText(match.index);
      matchNode.splitText(match[0].length);
      const clone = matchNode.cloneNode(true);
      mark.appendChild(clone);
      matchNode.parentNode.replaceChild(mark, matchNode);
      previewSearchMatches.push(mark);
      regex.lastIndex = 0;
      highlightDOMNode(mark.nextSibling, regex);
    }
  } else if (node.nodeType === 1 && node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE' && node.nodeName !== 'MARK') {
    let child = node.firstChild;
    while (child) {
      let next = child.nextSibling;
      highlightDOMNode(child, regex);
      child = next;
    }
  }
}

function updateEditorOverlay() {
  const editor = document.getElementById('editor');
  const overlay = document.getElementById('editor-overlay');
  if (!editor || !overlay) return;
  if (isPreviewSearchMode) {
    overlay.innerHTML = '';
    return;
  }
  const text = editor.value;
  let html = '';
  if (searchMatches.length === 0) {
    html = escapeHtml(text);
  } else {
    let lastIndex = 0;
    searchMatches.forEach((match, i) => {
      html += escapeHtml(text.substring(lastIndex, match.start));
      const matchText = text.substring(match.start, match.end);
      const activeClass = (i === currentMatchIndex) ? ' active' : '';
      html += `<span class="search-highlight${activeClass}" id="search-match-${i}">${escapeHtml(matchText)}</span>`;
      lastIndex = match.end;
    });
    html += escapeHtml(text.substring(lastIndex));
  }
  if (text.endsWith('\n')) html += '<br>';
  overlay.innerHTML = html;
}

function clearSearchHighlights() {
  searchMatches = [];
  previewSearchMatches = [];
  currentMatchIndex = -1;
  updateSearchResultsCounter();
  
  const overlay = document.getElementById('editor-overlay');
  if (overlay) overlay.innerHTML = escapeHtml(document.getElementById('editor')?.value || '');
  
  const preview = document.getElementById('preview');
  if (preview) {
    const marks = preview.querySelectorAll('mark.preview-highlight');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
  }
}

function performSearch(jumpToFirst = true) {
  const input = document.getElementById("search-input");
  const editor = document.getElementById("editor");
  const container = document.getElementById("container");
  
  if (!input) return;
  const query = input.value;
  clearSearchHighlights();
  
  if (!query) return;

  isPreviewSearchMode = (container && container.className === "solo-preview") || (typeof isReadingMode !== 'undefined' && isReadingMode);

  const regex = new RegExp(escapeRegExp(query), 'gi');

  if (isPreviewSearchMode) {
    const preview = document.getElementById('preview');
    if (preview) {
      highlightDOMNode(preview, regex);
      if (previewSearchMatches.length > 0) {
        currentMatchIndex = 0;
        scrollToMatch(0);
      }
    }
  } else {
    const text = editor.value;
    searchMatches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      searchMatches.push({ start: match.index, end: match.index + match[0].length });
    }
    if (searchMatches.length > 0) {
      if (jumpToFirst) {
        const currentPos = editor.selectionStart;
        let bestIndex = searchMatches.findIndex(m => m.start >= currentPos);
        if (bestIndex === -1) bestIndex = 0;
        currentMatchIndex = bestIndex;
        scrollToMatch(currentMatchIndex);
      } else {
        if (currentMatchIndex >= searchMatches.length) currentMatchIndex = 0;
        updateEditorOverlay();
      }
    } else {
      currentMatchIndex = -1;
      updateEditorOverlay();
    }
  }
  updateSearchResultsCounter();
}

function scrollToMatch(index) {
  const input = document.getElementById("search-input");
  const wasFocused = document.activeElement === input;
  
  if (isPreviewSearchMode) {
    if (index < 0 || index >= previewSearchMatches.length) return;
    previewSearchMatches.forEach(m => m.classList.remove('active'));
    const mark = previewSearchMatches[index];
    mark.classList.add('active');
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    currentMatchIndex = index;
  } else {
    if (index < 0 || index >= searchMatches.length) return;
    currentMatchIndex = index;
    updateEditorOverlay();
    
    const editor = document.getElementById("editor");
    const match = searchMatches[index];
    editor.setSelectionRange(match.start, match.start);
    
    setTimeout(() => {
      const activeSpan = document.getElementById(`search-match-${index}`);
      if (activeSpan) {
         const top = activeSpan.offsetTop;
         const height = activeSpan.offsetHeight;
         editor.scrollTo({ top: top - (editor.clientHeight / 2) + (height / 2), behavior: 'smooth' });
      }
    }, 10);
  }
  
  if (wasFocused) input.focus();
}

function goToPreviousMatch() {
  const total = isPreviewSearchMode ? previewSearchMatches.length : searchMatches.length;
  if (total === 0) return;
  currentMatchIndex--;
  if (currentMatchIndex < 0) currentMatchIndex = total - 1;
  scrollToMatch(currentMatchIndex);
  updateSearchResultsCounter();
}

function goToNextMatch() {
  const total = isPreviewSearchMode ? previewSearchMatches.length : searchMatches.length;
  if (total === 0) return;
  currentMatchIndex++;
  if (currentMatchIndex >= total) currentMatchIndex = 0;
  scrollToMatch(currentMatchIndex);
  updateSearchResultsCounter();
}

function updateSearchResultsCounter() {
  const el = document.getElementById("search-results");
  if (!el) return;
  const total = isPreviewSearchMode ? previewSearchMatches.length : searchMatches.length;
  if (total === 0) {
    el.textContent = "0/0";
  } else {
    el.textContent = `${currentMatchIndex + 1}/${total}`;
  }
}

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
  const editor = document.getElementById("editor");
  const dropdownExtra = document.getElementById("dropdown-extra");
  if (!editor) return;

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const text = editor.value;
  const selectedText = text.substring(start, end);

  const linkText = selectedText || "testo";
  const insertedString = `[${linkText}](url)`;

  editor.value = text.substring(0, start) + insertedString + text.substring(end);

  if (!selectedText) {
    editor.selectionStart = start + 1;
    editor.selectionEnd = start + 1 + linkText.length;
  } else {
    editor.selectionStart = start + linkText.length + 3; // Salta il blocco '[', ']' e '('
    editor.selectionEnd = start + linkText.length + 6;   // Lunghezza esatta della stringa 'url'
  }

  editor.focus();

  if (typeof updateEditorOverlay === 'function') {
    updateEditorOverlay();
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));

  if (dropdownExtra) {
    dropdownExtra.classList.remove('open');
    const btnExtra = document.getElementById("btn-extra");
    if (btnExtra) btnExtra.classList.remove("active");
  }
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

  // ===== TREE SVG ICONS (FILLED) =====
  const FOLDER_CHEVRON_SVG = `<svg class="tree-chevron-icon" width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const FOLDER_SVG = `<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
  const FILE_SVG = `<svg class="tree-item-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 14H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;

  // ===== UNDO HISTORY LOGIC =====
  let actionHistory = [];
  let lastKnownEditorValue = "";
  let isProgrammaticEdit = false;
  let typingTimeout = null;
  let typingStartValue = null;

  function computeSimpleDiff(oldStr, newStr) {
    let start = 0;
    while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) start++;
    let oldEnd = oldStr.length - 1;
    let newEnd = newStr.length - 1;
    while (oldEnd >= start && newEnd >= start && oldStr[oldEnd] === newStr[newEnd]) {
      oldEnd--;
      newEnd--;
    }
    return {
      start: start,
      deleted: oldStr.substring(start, oldEnd + 1),
      inserted: newStr.substring(start, newEnd + 1)
    };
  }

  function recordAction(actionName, oldVal, newVal) {
    if (oldVal === newVal) return;
    const diff = computeSimpleDiff(oldVal, newVal);
    actionHistory.push({
      id: Date.now() + Math.random(),
      name: actionName,
      diff: diff,
      timestamp: new Date().toLocaleTimeString()
    });
    lastKnownEditorValue = newVal;
  }

  function executeAction(actionName, fn) {
    if (typingStartValue !== null) {
      clearTimeout(typingTimeout);
      recordAction("Typing", typingStartValue, editor.value);
      typingStartValue = null;
    }
    const oldVal = editor.value;
    isProgrammaticEdit = true;
    fn();
    isProgrammaticEdit = false;
    if (editor.value !== oldVal) {
      recordAction(actionName, oldVal, editor.value);
    } else {
      lastKnownEditorValue = editor.value;
    }
  }

  function selectiveUndo(actionId) {
    const actionIndex = actionHistory.findIndex(a => a.id === actionId);
    if (actionIndex === -1) return;
    const action = actionHistory[actionIndex];
    const diff = action.diff;
    let currentText = editor.value;

    let selStart = editor.selectionStart;
    let selEnd = editor.selectionEnd;

    if (diff.inserted === "") {
      let insertPos = Math.min(diff.start, currentText.length);
      editor.value = currentText.substring(0, insertPos) + diff.deleted + currentText.substring(insertPos);
      if (selStart > insertPos) selStart += diff.deleted.length;
      if (selEnd > insertPos) selEnd += diff.deleted.length;
    } else {
      let index = currentText.indexOf(diff.inserted);
      if (index !== -1) {
         let bestIndex = index;
         let minDistance = Math.abs(index - diff.start);
         let nextIndex = currentText.indexOf(diff.inserted, index + 1);
         while(nextIndex !== -1) {
           let dist = Math.abs(nextIndex - diff.start);
           if (dist < minDistance) {
             minDistance = dist;
             bestIndex = nextIndex;
           }
           nextIndex = currentText.indexOf(diff.inserted, nextIndex + 1);
         }
         editor.value = currentText.substring(0, bestIndex) + diff.deleted + currentText.substring(bestIndex + diff.inserted.length);
         if (selStart > bestIndex) selStart -= diff.inserted.length;
         if (selStart > bestIndex) selStart += diff.deleted.length; // adjust roughly
         selEnd = selStart;
      } else {
         if (typeof showNotification === 'function') {
           showNotification(i18n.t("notif_undo_error"), "error");
         }
         return;
      }
    }
    actionHistory.splice(actionIndex, 1);
    isProgrammaticEdit = true;
    lastKnownEditorValue = editor.value;
    editor.setSelectionRange(selStart, selEnd);
    updatePreview(); setDirty(true); updateEditorOverlay();
    setTimeout(() => isProgrammaticEdit = false, 100);
    renderHistoryModal();
  }

  function renderHistoryModal() {
    const carousel = document.getElementById("history-carousel");
    if (!carousel) return;
    carousel.innerHTML = '<div class="history-spacer"></div>';
    
    actionHistory.forEach((action, i) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.dataset.id = action.id;
      item.innerHTML = `
        <div class="history-action-name">${action.name} <span style="font-size:12px;opacity:0.6;">${action.timestamp}</span></div>
        <button class="history-undo-btn">&larr; Undo</button>
      `;
      item.querySelector('.history-undo-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        selectiveUndo(action.id);
      });
      item.addEventListener('click', () => {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      carousel.appendChild(item);
    });
    carousel.innerHTML += '<div class="history-spacer"></div>';
    
    // Trigger scroll event to update active
    carousel.dispatchEvent(new Event('scroll'));
    // Scroll to bottom (latest action)
    setTimeout(() => {
      carousel.scrollTop = carousel.scrollHeight;
    }, 50);
  }

  const historyModal = document.getElementById("history-modal");
  const btnCloseHistory = document.getElementById("btn-close-history");
  if (btnCloseHistory) {
    btnCloseHistory.addEventListener("click", () => historyModal.classList.add("hidden"));
  }
  const historyCarousel = document.getElementById("history-carousel");
  if (historyCarousel) {
    historyCarousel.addEventListener('scroll', () => {
      const items = historyCarousel.querySelectorAll('.history-item');
      if (items.length === 0) return;
      const containerCenter = historyCarousel.scrollTop + (historyCarousel.clientHeight / 2);
      let closestItem = null;
      let minDiff = Infinity;
      items.forEach(item => {
        const itemCenter = item.offsetTop + (item.offsetHeight / 2) - historyCarousel.offsetTop;
        const diff = Math.abs(containerCenter - itemCenter);
        if (diff < minDiff) {
          minDiff = diff;
          closestItem = item;
        }
        item.classList.remove('active');
      });
      if (closestItem) closestItem.classList.add('active');
    });
  }

  // Hook per aprire modal, Ctrl+Z e frecce nel modal
  document.addEventListener('keydown', (e) => {
    if (!historyModal.classList.contains('hidden')) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        historyCarousel.scrollBy({ top: -60, behavior: 'smooth' });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        historyCarousel.scrollBy({ top: 60, behavior: 'smooth' });
      } else if (e.key === 'Enter') {
        // Option to trigger the active undo button
        const activeBtn = historyCarousel.querySelector('.history-item.active .history-undo-btn');
        if (activeBtn) activeBtn.click();
      }
    }
    
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      historyModal.classList.remove('hidden');
      renderHistoryModal();
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      // Linear undo
      if (actionHistory.length > 0) {
        e.preventDefault();
        const latestAction = actionHistory[actionHistory.length - 1];
        selectiveUndo(latestAction.id);
      }
    }
  });

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
  const themeBtnLight = document.getElementById("theme-btn-light");
  const themeBtnDark = document.getElementById("theme-btn-dark");
  const langBtnEn = document.getElementById("lang-btn-en");
  const langBtnIt = document.getElementById("lang-btn-it");
  const btnToggleExplorer = document.getElementById('btn-toggle-explorer');
  const explorerResizer = document.getElementById('explorer-resizer');
  
  // READING MODE
  const readingModePopup = document.getElementById("reading-mode-popup");
  const navbar = document.getElementById("navbar");
  const footer = document.getElementById("footer");
  const appContainer = document.getElementById("app-container");
  const viewContainer = document.getElementById("container"); // To toggle split/solo views
  
  let previousViewClass = "split-view";
  let isReadingMode = false;

  function setReadingMode(active) {
    isReadingMode = active;
    if (active) {
      if (viewContainer) previousViewClass = viewContainer.className || "split-view";
      if (navbar) navbar.classList.add('reading-mode-active');
      if (footer) footer.style.display = 'none';
      if (explorerPanel) explorerPanel.classList.add('hidden');
      if (explorerResizer) explorerResizer.classList.add('hidden');
      if (viewContainer) viewContainer.className = "solo-preview";
      if (appContainer) {
        appContainer.style.marginTop = '0';
        appContainer.style.marginBottom = '0';
        appContainer.style.height = '100vh';
      }
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) settingsModal.classList.add('hidden');
      if (readingModePopup) {
        readingModePopup.classList.add('visible');
        setTimeout(() => {
          readingModePopup.classList.remove('visible');
        }, 3000);
      }
      refreshSearchIfOpen();
    } else {
      if (navbar) navbar.classList.remove('reading-mode-active');
      if (footer) footer.style.display = 'flex';
      if (viewContainer) viewContainer.className = previousViewClass;
      if (appContainer) {
        appContainer.style.marginTop = '55px';
        appContainer.style.marginBottom = '35px';
        appContainer.style.height = 'calc(100% - 55px - 35px)';
      }
      refreshSearchIfOpen();
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isReadingMode) {
      setReadingMode(false);
    }
  });

  if (preview) {
    preview.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { Menu, MenuItem, getCurrentWindow } = require('@electron/remote');
      const menu = new Menu();
      
      if (!isReadingMode) {
        menu.append(new MenuItem({
          label: 'Enable Reading Mode',
          click: () => { setReadingMode(true); }
        }));
      } else {
        menu.append(new MenuItem({
          label: 'Disable Reading Mode',
          click: () => { setReadingMode(false); }
        }));
      }
      
      menu.popup({ window: getCurrentWindow() });
    });
  }

  if (btnToggleExplorer) {
    btnToggleExplorer.addEventListener('click', () => {
      if (explorerPanel) explorerPanel.classList.toggle('hidden');
      if (explorerResizer) explorerResizer.classList.toggle('hidden', explorerPanel.classList.contains('hidden'));
    });
  }

  // --- LOGICA RIDIMENSIONAMENTO (RESIZER) ---
  if (explorerResizer && explorerPanel) {
    let isResizing = false;

    explorerResizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      document.body.style.cursor = 'ew-resize';
      explorerResizer.classList.add('is-resizing');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      // Limiti minimi e massimi per l'explorer
      if (newWidth < 150) newWidth = 150;
      if (newWidth > window.innerWidth * 0.7) newWidth = window.innerWidth * 0.7; 

      explorerPanel.style.width = newWidth + 'px';
      document.documentElement.style.setProperty('--explorer-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = 'default';
        explorerResizer.classList.remove('is-resizing');
      }
    });
  }

  // Assicurati che collapseAllBtn o IPC nascondano anche il resizer
  collapseAllBtn && collapseAllBtn.addEventListener("click", () => {
    if (explorerPanel) explorerPanel.classList.add("hidden");
    if (explorerResizer) explorerResizer.classList.add("hidden");
  });

  newFileBtn && newFileBtn.addEventListener("click", () => {
    if (!confirmLeaveCollabIfActive('action_create_new')) {
      return;
    }

    if (!currentFolderPath) {
      if (typeof createNewFile === 'function') createNewFile();
      return;
    }

    // Creazione del campo input inline
    const inputContainer = document.createElement('div');
    inputContainer.className = 'tree-item tree-file';
    inputContainer.innerHTML = `<span class="tree-file-icon">${FILE_SVG}</span>`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'nuovo-file.md';
    input.className = 'tree-inline-input';

    inputContainer.appendChild(input);

    // Posiziona l'input in cima alla lista
    if (fileTree.firstChild) {
      fileTree.insertBefore(inputContainer, fileTree.firstChild);
    } else {
      fileTree.appendChild(inputContainer);
    }

    input.focus();

    let isHandled = false;

    const handleInputSubmit = () => {
      if (isHandled) return;
      isHandled = true;

      const filename = input.value.trim();
      if (filename) {
        const finalName = filename.endsWith('.md') ? filename : filename + '.md';
        const fullPath = path.join(currentFolderPath, finalName);

        if (!fs.existsSync(fullPath)) {
          fs.writeFileSync(fullPath, '', 'utf8');

          // Apre automaticamente il nuovo file nell'editor
          if (isDirty && typeof saveCurrentFile === 'function') {
            saveCurrentFile();
          }
          currentFilePath = fullPath;
          if (editor) { editor.value = ''; lastKnownEditorValue = ''; }
          updatePreview();
          if (typeof updateWordCount === 'function') updateWordCount();
          if (typeof updateEditorOverlay === 'function') updateEditorOverlay();
          setDirty(false);
        } else {
          dialog.showErrorBox('Errore', 'Un file con questo nome esiste già.');
        }
      }

      // Ricarica la vista della cartella
      openFolder(currentFolderPath);
    };

    // Conferma col tasto Invio, annulla con Esc
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleInputSubmit();
      if (e.key === 'Escape') {
        isHandled = true;
        openFolder(currentFolderPath);
      }
    });

    // Se l'utente clicca fuori dall'input, il file viene creato
    input.addEventListener('blur', handleInputSubmit);
  });

  let autosaveInterval = null;

  const container = document.getElementById('container');
  if (container && editor && preview) {
    container.className = "split-view";
    
    container.removeAttribute("style");
    if(editor.parentElement) editor.parentElement.removeAttribute("style");
    preview.removeAttribute("style");
  }

  // Theme & language initialized via settings segmented buttons

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
          showNotification && showNotification(i18n.t('notif_save_first_autosave'), 'error');
          return;
        }
        startAutosave(); showNotification && showNotification(i18n.t('notif_autosave_on'), 'success');
      } else { stopAutosave(); showNotification && showNotification(i18n.t('notif_autosave_off'), 'info'); }
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
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')
      .replace(/(^|[^\\])\$([^\s\$](?:[^\$\n\r]*?[^\s\$\\ ])?)\$/g, ' ')
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
    wordCountEl.textContent = i18n.t('word_count', { count: words ? words.length : 0 });
  };

  // ===== DIRTY FLAG =====
  const setDirty = (dirty) => { isDirty = dirty; if (title) title.textContent = dirty ? "*" : ""; };

  // ===== PREVIEW RENDER (con include) =====
  function updatePreview() {
    if (!editor || !preview) return;

    const rawOriginal = editor.value;
    let raw = preprocessCodeIncludes(rawOriginal);
    raw = processMath(raw);

    checkboxCount = 0;

    // Capture current scroll state
    const currentScrollTop = preview.scrollTop;
    const maxScrollTop = preview.scrollHeight - preview.clientHeight;
    // Consider "at bottom" if within 20px of the bottom
    const isAtBottom = (maxScrollTop - currentScrollTop) <= 20;

    let html = marked.parse(raw, {
      breaks: true,
      gfm: true,
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

    // Restore scroll position
    if (isAtBottom) {
      preview.scrollTop = preview.scrollHeight - preview.clientHeight;
    } else {
      preview.scrollTop = currentScrollTop;
    }

    const CODE_COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    const CODE_CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

    preview.querySelectorAll('pre').forEach(pre => {
      const codeBlock = pre.querySelector('code');
      if (!codeBlock) return;
      if (!pre.querySelector('.code-copy-btn')) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.setAttribute('title', 'Copia codice');
        copyBtn.setAttribute('type', 'button');
        copyBtn.innerHTML = CODE_COPY_ICON;
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = codeBlock.textContent;
          navigator.clipboard.writeText(text)
            .then(() => {
              copyBtn.innerHTML = CODE_CHECK_ICON;
              copyBtn.classList.add('copied');
              setTimeout(() => {
                copyBtn.innerHTML = CODE_COPY_ICON;
                copyBtn.classList.remove('copied');
              }, 1500);
            })
            .catch(err => console.error('Error copying code:', err));
        });
        pre.appendChild(copyBtn);
      }
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

    // Math fallback
    if (window.renderMathInElement) {
      try {
        renderMathInElement(preview, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false }
          ],
          throwOnError: false, output: 'html', trust: true,
          macros: { "\\eqref": "\\href{#1}{}" }
        });
      } catch (_) {}
    }
    
    // Re-apply preview search highlights if needed
    const sc = document.getElementById("search-container");
    if (sc && !sc.classList.contains("hidden")) {
      const container = document.getElementById("container");
      const isPreviewOnly = (container && container.className === "solo-preview") || (typeof isReadingMode !== 'undefined' && isReadingMode);
      if (isPreviewOnly) {
         // Debounce or just call it, but be careful not to loop
         setTimeout(() => performSearch(false), 10);
      }
    }
  }

  // ===== Input Editor =====
  editor && editor.addEventListener('keydown', (e) => {
    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', '`': '`' };
    const closingChars = [')', ']', '}', '"', '`'];

    // 1. Overtyping: se premo chiusura e sono davanti a quella chiusura, avanzo
    if (closingChars.includes(e.key)) {
      const start = editor.selectionStart;
      // Controllo che non ci sia selezione attiva
      if (start === editor.selectionEnd && editor.value.charAt(start) === e.key) {
        e.preventDefault();
        editor.selectionStart = editor.selectionEnd = start + 1;
        return;
      }
    }

    // 2. Auto-close apertura
    if (Object.keys(pairs).includes(e.key)) {
      e.preventDefault();
      const start = editor.selectionStart, end = editor.selectionEnd;
      const left = editor.value.substring(0, start), right = editor.value.substring(end);
      const pair = pairs[e.key];
      executeAction("Auto-close", () => {
        editor.value = left + e.key + pair + right;
        editor.selectionStart = editor.selectionEnd = start + 1;
        updatePreview(); setDirty(true); updateEditorOverlay();
      }); return;
    }

    if (e.key === "Tab") {
      const start = editor.selectionStart, end = editor.selectionEnd;
      if (start === end && closingChars.includes(editor.value.charAt(start))) {
        e.preventDefault();
        editor.selectionStart = editor.selectionEnd = start + 1;
        return;
      }

      e.preventDefault();
      const before = editor.value.substring(0, start);
      const selected = editor.value.substring(start, end);
      const after = editor.value.substring(end);
      const tabSpaces = " ".repeat(currentTabSize);

      executeAction("Indentation", () => {
        if (start === end) {
          editor.value = before + tabSpaces + after;
          editor.selectionStart = editor.selectionEnd = start + currentTabSize;
        } else if (selected.includes('\n')) {
          const regex = new RegExp('^', 'gm');
          const indented = selected.replace(regex, tabSpaces);
          editor.value = before + indented + after;
          editor.selectionStart = start; editor.selectionEnd = start + indented.length;
        } else {
          editor.value = before + tabSpaces + selected + after;
          editor.selectionStart = start + currentTabSize; editor.selectionEnd = end + currentTabSize;
        }
        updateEditorOverlay();
      }); return;
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
        executeAction("Formatting Shortcut", () => {
          editor.value = before + formatted + after;
          editor.selectionStart = start; editor.selectionEnd = start + formatted.length;
          updatePreview(); setDirty(true); updateEditorOverlay();
        });
      }
    }
    if (e.key === "Enter") {
      const cursorPos = editor.selectionStart;
      const before = editor.value.substring(0, cursorPos);
      const currentLine = before.split('\n').pop();

      // Checkbox list numerata (es. "1. [ ] Testo")
      const numberedTaskMatch = currentLine.match(/^(\s*)(\d+)\.\s+\[([ xX\-])\]\s*(.*)$/);
      if (numberedTaskMatch) {
        const [, indent, number, check, content] = numberedTaskMatch;
        if (content.trim() === '') {
          e.preventDefault();
          executeAction("Remove List", () => {
            const lineStart = cursorPos - currentLine.length;
            editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
            editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
            updatePreview(); setDirty(true); updateEditorOverlay();
          });
          return;
        }
        e.preventDefault();
        const nextNumber = parseInt(number, 10) + 1;
        const newLine = `\n${indent}${nextNumber}. [ ] `;
        executeAction("Continue Numbered Checkbox", () => {
          editor.value = editor.value.substring(0, cursorPos) + newLine + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = cursorPos + newLine.length;
          updatePreview(); setDirty(true); updateEditorOverlay();
        });
        return;
      }

      // Checkbox list puntata (es. "- [ ] Testo", "* [ ] Testo", "+ [ ] Testo")
      const taskMatch = currentLine.match(/^(\s*)([*+-])\s+\[([ xX\-])\]\s*(.*)$/);
      if (taskMatch) {
        const [, indent, marker, check, content] = taskMatch;
        if (content.trim() === '') {
          e.preventDefault();
          executeAction("Remove List", () => {
            const lineStart = cursorPos - currentLine.length;
            editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
            editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
            updatePreview(); setDirty(true); updateEditorOverlay();
          });
          return;
        }
        e.preventDefault();
        const newListItem = `\n${indent}${marker} [ ] `;
        executeAction("Continue Checkbox", () => {
          editor.value = editor.value.substring(0, cursorPos) + newListItem + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = cursorPos + newListItem.length;
          updatePreview(); setDirty(true); updateEditorOverlay();
        });
        return;
      }

      const numberedListMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
      if (numberedListMatch) {
        const [, indent, number, content] = numberedListMatch;
        if (content.trim() === '') {
          e.preventDefault();
          executeAction("Remove List", () => {
            const lineStart = cursorPos - currentLine.length;
            editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
            editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
            updatePreview(); setDirty(true); updateEditorOverlay();
          }); return;
        }
        e.preventDefault();
        const nextNumber = parseInt(number, 10) + 1;
        const newLine = `\n${indent}${nextNumber}. `;
        executeAction("Continue Numbered List", () => {
          editor.value = editor.value.substring(0, cursorPos) + newLine + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = cursorPos + newLine.length;
          updatePreview(); setDirty(true); updateEditorOverlay();
        }); return;
      }
      const listMatch = currentLine.match(/^(\s*)([*+-])\s(.*)$/);
      if (listMatch) {
        const [, indent, marker, content] = listMatch;
        if (content.trim() === '') {
          e.preventDefault();
          executeAction("Remove List", () => {
            const lineStart = cursorPos - currentLine.length;
            editor.value = editor.value.substring(0, lineStart) + indent + editor.value.substring(cursorPos);
            editor.selectionStart = editor.selectionEnd = lineStart + indent.length;
            updatePreview(); setDirty(true); updateEditorOverlay();
          }); return;
        }
        e.preventDefault();
        const newListItem = `\n${indent}${marker} `;
        executeAction("Continue List", () => {
          editor.value = editor.value.substring(0, cursorPos) + newListItem + editor.value.substring(cursorPos);
          editor.selectionStart = editor.selectionEnd = cursorPos + newListItem.length;
          updatePreview(); setDirty(true); updateEditorOverlay();
        });
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

  const debouncedUpdate = debounce(() => {
    updatePreview();
    updateWordCount();
    const sc = document.getElementById("search-container");
    if (sc && !sc.classList.contains("hidden")) {
      performSearch(false);
    } else {
      updateEditorOverlay();
    }
  }, 300);
  editor && editor.addEventListener("input", () => {
    if (isProgrammaticEdit) {
      debouncedUpdate();
      return;
    }
    if (typingStartValue === null) {
      typingStartValue = lastKnownEditorValue;
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      recordAction("Typing", typingStartValue, editor.value);
      typingStartValue = null;
    }, 1000);

    debouncedUpdate();
    setDirty(true);
    // Update overlay on input (clears highlights if text changes, or we could re-search)
    // For now, let's clear highlights if text changes to avoid mismatch
    if (searchMatches.length > 0) {
      // Optional: re-run search if panel is open?
      const searchContainer = document.getElementById("search-container");
      if (searchContainer && !searchContainer.classList.contains("hidden")) {
        performSearch();
      } else {
        clearSearchHighlights();
      }
    } else {
      updateEditorOverlay();
    }
  });

  // Sync scroll for overlay
  const overlay = document.getElementById('editor-overlay');
  if (editor && overlay) {
    editor.addEventListener('scroll', () => {
      overlay.scrollTop = editor.scrollTop;
      overlay.scrollLeft = editor.scrollLeft;
    });
    // Initial sync
    updateEditorOverlay();
  }

  // ===== Paste immagini =====
  editor && editor.addEventListener('paste', async (e) => {
    const clipboardItems = e.clipboardData?.items || [];
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        if (!currentFilePath) {
          dialog.showMessageBoxSync({ type: 'info', title: i18n.t('dialog_paste_img_title'), message: i18n.t('dialog_paste_img_message') });
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
          executeAction("Paste Image", () => {
            const start = editor.selectionStart; const end = editor.selectionEnd;
            editor.value = editor.value.slice(0, start) + markdownImage + editor.value.slice(end);
            const newCursorPos = start + markdownImage.length;
            editor.setSelectionRange(newCursorPos, newCursorPos);
            updatePreview(); updateWordCount(); setDirty(true);
          });
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
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Show Undo History', accelerator: 'Ctrl+Alt+Z', click: () => {
      const modal = document.getElementById("history-modal");
      if(modal) { modal.classList.remove('hidden'); renderHistoryModal(); }
    }}));

    if (selectedText) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'AI Tool', accelerator: 'CmdOrCtrl+Shift+A', click: () => showAISearchDialog(selectedText) }));
    }
    menu.popup();
  });

  // ===== IPC handlers (file/load/view/theme) =====
  ipcRenderer.on("load-md", (event, filePath, content) => {
    if (!editor) return;
    if (currentFilePath === filePath) return;

    if (!confirmLeaveCollabIfActive('action_open_file', { name: path.basename(filePath) })) {
      return;
    }

    currentFilePath = filePath;
    editor.value = content; 
    lastKnownEditorValue = content;
    updatePreview(); 
    wordCountEl && updateWordCount(); 
    updateEditorOverlay();
    setDirty(false);

    // Ricava la cartella del file e la apre nell'explorer se non è già aperta
    const containingFolder = path.dirname(filePath);
    if (currentFolderPath !== containingFolder) {
      openFolder(containingFolder);
    }

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
  ipcRenderer.on("toggle-theme", () => {
    const isDark = document.body.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  });

  // ===== Inserimento immagini via menu =====
  ipcRenderer.on("insert-image-from-file", async (event, imagePath) => {
    if (!editor) return;
    if (!currentFilePath) {
      dialog.showMessageBoxSync({ type: 'info', title: i18n.t('dialog_paste_img_title'), message: i18n.t('dialog_paste_img_message') });
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
    executeAction("Image from File", () => {
      editor.value = textBefore + imageTag + textAfter;
      const newCursorPos = cursorPos + imageTag.length;
      editor.setSelectionRange(newCursorPos, newCursorPos);
      updatePreview(); wordCountEl && updateWordCount(); setDirty(true); updateEditorOverlay(); editor.focus();
    });
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
  searchInput && searchInput.addEventListener("input", () => {
    performSearch(true);
  });

  searchInput && searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) goToPreviousMatch(); else goToNextMatch();
    }
  });

  const searchButton = document.getElementById("search-button");
  if (searchButton) {
    searchButton.replaceWith(searchButton.cloneNode(true));
    const newSearchButton = document.getElementById("search-button");
    newSearchButton && newSearchButton.addEventListener("click", () => {
      // If no matches, search. If matches, go next.
      if (searchMatches.length === 0) performSearch();
      else goToNextMatch();
    });
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
    if (e.key === "Enter" && sc && !sc.classList.contains("hidden")) {
      // Don't hijack Enter if we are in the editor
      if (document.activeElement === document.getElementById("editor")) return;
      if (e.shiftKey) goToPreviousMatch(); else goToNextMatch();
    }
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

    let displayPath = folderPath;
    if (folderPath.startsWith('/home')) {
      displayPath = path.relative('/home', folderPath);
    }
    if (folderPathEl) {
      folderPathEl.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span class="folder-path-text">${displayPath}</span>
      `;
      folderPathEl.classList.remove('hidden');
    }

    if (fileTree) fileTree.innerHTML = '';
    explorerPanel && explorerPanel.classList.remove("hidden");

    const explorerResizer = document.getElementById('explorer-resizer');
    if (explorerResizer) explorerResizer.classList.remove('hidden');

    createFileTree(folderPath, fileTree);
  }

  // ===== COLLABORATION GUARD CONTRO CAMBIO FILE ACCIDENTALE =====
  function confirmLeaveCollabIfActive(actionKey = 'action_open_file', actionParam = {}) {
    const collabState = getCollabState();
    if (!collabState || !collabState.isActive) {
      return true;
    }

    const actionText = typeof actionKey === 'string' && actionKey.startsWith('action_')
      ? i18n.t(actionKey, actionParam)
      : actionKey;

    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: [i18n.t('dialog_leave_session'), i18n.t('dialog_stay')],
      defaultId: 1,
      cancelId: 1,
      title: i18n.t('dialog_leave_collab_title'),
      message: i18n.t('dialog_leave_collab_message', { action: actionText })
    });

    if (choice === 0) {
      if (currentFilePath && isDirty && typeof saveCurrentFile === 'function') {
        try {
          saveCurrentFile();
        } catch (e) {
          console.error('[Collab] Errore salvataggio prima di terminare sessione:', e);
        }
      }
      leaveCollaboration();
      const bCollab = document.getElementById("btn-collab");
      bCollab?.classList.remove("active-collab");
      const sContainer = document.getElementById("collab-status-container");
      sContainer?.classList.add("hidden");
      if (typeof updateCollabModalView === 'function') {
        updateCollabModalView();
      }
      showNotification(i18n.t('notif_session_ended'), "info");
      return true;
    }

    return false;
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
    if (!confirmLeaveCollabIfActive('creare un nuovo file')) {
      return;
    }

    if (isDirty) {
      const answer = dialog.showMessageBoxSync({
        type: 'question', buttons: [i18n.t('dialog_save'), i18n.t('dialog_dont_save'), i18n.t('dialog_cancel')], defaultId: 0,
        title: i18n.t('dialog_unsaved_title'), message: i18n.t('dialog_unsaved_message')
      });
      if (answer === 0) saveCurrentFile(); else if (answer === 2) return;
    }
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath || '', 'new-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: i18n.t('dialog_create_new_file_title')
    });
    if (!filename) return;
    fs.writeFileSync(filename, '', 'utf8');
    editor.value = ''; lastKnownEditorValue = ''; updatePreview(); updateWordCount(); updateEditorOverlay();
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
          const folderHeader = document.createElement('div');
          folderHeader.className = 'tree-folder-header';
          folderHeader.title = item;
          folderHeader.innerHTML = `
            <span class="tree-folder-chevron">${FOLDER_CHEVRON_SVG}</span>
            <span class="tree-folder-icon">${FOLDER_SVG}</span>
            <span class="tree-label">${item}</span>
          `;
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
          fileElement.title = item;
          fileElement.dataset.path = itemPath;
          fileElement.innerHTML = `
            <span class="tree-file-icon">${FILE_SVG}</span>
            <span class="tree-label">${item}</span>
          `;
          fileElement.addEventListener('click', () => {
            if (currentFilePath === itemPath) return;

            if (!confirmLeaveCollabIfActive('action_open_file', { name: item })) {
              return;
            }

            if (isDirty) {
              const answer = dialog.showMessageBoxSync({
                type: 'question', buttons: [i18n.t('dialog_save'), i18n.t('dialog_dont_save'), i18n.t('dialog_cancel')], defaultId: 0,
                title: i18n.t('dialog_unsaved_title'), message: i18n.t('dialog_unsaved_message')
              });
              if (answer === 0) saveCurrentFile();
              else if (answer === 2) return;
            }
            document.querySelectorAll('.tree-item').forEach(item => item.classList.remove('active'));
            fileElement.classList.add('active');
            const content = fs.readFileSync(itemPath, 'utf8');

            currentFilePath = itemPath;
            editor.value = content; 
            lastKnownEditorValue = content;
            updatePreview(); 
            updateWordCount(); 
            setDirty(false); 
            updateEditorOverlay();
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
    updatePreview(); setDirty(true); updateEditorOverlay(); editor.focus();
  }
  function insertMarkdownLinkBtn() { insertMarkdownLink(); }

  btnBold && btnBold.addEventListener("click", () => {
    executeAction("Bold", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `**${selected || 'text'}**`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnItalic && btnItalic.addEventListener("click", () => {
    executeAction("Italic", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `*${selected || 'text'}*`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 1, start + 1 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnCode && btnCode.addEventListener("click", () => executeAction("Code block", () => preserveScroll(() => { formatAsCode(); })));
  btnImage && btnImage.addEventListener("click", () => {
    executeAction("Image", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const imageMd = `![alt](${selected || 'url'})`; editor.setRangeText(imageMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 7, start + 10); updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnUl && btnUl.addEventListener("click", () => {
    executeAction("Bullet List", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const listMd = `* ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnOl && btnOl.addEventListener("click", () => {
    executeAction("Numbered List", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const listMd = `1. ${selected || 'elem'}`; editor.setRangeText(listMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnLink && btnLink.addEventListener("click", () => executeAction("Link", () => preserveScroll(() => insertMarkdownLinkBtn())));
  btnHr && btnHr.addEventListener("click", () => {
    executeAction("Horizontal Rule", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; editor.setRangeText("***\n", start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 4, start + 4); updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnUnderline && btnUnderline.addEventListener("click", () => {
    executeAction("Underline", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const text = `<u>${selected || 'text'}</u>`; editor.setRangeText(text, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + 3, start + 3 + (selected ? selected.length : 4));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnQuote && btnQuote.addEventListener("click", () => {
    executeAction("Quote", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd; const selected = editor.value.substring(start, end);
      const quoteMd = `> ${selected || 'quote'}`;
      editor.value = editor.value.substring(0, start) + quoteMd + editor.value.substring(end);
      editor.focus(); editor.setSelectionRange(start + 2, start + 2 + (selected ? selected.length : 5));
      updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });
  btnTable && btnTable.addEventListener("click", () => {
    executeAction("Table", () => { preserveScroll(() => {
      const start = editor.selectionStart; const end = editor.selectionEnd;
      const tableMd = `| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |\n| Cell 3   | Cell 4   |`;
      editor.setRangeText(tableMd, start, end, 'end');
      editor.focus(); editor.setSelectionRange(start + tableMd.length, start + tableMd.length);
      editor.dispatchEvent(new Event('input', { bubbles: true })); updatePreview(); setDirty(true); updateEditorOverlay();
    });
  });
  });

  btnExtra && btnExtra.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownExtra.classList.toggle("open");
    document.getElementById("dropdown-title")?.classList.remove("open");
    document.getElementById("dropdown-options")?.classList.remove("open");
    btnExtra.classList.toggle("active");
  });
  btnTitle && btnTitle.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownTitle.classList.toggle("open");
    document.getElementById("dropdown-extra")?.classList.remove("open");
    document.getElementById("dropdown-options")?.classList.remove("open");
    btnTitle.classList.toggle("active");
  });

  // ===== POP-UP MODAL IMPOSTAZIONI =====
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const modalOverlay = document.getElementById('modal-overlay');
  const inputTabSize = document.getElementById('input-tab-size');
  const inputFontSize = document.getElementById('input-font-size');

  // Sostituiamo il vecchio click del dropdown agganciando l'apertura del Modal centrale
  if (btnOptions) {
    btnOptions.replaceWith(btnOptions.cloneNode(true)); // Rimuove eventuali vecchi listener di disturbo
    const newBtnOptions = document.getElementById("btn-options");
    newBtnOptions.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsModal.classList.remove('hidden');
      dropdownTitle?.classList.remove("open");
      dropdownExtra?.classList.remove("open");
    });
  }

  // Gestione chiusura del Modal
  btnCloseSettings && btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  modalOverlay && modalOverlay.addEventListener('click', () => settingsModal.classList.add('hidden'));

  // Gestione Tema (Chiaro / Scuro) con selettore a tab
  function applyTheme(theme) {
    if (theme === "dark") {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
    localStorage.setItem("mark-theme", theme);

    if (themeBtnLight && themeBtnDark) {
      themeBtnLight.classList.toggle("active", theme === "light");
      themeBtnDark.classList.toggle("active", theme === "dark");
    }
  }

  function applyLanguage(lang) {
    i18n.setLanguage(lang);
    localStorage.setItem("mark.lang", lang);

    const footerLangDisplay = document.getElementById("footer-lang-display");
    if (footerLangDisplay) {
      footerLangDisplay.textContent = lang.toUpperCase();
    }

    if (preview) {
      preview.setAttribute("lang", lang);
    }

    if (langBtnEn && langBtnIt) {
      langBtnEn.classList.toggle("active", lang === "en");
      langBtnIt.classList.toggle("active", lang === "it");
    }

    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      el.textContent = i18n.t(key);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
      const key = el.getAttribute("data-i18n-title");
      el.title = i18n.t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
      const key = el.getAttribute("data-i18n-placeholder");
      el.placeholder = i18n.t(key);
    });

    if (typeof updateWordCount === "function") {
      updateWordCount();
    }

    ipcRenderer.send("app-language-changed", lang);
  }

  themeBtnLight?.addEventListener("click", () => applyTheme("light"));
  themeBtnDark?.addEventListener("click", () => applyTheme("dark"));
  langBtnEn?.addEventListener("click", () => applyLanguage("en"));
  langBtnIt?.addEventListener("click", () => applyLanguage("it"));

  // Inizializza lingua (default inglese) e tema
  applyTheme(localStorage.getItem("mark-theme") || "light");
  applyLanguage(localStorage.getItem("mark.lang") || "en");

  // ===== GESTIONE COLLABORAZIONE (Yjs + WebRTC) =====
  const btnCollab = document.getElementById("btn-collab");
  const collabModal = document.getElementById("collab-modal");
  const btnCloseCollab = document.getElementById("btn-close-collab");
  const collabOverlay = document.getElementById("collab-overlay");

  const collabDisconnectedView = document.getElementById("collab-disconnected-view");
  const collabConnectedView = document.getElementById("collab-connected-view");

  const tabBtnCreate = document.getElementById("tab-btn-create");
  const tabBtnJoin = document.getElementById("tab-btn-join");
  const collabPaneCreate = document.getElementById("collab-pane-create");
  const collabPaneJoin = document.getElementById("collab-pane-join");

  const collabNewRoomId = document.getElementById("collab-new-room-id");
  const btnCollabCopyId = document.getElementById("btn-collab-copy-id");
  const btnCollabRegenId = document.getElementById("btn-collab-regen-id");
  const btnCollabCreate = document.getElementById("btn-collab-create");

  const collabJoinRoomId = document.getElementById("collab-join-room-id");
  const btnCollabJoin = document.getElementById("btn-collab-join");

  const collabUsersCount = document.getElementById("collab-users-count");
  const collabActiveRoomId = document.getElementById("collab-active-room-id");
  const btnCollabCopyActiveId = document.getElementById("btn-collab-copy-active-id");
  const btnCollabLeave = document.getElementById("btn-collab-leave");

  const collabStatusContainer = document.getElementById("collab-status-container");
  const collabStatusText = document.getElementById("collab-status-text");

  function switchCollabTab(tab) {
    if (tab === "create") {
      tabBtnCreate?.classList.add("active");
      tabBtnJoin?.classList.remove("active");
      collabPaneCreate?.classList.remove("hidden");
      collabPaneJoin?.classList.add("hidden");
      if (collabNewRoomId && !collabNewRoomId.value) {
        collabNewRoomId.value = generateRoomId();
      }
    } else {
      tabBtnJoin?.classList.add("active");
      tabBtnCreate?.classList.remove("active");
      collabPaneJoin?.classList.remove("hidden");
      collabPaneCreate?.classList.add("hidden");
      collabJoinRoomId?.focus();
    }
  }

  tabBtnCreate?.addEventListener("click", () => switchCollabTab("create"));
  tabBtnJoin?.addEventListener("click", () => switchCollabTab("join"));

  function updateCollabModalView() {
    const state = getCollabState();
    if (state.isActive) {
      if (collabDisconnectedView) {
        collabDisconnectedView.classList.add("hidden");
        collabDisconnectedView.style.display = "none";
      }
      if (collabConnectedView) {
        collabConnectedView.classList.remove("hidden");
        collabConnectedView.style.display = "flex";
      }
      if (collabActiveRoomId) collabActiveRoomId.value = state.roomId;
      if (collabUsersCount) collabUsersCount.textContent = state.userCount || 1;
    } else {
      if (collabDisconnectedView) {
        collabDisconnectedView.classList.remove("hidden");
        collabDisconnectedView.style.display = "flex";
      }
      if (collabConnectedView) {
        collabConnectedView.classList.add("hidden");
        collabConnectedView.style.display = "none";
      }
      switchCollabTab("create");
    }
  }

  if (btnCollab) {
    btnCollab.addEventListener("click", (e) => {
      e.stopPropagation();
      updateCollabModalView();
      collabModal?.classList.remove("hidden");
      dropdownTitle?.classList.remove("open");
      dropdownExtra?.classList.remove("open");
    });
  }

  btnCloseCollab?.addEventListener("click", () => collabModal?.classList.add("hidden"));
  collabOverlay?.addEventListener("click", () => collabModal?.classList.add("hidden"));

  btnCollabRegenId?.addEventListener("click", () => {
    if (collabNewRoomId) collabNewRoomId.value = generateRoomId();
  });

  function copyTextToClipboard(text) {
    if (clipboard && clipboard.writeText) {
      clipboard.writeText(text);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    showNotification(i18n.t('notif_code_copied'), "info");
  }

  btnCollabCopyId?.addEventListener("click", () => {
    if (collabNewRoomId?.value) copyTextToClipboard(collabNewRoomId.value);
  });

  btnCollabCopyActiveId?.addEventListener("click", () => {
    if (collabActiveRoomId?.value) copyTextToClipboard(collabActiveRoomId.value);
  });

  function handleConnectCollab(roomId, isJoining = false) {
    if (!roomId) {
      showNotification(i18n.t('notif_enter_valid_code'), "error");
      return;
    }

    const session = startCollaboration({
      roomId: roomId,
      editor: editor,
      isJoining: isJoining,
      onRemoteUpdate: () => {
        if (editor) lastKnownEditorValue = editor.value;
        updatePreview();
        updateWordCount();
        updateEditorOverlay();
        setDirty(true);
      },
      onUsersChange: (count) => {
        if (collabUsersCount) collabUsersCount.textContent = count;
        if (collabStatusText) collabStatusText.textContent = `${roomId} · ${count}`;
        if (count > 1) {
          showNotification(i18n.t('notif_participants_connected', { count: count }), "info");
        }
      },
      onStatusChange: (connected) => {
        if (connected) {
          btnCollab?.classList.add("active-collab");
          collabStatusContainer?.classList.remove("hidden");
          const count = getCollabState().userCount || 1;
          if (collabStatusText) collabStatusText.textContent = `${roomId} · ${count}`;
        } else {
          const state = getCollabState();
          if (!state.isActive) {
            btnCollab?.classList.remove("active-collab");
          }
        }
      },
      showNotification: showNotification
    });

    if (session) {
      btnCollab?.classList.add("active-collab");
      collabStatusContainer?.classList.remove("hidden");
      if (collabStatusText) collabStatusText.textContent = `${roomId} · 1`;
      updateCollabModalView();
      collabModal?.classList.add("hidden");
      showNotification(isJoining ? i18n.t('notif_joined_session', { roomId: roomId }) : i18n.t('notif_session_started', { roomId: roomId }), "success");
    }
  }

  btnCollabCreate?.addEventListener("click", () => {
    if (getCollabState().isActive) {
      if (!confirmLeaveCollabIfActive('action_start_new')) {
        return;
      }
    }

    // Assicurati che il file corrente sia salvato sul dispositivo prima di avviare
    if (!currentFilePath || !fs.existsSync(currentFilePath)) {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: [i18n.t('dialog_save_file_and_start'), i18n.t('dialog_cancel')],
        defaultId: 0,
        cancelId: 1,
        title: i18n.t('dialog_save_required_title'),
        message: i18n.t('dialog_save_required_message')
      });
      if (choice !== 0) return;

      const defaultName = 'collaborazione.md';
      const savedPath = dialog.showSaveDialogSync({
        title: i18n.t('dialog_save_collab_title'),
        defaultPath: path.join(currentFolderPath || '', defaultName),
        filters: [{ name: "Markdown", extensions: ["md"] }]
      });

      if (!savedPath) {
        showNotification(i18n.t('notif_start_cancelled_no_save'), "info");
        return;
      }

      try {
        fs.writeFileSync(savedPath, editor?.value || '', 'utf8');
        currentFilePath = savedPath;
        lastKnownEditorValue = editor?.value || '';
        setDirty(false);
        if (currentFolderPath && savedPath.startsWith(currentFolderPath)) {
          openFolder(currentFolderPath);
        }
      } catch (err) {
        console.error('[Collab] Errore salvataggio:', err);
        showNotification(i18n.t('notif_save_error', { msg: err.message }), 'error');
        return;
      }
    } else {
      if (isDirty && typeof saveCurrentFile === 'function') {
        saveCurrentFile();
      }
    }

    const roomId = collabNewRoomId?.value || generateRoomId();
    handleConnectCollab(roomId, false);
  });

  btnCollabJoin?.addEventListener("click", () => {
    const roomId = collabJoinRoomId?.value?.trim();
    if (!roomId) {
      showNotification(i18n.t('notif_enter_valid_code'), "error");
      return;
    }

    if (getCollabState().isActive) {
      if (!confirmLeaveCollabIfActive('action_join_other')) {
        return;
      }
    }

    // Se ci sono modifiche non salvate nel file attuale, chiedi se salvarle
    if (isDirty) {
      const answer = dialog.showMessageBoxSync({
        type: 'question',
        buttons: [i18n.t('dialog_save'), i18n.t('dialog_dont_save'), i18n.t('dialog_cancel')],
        defaultId: 0,
        cancelId: 2,
        title: i18n.t('dialog_unsaved_title'),
        message: i18n.t('dialog_unsaved_message')
      });
      if (answer === 0) {
        saveCurrentFile();
      } else if (answer === 2) {
        return;
      }
    }

    // Chiedi dove salvare localmente il file della sessione prima di entrare nella visualizzazione
    const defaultName = `${roomId}.md`;
    const savePath = dialog.showSaveDialogSync({
      title: i18n.t('dialog_save_session_title'),
      defaultPath: path.join(currentFolderPath || '', defaultName),
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });

    if (!savePath) {
      showNotification(i18n.t('notif_connect_cancelled_no_path'), "info");
      return;
    }

    try {
      fs.writeFileSync(savePath, '', 'utf8');
      currentFilePath = savePath;
      if (editor) {
        editor.value = '';
        lastKnownEditorValue = '';
      }
      setDirty(false);
      updatePreview();
      if (typeof updateWordCount === 'function') updateWordCount();
      if (typeof updateEditorOverlay === 'function') updateEditorOverlay();
      if (currentFolderPath && savePath.startsWith(currentFolderPath)) {
        openFolder(currentFolderPath);
      }
    } catch (err) {
      console.error('[Collab] Errore creazione file sessione:', err);
      showNotification(i18n.t('notif_file_create_error', { msg: err.message }), 'error');
      return;
    }

    handleConnectCollab(roomId, true);
  });

  btnCollabLeave?.addEventListener("click", () => {
    if (currentFilePath && isDirty && typeof saveCurrentFile === 'function') {
      try {
        saveCurrentFile();
      } catch (e) {
        console.error('[Collab] Errore salvataggio chiusura sessione:', e);
      }
    }
    leaveCollaboration();
    btnCollab?.classList.remove("active-collab");
    collabStatusContainer?.classList.add("hidden");
    updateCollabModalView();
    showNotification(i18n.t('notif_session_ended'), "info");
  });

  window.addEventListener('beforeunload', () => {
    if (getCollabState().isActive) {
      if (currentFilePath && isDirty && typeof saveCurrentFile === 'function') {
        try {
          saveCurrentFile();
        } catch (_) {}
      }
      leaveCollaboration();
    }
  });


  // --- Funzione per applicare la dimensione del Font all'editor ---
  function applyEditorFontSize(size) {
    if (editor && overlay) {
      editor.style.fontSize = size + 'px';
      overlay.style.fontSize = size + 'px';
    }
    const preview = document.getElementById('preview');
    if (preview) {
      preview.style.fontSize = size + 'px';
    }
  }

  // --- CARICAMENTO INITIALE DELLE NUOVE IMPOSTAZIONI DA LOCALSTORAGE ---
  const savedTabSize = localStorage.getItem('mark.tabSize') || '4';
  currentTabSize = parseInt(savedTabSize, 10);
  if (inputTabSize) inputTabSize.value = currentTabSize;

  const savedFontSize = localStorage.getItem('mark.fontSize') || '16';
  if (inputFontSize) inputFontSize.value = savedFontSize;
  applyEditorFontSize(savedFontSize);

  // --- ASCOLTATORI DI EVENTI PER IL SALVATAGGIO IN REAL-TIME ---
  if (inputTabSize) {
    inputTabSize.addEventListener('input', function() {
      let val = parseInt(this.value, 10);
      if (isNaN(val) || val < 2) val = 2;
      if (val > 8) val = 8;
      currentTabSize = val;
      localStorage.setItem('mark.tabSize', String(val));
    });
  }

  if (inputFontSize) {
    inputFontSize.value = savedFontSize;
    inputFontSize.addEventListener('input', function() {
      let val = parseInt(this.value, 10);
      if (isNaN(val) || val < 12) val = 12;
      if (val > 24) val = 24;
      localStorage.setItem('mark.fontSize', String(val));
      applyEditorFontSize(val);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const settingsModal = document.getElementById('settings-modal');
      
      // Se il modal delle impostazioni è aperto, lo chiude
      if (settingsModal && !settingsModal.classList.contains('hidden')) {
        settingsModal.classList.add('hidden');
        e.preventDefault(); // Evita che il tasto ESC provochi altri comportamenti nell'editor
      }
    }
  }, true); 
  
  // Handle Title Dropdown Items
  document.querySelectorAll('#dropdown-title .dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent closing immediately if needed, or let it bubble to close?
      // Actually we want to close the dropdown after selection
      dropdownTitle.classList.remove("open");
      btnTitle.classList.remove("active");

      const level = parseInt(item.dataset.level, 10);
      if (!level) return;

      preserveScroll(() => {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const selected = editor.value.substring(start, end);
        const prefix = "#".repeat(level) + " ";
        const text = `${prefix}${selected || 'Title'}`;

        editor.setRangeText(text, start, end, 'end');
        editor.focus();
        // Adjust selection to select the title text (excluding prefix)
        editor.setSelectionRange(start + prefix.length, start + text.length);

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        updatePreview();
        setDirty(true);
        updateEditorOverlay();
      });
    });
  });
  document.addEventListener("click", (e) => {
    if (dropdownExtra && !dropdownExtra.contains(e.target)) { dropdownExtra.classList.remove("open"); btnExtra?.classList.remove("active"); }
    if (dropdownOptions && !dropdownOptions.contains(e.target)) { dropdownOptions.classList.remove("open"); btnOptions?.classList.remove("active"); }
    if (dropdownTitle && !dropdownTitle.contains(e.target)) { dropdownTitle.classList.remove("open"); btnTitle?.classList.remove("active"); }
  });

  function refreshSearchIfOpen() {
    const sc = document.getElementById("search-container");
    if (sc && !sc.classList.contains("hidden")) performSearch(false);
  }

  btnViewEditor && btnViewEditor.addEventListener("click", () => {
    if (container) container.className = "solo-editor";
    refreshSearchIfOpen();
  });

  btnViewSplit && btnViewSplit.addEventListener("click", () => {
    if (container) container.className = "split-view";
    refreshSearchIfOpen();
  });

  btnViewPreview && btnViewPreview.addEventListener("click", () => {
    if (container) container.className = "solo-preview";
    refreshSearchIfOpen();
  });
  // ===== TASK LIST CHECKBOX TOGGLE =====
  if (preview) {
    preview.addEventListener('change', (e) => {
      if (e.target && e.target.classList.contains('task-list-item-checkbox')) {
        const index = parseInt(e.target.dataset.index, 10);
        const isChecked = e.target.checked;
        if (!editor || isNaN(index)) return;

        const newText = toggleTaskInMarkdown(editor.value, index, isChecked);
        const start = editor.selectionStart;
        const end = editor.selectionEnd;

        executeAction("Toggle Checkbox", () => {
          editor.value = newText;
          editor.setSelectionRange(start, end);
          updatePreview();
          setDirty(true);
          if (typeof updateWordCount === 'function') updateWordCount();
          if (typeof updateEditorOverlay === 'function') updateEditorOverlay();
        });
      }
    });
  }

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

// ===== LANGUAGE INITIALIZATION =====
// La lingua è ora gestita globalmente con i18n e sincronizzata nelle impostazioni e nel footer.

// ====== THEME HANDLING FOR HIGHLIGHT.JS ======
window.addEventListener('DOMContentLoaded', () => {
  // Theme handling for highlight.js
  function updateHighlightTheme() {
    const link = document.getElementById('highlight-theme');
    if (link) {
      if (document.body.classList.contains('dark')) {
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css';
      } else {
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
      }
    }
  }

  // Monitor theme changes using MutationObserver on body class
  const observer = new MutationObserver(updateHighlightTheme);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  
  // Set initial theme
  updateHighlightTheme();
});
