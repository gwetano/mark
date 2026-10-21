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
const os = require("os");
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
const { buildExportHtml } = require("./html-export.js");

// ====== UTILS PRECOCI ======
function escapeHtml(s) { 
  if (typeof s !== 'string') return String(s);
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); 
}

// ====== NOTIFICHE POP-UP COERENTI & DISSOLVENZA A NUVOLA AL CLICK ======
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
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else {
    iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  notification.innerHTML = `
    <div class="cloud-notification-icon">${iconSvg}</div>
    <div class="cloud-notification-text">${escapeHtml(message)}</div>
  `;

  container.appendChild(notification);

  let dismissTimer = null;
  let isDismissed = false;

  function dismiss() {
    if (isDismissed) return;
    isDismissed = true;
    clearTimeout(dismissTimer);
    notification.classList.add('cloud-dismiss');
    setTimeout(() => {
      try { notification.remove(); } catch (_) {}
    }, 320);
  }

  function startAutoDismiss() {
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      dismiss();
    }, 4000);
  }

  startAutoDismiss();

  // Sparisce a nuvola semplicemente cliccandoci sopra (senza trascinare)
  notification.addEventListener('click', (e) => {
    e.stopPropagation();
    dismiss();
  });

  notification.addEventListener('mouseenter', () => {
    clearTimeout(dismissTimer);
  });

  notification.addEventListener('mouseleave', () => {
    if (!isDismissed) startAutoDismiss();
  });
}

// ====== STATO ================================================================
let currentFilePath = null;
let isDirty = false;
let currentFolderPath = null;
let isSyncingScroll = false;
let isRenderingPreview = false;
let activeScrollPane = null;
let activeScrollTimer = null;
let userIsScrollingEditor = false;
let userIsScrollingPreview = false;
let scrollTimeoutEditor = null;
let scrollTimeoutPreview = null;
let currentTabSize = 4;

// ====== AUTO-UPDATE =========================================================
let updateProgressNotification = null;

function showOrUpdateDownloadNotification(message) {
  if (updateProgressNotification && document.body.contains(updateProgressNotification)) {
    const textEl = updateProgressNotification.querySelector('.cloud-notification-text');
    if (textEl) {
      textEl.textContent = message;
      return;
    }
  }
  const container = getOrCreateNotificationContainer();
  const notification = document.createElement('div');
  notification.className = 'cloud-notification info';
  const iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  notification.innerHTML = `
    <div class="cloud-notification-icon">${iconSvg}</div>
    <div class="cloud-notification-text">${escapeHtml(message)}</div>
  `;
  container.appendChild(notification);
  updateProgressNotification = notification;
}

ipcRenderer.on('update-available', (event, info) => {
  const versionStr = info?.version ? ` (v${info.version})` : '';
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    title: i18n.t('dialog_update_available_title'),
    message: i18n.t('dialog_update_available_message', { version: versionStr }),
    detail: i18n.t('dialog_update_available_detail'),
    buttons: [
      i18n.t('dialog_update_download_restart'),
      i18n.t('dialog_update_discard')
    ],
    defaultId: 0,
    cancelId: 1
  });

  if (choice === 0) {
    showOrUpdateDownloadNotification(i18n.t('notif_update_downloading'));
    ipcRenderer.send('start-download-update');
  }
});

ipcRenderer.on('update-download-progress', (event, percent) => {
  showOrUpdateDownloadNotification(i18n.t('notif_update_progress', { percent }));
});

ipcRenderer.on('update-downloaded', () => {
  if (updateProgressNotification) {
    try { updateProgressNotification.remove(); } catch (_) {}
    updateProgressNotification = null;
  }
  showNotification(i18n.t('notif_update_downloaded_restarting'), 'success');
  setTimeout(() => {
    ipcRenderer.send('quit-and-install-update');
  }, 1000);
});

ipcRenderer.on('update-error', (event, errorMsg) => {
  if (updateProgressNotification) {
    try { updateProgressNotification.remove(); } catch (_) {}
    updateProgressNotification = null;
  }
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: i18n.t('dialog_update_error_title'),
    message: i18n.t('dialog_update_error_message', { msg: errorMsg }),
    buttons: [
      i18n.t('dialog_update_open_github'),
      i18n.t('dialog_cancel')
    ],
    defaultId: 0,
    cancelId: 1
  });

  if (choice === 0) {
    shell.openExternal('https://github.com/gwetano/mark/releases/latest');
  }
});

// ====== PLATFORM DETECTION & WINDOW CONTROLS ================================
const platform = ipcRenderer.sendSync('get-platform');
const isMac = platform === 'darwin' || (typeof process !== 'undefined' && process.platform === 'darwin');
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
const hljsCache = new Map();
function getCachedHighlightedCode(code, lang) {
  const key = (lang || '') + ':::' + code;
  if (hljsCache.has(key)) return hljsCache.get(key);
  let res = '';
  try {
    if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
      res = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else if (typeof hljs !== 'undefined') {
      res = hljs.highlightAuto(code).value;
    } else {
      res = escapeHtml(code);
    }
  } catch (_) {
    res = escapeHtml(code);
  }
  if (hljsCache.size > 500) hljsCache.clear();
  hljsCache.set(key, res);
  return res;
}

if (typeof marked !== 'undefined' && marked.use) {
  const defaultRenderer = new marked.Renderer();

  function wrapWithSourceLine(fn, checkpointType = '') {
    return function(token) {
      const html = fn.call(this, token);
      if (token && token.sourceLine) {
        const lineCount = (token.raw && typeof token.raw === 'string')
          ? (token.raw.match(/\n/g) || []).length
          : 0;
        const endLine = token.sourceLine + Math.max(0, lineCount);
        const cp = checkpointType ? ` data-checkpoint="${checkpointType}"` : '';
        return html.replace(/^<([a-zA-Z0-9]+)/, `<$1 data-source-line="${token.sourceLine}" data-source-line-end="${endLine}"${cp}`);
      }
      return html;
    };
  }

  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      heading: wrapWithSourceLine(defaultRenderer.heading, 'heading'),
      paragraph: wrapWithSourceLine(defaultRenderer.paragraph, 'paragraph'),
      code(token) {
        const codeText = token.text !== undefined ? token.text : (token.raw || '');
        const lang = (token.lang || '').match(/^\S*/)?.[0] || '';
        const lineCount = (token.raw && typeof token.raw === 'string')
          ? (token.raw.match(/\n/g) || []).length
          : 0;
        const endLine = (token.sourceLine || 1) + Math.max(0, lineCount);
        const line = token && token.sourceLine ? ` data-source-line="${token.sourceLine}" data-source-line-end="${endLine}" data-checkpoint="code"` : '';
        if (lang === 'mermaid') {
          return `<div class="mermaid"${line}>${escapeHtml(codeText)}</div>`;
        }
        const highlighted = getCachedHighlightedCode(codeText, lang);
        return `<pre${line}><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>`;
      },
      blockquote: wrapWithSourceLine(defaultRenderer.blockquote, 'blockquote'),
      list: wrapWithSourceLine(defaultRenderer.list, 'list'),
      listitem: wrapWithSourceLine(defaultRenderer.listitem, 'listitem'),
      table: wrapWithSourceLine(defaultRenderer.table, 'table'),
      hr: wrapWithSourceLine(defaultRenderer.hr, 'hr'),
      html: wrapWithSourceLine(defaultRenderer.html, 'html'),
      image(token) {
        const html = defaultRenderer.image.call(this, token);
        const line = token && token.sourceLine ? ` data-source-line="${token.sourceLine}" data-checkpoint="image"` : '';
        return html.replace(/^<img/, `<img${line}`);
      },
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
  if (!raw.includes('!(') && !raw.includes('![')) return raw;

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
  if (!markdown.includes('$')) return markdown;
  const k = getKatex();
  if (!k) return markdown;

  // 1. Proteggi i blocchi di codice (fenced ``` e ~~~ e inline `...`)
  const codeBlocks = [];
  let protectedMd = markdown.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n\r]+`)/g, (match) => {
    const placeholder = `%%MATH_CODE_BLOCK_${codeBlocks.length}%%`;
    codeBlocks.push(match);
    return placeholder;
  });

  const renderDisplay = (match, math) => {
    const trimmed = math.trim();
    const origNewlines = (match.match(/\n/g) || []).length;
    let html = '';
    try {
      const rendered = k.renderToString(trimmed, {
        displayMode: true,
        throwOnError: false,
        trust: true,
        macros: { "\\eqref": "\\href{#1}{}" }
      });
      html = `<div class="katex-display-container">${rendered}</div>`;
    } catch (err) {
      html = `<div class="katex-display-container katex-error">${escapeHtml(trimmed)}</div>`;
    }
    const htmlNewlines = (html.match(/\n/g) || []).length;
    const diff = origNewlines - htmlNewlines;
    return diff > 0 ? html + '\n'.repeat(diff) : html;
  };

  const renderInline = (match, math) => {
    const trimmed = math.trim();
    const origNewlines = (match.match(/\n/g) || []).length;
    let html = '';
    try {
      const rendered = k.renderToString(trimmed, {
        displayMode: false,
        throwOnError: false,
        trust: true,
        macros: { "\\eqref": "\\href{#1}{}" }
      });
      html = `<span class="katex-inline-container">${rendered}</span>`;
    } catch (err) {
      html = `<span class="katex-inline-container katex-error">${escapeHtml(trimmed)}</span>`;
    }
    const htmlNewlines = (html.match(/\n/g) || []).length;
    const diff = origNewlines - htmlNewlines;
    return diff > 0 ? html + '\n'.repeat(diff) : html;
  };

  // 2. Display math: $$...$$ e \[...\]
  protectedMd = protectedMd.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => renderDisplay(match, math));
  protectedMd = protectedMd.replace(/\\\[([\s\S]+?)\\\]/g, (match, math) => renderDisplay(match, math));

  // 3. Inline math: \(...\) e $...$
  protectedMd = protectedMd.replace(/\\\(([\s\S]+?)\\\)/g, (match, math) => renderInline(match, math));
  protectedMd = protectedMd.replace(/(^|[^\\])\$([^\s\$](?:[^\$\n\r]*?[^\s\$\\ ])?)\$/g, (match, prefix, math) => {
    return prefix + renderInline(match, math);
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
    if (overlay.innerHTML !== '') overlay.innerHTML = '';
    return;
  }
  const sc = document.getElementById("search-container");
  const isSearchOpen = sc && !sc.classList.contains("hidden");
  if (!isSearchOpen || searchMatches.length === 0) {
    if (overlay.innerHTML !== '') overlay.innerHTML = '';
    return;
  }
  const text = editor.value;
  let html = '';
  let lastIndex = 0;
  searchMatches.forEach((match, i) => {
    html += escapeHtml(text.substring(lastIndex, match.start));
    const matchText = text.substring(match.start, match.end);
    const activeClass = (i === currentMatchIndex) ? ' active' : '';
    html += `<span class="search-highlight${activeClass}" id="search-match-${i}">${escapeHtml(matchText)}</span>`;
    lastIndex = match.end;
  });
  html += escapeHtml(text.substring(lastIndex));
  if (text.endsWith('\n')) html += '<br>';
  overlay.innerHTML = html;
}

function clearSearchHighlights() {
  searchMatches = [];
  previewSearchMatches = [];
  currentMatchIndex = -1;
  updateSearchResultsCounter();
  
  const overlay = document.getElementById('editor-overlay');
  if (overlay) overlay.innerHTML = '';
  
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

  // Caret / selection tracking for drag & drop file insertion
  let editorHasUserCursor = false;
  let editorUserCaret = null;

  function updateEditorCaretTracking() {
    if (!editor) return;
    editorHasUserCursor = true;
    editorUserCaret = {
      start: editor.selectionStart,
      end: editor.selectionEnd
    };
  }

  if (editor) {
    editor.addEventListener('click', updateEditorCaretTracking);
    editor.addEventListener('keyup', updateEditorCaretTracking);
    editor.addEventListener('select', updateEditorCaretTracking);
    editor.addEventListener('pointerdown', updateEditorCaretTracking);
    editor.addEventListener('input', updateEditorCaretTracking);
  }
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
  
  // TABS & EMPTY STATE DOM
  const tabsBar = document.getElementById("tabs-bar");
  const tabsScrollArea = document.getElementById("tabs-scroll-area");
  const btnNewTab = document.getElementById("btn-new-tab");
  const emptyState = document.getElementById("empty-state");
  const emptyBtnNewFile = document.getElementById("empty-btn-new-file");
  const emptyBtnOpenFile = document.getElementById("empty-btn-open-file");
  const emptyBtnOpenFolder = document.getElementById("empty-btn-open-folder");

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
      if (typeof stopTypewriterEffect === 'function') stopTypewriterEffect();
      if (viewContainer) previousViewClass = viewContainer.className || "split-view";
      if (navbar) navbar.classList.add('reading-mode-active');
      if (footer) footer.style.display = 'none';
      if (explorerPanel) explorerPanel.classList.add('hidden');
      if (explorerResizer) explorerResizer.classList.add('hidden');
      if (tabsBar) tabsBar.classList.add('hidden');
      if (emptyState) emptyState.classList.add('hidden');
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
      if (tabsBar && tabs.length > 0) tabsBar.classList.remove('hidden');
      if (emptyState && tabs.length === 0) emptyState.classList.remove('hidden');
      if (viewContainer) viewContainer.className = previousViewClass;
      if (appContainer) {
        appContainer.style.marginTop = '55px';
        appContainer.style.marginBottom = '35px';
        appContainer.style.height = 'calc(100% - 55px - 35px)';
      }
      refreshSearchIfOpen();
      if (editor && editor.value.length === 0 && typeof startTypewriterEffect === 'function') {
        startTypewriterEffect();
      }
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
          if (typeof openFileInTab === 'function') {
            openFileInTab(fullPath, '');
          }
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
  collapseAllBtn && collapseAllBtn.addEventListener("click", () => collapseAllFolders());
  refreshExplorerBtn && refreshExplorerBtn.addEventListener("click", () => { if (currentFolderPath) openFolder(currentFolderPath); });

  // ===== WORD COUNT =====
  const updateWordCount = () => {
    if (!wordCountEl || !editor) return;
    const text = editor.value;
    if (!text) {
      wordCountEl.textContent = i18n.t('word_count', { count: 0 });
      return;
    }
    const words = text.match(/\b[\p{L}\p{N}_]{2,}\b/gu);
    wordCountEl.textContent = i18n.t('word_count', { count: words ? words.length : 0 });
  };

  // ===== DIRTY FLAG =====
  const setDirty = (dirty) => {
    isDirty = dirty;
    if (title) title.textContent = "";
    const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    if (activeTab) {
      activeTab.isDirty = dirty;
      if (typeof updateTabDirtyIndicator === 'function') {
        updateTabDirtyIndicator(activeTab.id, dirty);
      }
    }
  };

  // ====== CALLOUT / ALERT BLOCKQUOTES & COLOR PICKER ======
  const CALLOUT_REGEX = /^\s*\[!\s*([A-Za-z0-9_\-]+(?:\s+[A-Za-z0-9_\-]+)*)\s*(?::)?\s*(?:#([0-9a-fA-F]{3,8}))?\s*\](?:\s*<br\s*\/?>)?/i;

  function getCalloutColor(tagName, hex) {
    if (hex) {
      return hex.startsWith('#') ? hex : '#' + hex;
    }
    const norm = (tagName || '').trim().toUpperCase();
    if (['IMPORTANT', 'CAUTION', 'ERROR', 'DANGER'].includes(norm)) {
      return '#ef4444'; // Rosso (Default Important)
    }
    if (['WARNING', 'ATTENTION'].includes(norm)) {
      return '#f59e0b'; // Giallo / Amber (Default Warning)
    }
    // Altro verde di default come richiesto dall'utente
    return '#10b981'; // Verde (Default Note, Tip, etc.)
  }

  function getCalloutIconSvg(tagName) {
    const norm = (tagName || '').trim().toUpperCase();
    if (['IMPORTANT', 'CAUTION', 'ERROR', 'DANGER'].includes(norm)) {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }
    if (['WARNING', 'ATTENTION'].includes(norm)) {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    }
    if (['TIP', 'IDEA'].includes(norm)) {
      return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path></svg>`;
    }
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  function hexToRgba(hex, alpha = 1) {
    if (!hex) return `rgba(16, 185, 129, ${alpha})`;
    let c = hex.replace('#', '').trim();
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    if (isNaN(num)) return `rgba(16, 185, 129, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function processCalloutAlerts(container) {
    if (!container) return;
    const blockquotes = container.querySelectorAll('blockquote');
    let calloutIndex = 0;

    blockquotes.forEach(bq => {
      const firstP = bq.querySelector('p');
      if (!firstP) return;

      const text = firstP.innerHTML;
      const match = text.match(CALLOUT_REGEX);
      if (!match) return;

      const fullTag = match[0];
      const tagName = match[1].trim();
      const colorHex = match[2];

      const color = getCalloutColor(tagName, colorHex);
      const iconSvg = getCalloutIconSvg(tagName);

      firstP.innerHTML = firstP.innerHTML.slice(fullTag.length).trim();
      if (!firstP.innerHTML || firstP.innerHTML === '<br>' || firstP.innerHTML === '<br/>') {
        firstP.remove();
      }

      bq.classList.add('callout-alert');
      bq.dataset.calloutTag = tagName;
      bq.dataset.calloutColor = color;
      bq.dataset.calloutIndex = String(calloutIndex);

      bq.style.setProperty('--callout-color', color);
      bq.style.setProperty('--callout-bg', hexToRgba(color, 0.05));
      bq.style.setProperty('--callout-bg-hover', hexToRgba(color, 0.09));
      bq.style.setProperty('--callout-border', hexToRgba(color, 0.22));
      bq.style.borderLeftColor = color;

      const contentDiv = document.createElement('div');
      contentDiv.className = 'callout-content';
      while (bq.firstChild) {
        contentDiv.appendChild(bq.firstChild);
      }

      const headerDiv = document.createElement('div');
      headerDiv.className = 'callout-header';
      headerDiv.style.color = color;
      headerDiv.setAttribute('title', i18n.t('callout_click_color') || 'Clicca per scegliere il colore');
      headerDiv.innerHTML = `
        <span class="callout-icon">${iconSvg}</span>
        <span class="callout-title">${escapeHtml(tagName)}</span>
        <button type="button" class="callout-color-btn" title="${escapeHtml(i18n.t('callout_click_color') || 'Cambia colore')}">
          <span class="callout-color-preview" style="background-color: ${color};"></span>
          <svg class="callout-color-palette-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>
        </button>
      `;

      bq.appendChild(headerDiv);
      bq.appendChild(contentDiv);

      calloutIndex++;
    });
  }

  let currentCalloutPicker = null;

  function closeCalloutColorPicker() {
    if (currentCalloutPicker) {
      try { currentCalloutPicker.remove(); } catch (_) {}
      currentCalloutPicker = null;
    }
  }

  function openCalloutColorPicker(blockquote, event) {
    closeCalloutColorPicker();

    const calloutIndex = parseInt(blockquote.dataset.calloutIndex, 10);
    const currentColor = blockquote.dataset.calloutColor || '#10b981';
    const currentTag = blockquote.dataset.calloutTag || 'NOTE';
    const defaultColor = getCalloutColor(currentTag, null);

    const popover = document.createElement('div');
    popover.id = 'callout-picker-popover';

    const presets = [
      { color: '#ef4444', name: 'Rosso' },
      { color: '#f97316', name: 'Arancione' },
      { color: '#f59e0b', name: 'Giallo' },
      { color: '#10b981', name: 'Verde' },
      { color: '#007acc', name: 'Azzurro' },
      { color: '#8b5cf6', name: 'Viola' },
      { color: '#ec4899', name: 'Rosa' },
      { color: '#64748b', name: 'Ardesia' }
    ];

    const swatchesHtml = presets.map(p => {
      const isActive = p.color.toLowerCase() === currentColor.toLowerCase() ? ' active' : '';
      return `<button type="button" class="callout-swatch${isActive}" data-color="${p.color}" title="${p.name} (${p.color})" style="background-color: ${p.color};"></button>`;
    }).join('');

    popover.innerHTML = `
      <div class="callout-picker-header">
        <div class="callout-picker-title">
          <span class="callout-picker-badge" style="background-color: ${currentColor};"></span>
          <span>${escapeHtml(currentTag)}</span>
        </div>
        <button type="button" class="callout-picker-close-btn" title="Chiudi">×</button>
      </div>
      
      <div class="callout-picker-section-label">${escapeHtml(i18n.t('callout_presets') || 'Predefiniti')}</div>
      <div class="callout-picker-swatches">
        ${swatchesHtml}
      </div>

      <div class="callout-picker-section-label">${escapeHtml(i18n.t('callout_custom') || 'Personalizzato')}</div>
      <div class="callout-picker-custom-row">
        <input type="color" class="callout-picker-color-input" value="${currentColor}">
        <input type="text" class="callout-picker-hex-input" value="${currentColor}" maxlength="7" spellcheck="false">
        <button type="button" class="callout-picker-apply-btn">OK</button>
      </div>

      <div class="callout-picker-footer">
        <button type="button" class="callout-picker-reset-btn" title="Ripristina colore di default (${defaultColor})">
          ↺ ${escapeHtml(i18n.t('callout_default') || 'Default')}
        </button>
      </div>
    `;

    document.body.appendChild(popover);
    currentCalloutPicker = popover;

    let top = event.clientY + 12;
    let left = event.clientX - 50;

    const popWidth = 250;
    const popHeight = 220;
    if (left + popWidth > window.innerWidth - 16) {
      left = window.innerWidth - popWidth - 16;
    }
    if (left < 16) left = 16;

    if (top + popHeight > window.innerHeight - 16) {
      top = Math.max(16, event.clientY - popHeight - 12);
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;

    const closeBtn = popover.querySelector('.callout-picker-close-btn');
    closeBtn?.addEventListener('click', () => closeCalloutColorPicker());

    popover.querySelectorAll('.callout-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.color;
        closeCalloutColorPicker();
        updateCalloutColorInEditor(calloutIndex, chosen);
      });
    });

    const colorInput = popover.querySelector('.callout-picker-color-input');
    const hexInput = popover.querySelector('.callout-picker-hex-input');
    const applyBtn = popover.querySelector('.callout-picker-apply-btn');

    if (colorInput && hexInput) {
      colorInput.addEventListener('input', () => {
        hexInput.value = colorInput.value;
        const badge = popover.querySelector('.callout-picker-badge');
        if (badge) badge.style.backgroundColor = colorInput.value;
      });

      hexInput.addEventListener('input', () => {
        let val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{6}$/i.test(val)) {
          colorInput.value = val;
          const badge = popover.querySelector('.callout-picker-badge');
          if (badge) badge.style.backgroundColor = val;
        }
      });

      const applyCustom = () => {
        let val = hexInput.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9a-fA-F]{3,8}$/i.test(val)) {
          closeCalloutColorPicker();
          updateCalloutColorInEditor(calloutIndex, val);
        }
      };

      applyBtn?.addEventListener('click', applyCustom);
      hexInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustom();
        }
      });
    }

    const resetBtn = popover.querySelector('.callout-picker-reset-btn');
    resetBtn?.addEventListener('click', () => {
      closeCalloutColorPicker();
      updateCalloutColorInEditor(calloutIndex, null);
    });

    const onDocClick = (e) => {
      if (popover && !popover.contains(e.target) && !blockquote.contains(e.target)) {
        closeCalloutColorPicker();
        document.removeEventListener('pointerdown', onDocClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', onDocClick);
    }, 10);
  }

  function updateCalloutColorInEditor(calloutIndex, newColorHex) {
    if (!editor) return;

    const regex = /\[!\s*([A-Za-z0-9_\-]+(?:\s+[A-Za-z0-9_\-]+)*)\s*(?::)?\s*(?:#([0-9a-fA-F]{3,8}))?\s*\]/g;
    let match;
    let currentIndex = 0;
    let found = null;

    while ((match = regex.exec(editor.value)) !== null) {
      if (currentIndex === calloutIndex) {
        found = {
          start: match.index,
          end: match.index + match[0].length,
          tagName: match[1].trim(),
          fullMatch: match[0]
        };
        break;
      }
      currentIndex++;
    }

    if (!found) return;

    let newTagStr;
    if (newColorHex) {
      const cleanHex = newColorHex.startsWith('#') ? newColorHex : '#' + newColorHex;
      newTagStr = `[!${found.tagName} ${cleanHex}]`;
    } else {
      newTagStr = `[!${found.tagName}]`;
    }

    const before = editor.value.substring(0, found.start);
    const after = editor.value.substring(found.end);
    const selStart = editor.selectionStart;
    const selEnd = editor.selectionEnd;

    executeAction("Change Callout Color", () => {
      editor.value = before + newTagStr + after;
      try {
        editor.setSelectionRange(selStart, selEnd);
      } catch (_) {}
      updatePreview();
      setDirty(true);
    });

    const colorMsg = newColorHex ? (newColorHex.startsWith('#') ? newColorHex : '#' + newColorHex) : (i18n.t('callout_default') || 'Default');
  }

  function attachCalloutInteractivity(container) {
    if (!container) return;
    const callouts = container.querySelectorAll('blockquote.callout-alert');
    callouts.forEach(bq => {
      bq.addEventListener('mousemove', (e) => {
        const rect = bq.getBoundingClientRect();
        const isLateral = (e.clientX - rect.left) <= 24;
        if (isLateral) {
          bq.style.cursor = 'pointer';
          bq.setAttribute('title', i18n.t('callout_click_color') || 'Clicca per scegliere il colore');
        } else {
          bq.style.cursor = 'default';
          if (!e.target.closest('.callout-header')) {
            bq.removeAttribute('title');
          }
        }
      });

      bq.addEventListener('click', (e) => {
        const rect = bq.getBoundingClientRect();
        const isLateral = (e.clientX - rect.left) <= 24;
        const isHeader = e.target.closest('.callout-header');
        const isBtn = e.target.closest('.callout-color-btn');

        if (isLateral || isHeader || isBtn) {
          e.preventDefault();
          e.stopPropagation();
          openCalloutColorPicker(bq, e);
        }
      });
    });
  }

  // ===== PREVIEW RENDER (con include) =====
  function updatePreview() {
    if (!editor || !preview) return;

    const rawOriginal = editor.value;
    let raw = preprocessCodeIncludes(rawOriginal);
    raw = processMath(raw);

    checkboxCount = 0;

    // Capture current scroll state
    const currentScrollTop = preview.scrollTop;
    isRenderingPreview = true;

    const tokens = marked.lexer(raw);
    function assignSourceLines(tokenList, startLine) {
      let line = startLine;
      for (const t of tokenList) {
        t.sourceLine = line;
        if (t.items) {
          let itemLine = line;
          for (const item of t.items) {
            item.sourceLine = itemLine;
            if (item.tokens) {
              assignSourceLines(item.tokens, itemLine);
            }
            itemLine += (item.raw.match(/\n/g) || []).length;
          }
        } else if (t.tokens) {
          let subLine = line;
          for (const sub of t.tokens) {
            sub.sourceLine = subLine;
            if (sub.tokens) {
              assignSourceLines(sub.tokens, subLine);
            }
            subLine += (sub.raw && typeof sub.raw === 'string' ? (sub.raw.match(/\n/g) || []).length : 0);
          }
        }
        line += (t.raw.match(/\n/g) || []).length;
      }
      return line;
    }
    assignSourceLines(tokens, 1);

    let html = marked.parser(tokens);

    preview.innerHTML = html;
    processCalloutAlerts(preview);

    const imgs = preview.querySelectorAll('img');
    if (imgs.length > 0) {
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

        if (!img.complete) {
          img.addEventListener('load', () => {
            scrollMapNeedsRebuild = true;
          }, { once: true });
        }
      });
    }

    // Restore preview scroll position steadily without jumping
    preview.scrollTop = currentScrollTop;

    scrollMapNeedsRebuild = true;
    requestAnimationFrame(() => {
      isRenderingPreview = false;
    });

    const CODE_COPY_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
    const CODE_CHECK_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;

    const pres = preview.querySelectorAll('pre');
    if (pres.length > 0) {
      pres.forEach(pre => {
        const codeBlock = pre.querySelector('code');
        if (!codeBlock || pre.querySelector('.code-copy-btn')) return;
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.setAttribute('title', 'Copia codice');
        copyBtn.setAttribute('type', 'button');
        copyBtn.innerHTML = CODE_COPY_ICON;
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = codeBlock.textContent;
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.innerHTML = CODE_CHECK_ICON;
            copyBtn.classList.add('copied');
            setTimeout(() => {
              copyBtn.innerHTML = CODE_COPY_ICON;
              copyBtn.classList.remove('copied');
            }, 2000);
          }).catch(err => console.error('Errore copia codice:', err));
        });
        pre.appendChild(copyBtn);
      });
    }

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

    if (typeof buildScrollMap === 'function') {
      buildScrollMap();
    }

    // Callout interactive listeners
    attachCalloutInteractivity(preview);
    
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
    if (isTypewriterActive) {
      const isModifierOnly = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key);
      if (!isModifierOnly) {
        stopTypewriterEffect();
      }
    }

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
    const isMod = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
    if (isMod && !e.altKey) {
      const start = editor.selectionStart, end = editor.selectionEnd;
      const selected = editor.value.substring(start, end);
      const before = editor.value.substring(0, start), after = editor.value.substring(end);
      let formatted = null;
      let actionName = "Formatting Shortcut";
      let cursorStart = start;
      let cursorEnd = end;

      switch (e.key) {
        case "1":
          formatted = `# ${selected}`;
          actionName = "Heading 1";
          cursorStart = start;
          cursorEnd = start + formatted.length;
          break;
        case "2":
          formatted = `## ${selected}`;
          actionName = "Heading 2";
          cursorStart = start;
          cursorEnd = start + formatted.length;
          break;
        case "3":
          formatted = `### ${selected}`;
          actionName = "Heading 3";
          cursorStart = start;
          cursorEnd = start + formatted.length;
          break;
        case "b": case "B":
          if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
            formatted = selected.slice(2, -2);
            actionName = "Remove Bold";
            cursorStart = start;
            cursorEnd = start + formatted.length;
          } else {
            formatted = `**${selected}**`;
            actionName = "Bold";
            cursorStart = selected ? start + 2 : start + 2;
            cursorEnd = selected ? end + 2 : start + 2;
          }
          break;
        case "i": case "I":
          if (selected.startsWith('*') && selected.endsWith('*') && selected.length >= 2 && !selected.startsWith('**')) {
            formatted = selected.slice(1, -1);
            actionName = "Remove Italic";
            cursorStart = start;
            cursorEnd = start + formatted.length;
          } else {
            formatted = `*${selected}*`;
            actionName = "Italic";
            cursorStart = selected ? start + 1 : start + 1;
            cursorEnd = selected ? end + 1 : start + 1;
          }
          break;
        case "u": case "U":
          if (selected.startsWith('<u>') && selected.endsWith('</u>') && selected.length >= 7) {
            formatted = selected.slice(3, -4);
            actionName = "Remove Underline";
            cursorStart = start;
            cursorEnd = start + formatted.length;
          } else {
            formatted = `<u>${selected}</u>`;
            actionName = "Underline";
            cursorStart = selected ? start + 3 : start + 3;
            cursorEnd = selected ? end + 3 : start + 3;
          }
          break;
        case "e": case "E":
        case "h": case "H":
        case "`":
          e.preventDefault();
          executeAction("Code", () => {
            formatAsCode();
          });
          return;
      }

      if (formatted !== null) {
        e.preventDefault();
        executeAction(actionName, () => {
          editor.value = before + formatted + after;
          editor.selectionStart = cursorStart;
          editor.selectionEnd = cursorEnd;
          updatePreview(); setDirty(true); updateEditorOverlay();
        });
        return;
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

  // ===== Caret Coordinates & Obsidian-Style Centered Writing =====
  let caretMirror = null;
  let caretMirrorMarker = null;

  function ensureCaretMirror() {
    if (!caretMirror) {
      caretMirror = document.getElementById('caret-mirror');
      if (!caretMirror) {
        caretMirror = document.createElement('div');
        caretMirror.id = 'caret-mirror';
        document.body.appendChild(caretMirror);
      }
    }
    if (!caretMirrorMarker) {
      caretMirrorMarker = document.createElement('span');
      caretMirrorMarker.textContent = '\u200b';
    }
  }

  function syncCaretMirrorStyles(element) {
    ensureCaretMirror();
    const styles = window.getComputedStyle(element);
    caretMirror.style.width = element.clientWidth + 'px';
    caretMirror.style.boxSizing = styles.boxSizing;
    caretMirror.style.fontFamily = styles.fontFamily;
    caretMirror.style.fontSize = styles.fontSize;
    caretMirror.style.fontWeight = styles.fontWeight;
    caretMirror.style.fontStyle = styles.fontStyle;
    caretMirror.style.letterSpacing = styles.letterSpacing;
    caretMirror.style.lineHeight = styles.lineHeight;
    caretMirror.style.paddingTop = styles.paddingTop;
    caretMirror.style.paddingBottom = styles.paddingBottom;
    caretMirror.style.paddingLeft = styles.paddingLeft;
    caretMirror.style.paddingRight = styles.paddingRight;
    caretMirror.style.borderTopWidth = styles.borderTopWidth;
    caretMirror.style.borderLeftWidth = styles.borderLeftWidth;
    caretMirror.style.tabSize = styles.tabSize || '4';
    return {
      lineHeight: parseFloat(styles.lineHeight) || 25.6,
      paddingTop: parseFloat(styles.paddingTop) || 20
    };
  }

  function getCaretCoordinates(element, position, defaultLineHeight = 25.6) {
    ensureCaretMirror();
    const safePos = Math.max(0, Math.min(position, element.value.length));
    const text = element.value.substring(0, safePos);
    caretMirror.textContent = text;
    caretMirror.appendChild(caretMirrorMarker);

    const top = caretMirrorMarker.offsetTop;
    const height = caretMirrorMarker.offsetHeight || defaultLineHeight;

    return { top, height };
  }

  // ===== Synchronized Scroll Map (Block by Block & Line by Line) =====
  let syncBlocks = [];
  let scrollMapNeedsRebuild = true;

  function buildScrollMap() {
    if (!editor || !preview) return;
    const container = document.getElementById("container");
    if (container && container.classList.contains("solo-editor")) {
      scrollMapNeedsRebuild = true;
      return;
    }

    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = preview.scrollHeight - preview.clientHeight;

    if (editorMax <= 0 || previewMax <= 0) {
      syncBlocks = [];
      scrollMapNeedsRebuild = false;
      return;
    }

    const elements = preview.querySelectorAll('[data-source-line], img, .katex-display-container');
    const text = editor.value;
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        lineStarts.push(i + 1);
      }
    }

    const { lineHeight: defaultLineHeight, paddingTop } = syncCaretMirrorStyles(editor);
    const previewRect = preview.getBoundingClientRect();
    const previewScrollTop = preview.scrollTop;

    // Misura il fondo del contenuto testuale dell'editor
    const lastCoord = getCaretCoordinates(editor, text.length, defaultLineHeight);
    const lastEditorContentY = Math.max(0, lastCoord.top - paddingTop);
    const editorContentBottom = Math.max(1, lastEditorContentY + (lastCoord.height || defaultLineHeight));

    // Misura il fondo del contenuto renderizzato del preview
    let previewContentBottom = 0;
    const allPreviewChildren = preview.children;
    if (allPreviewChildren.length > 0) {
      const lastChild = allPreviewChildren[allPreviewChildren.length - 1];
      const lcRect = lastChild.getBoundingClientRect();
      previewContentBottom = Math.max(1, lcRect.bottom - previewRect.top + previewScrollTop - paddingTop);
    } else {
      previewContentBottom = Math.max(1, preview.scrollHeight - paddingTop);
    }

    const rawPoints = [];

    // Punto iniziale garantito: (0, 0)
    rawPoints.push({
      editorTop: 0,
      previewTop: 0
    });

    // Campiona gli elementi su documenti molto lunghi mantenendo sempre i checkpoint significativi
    let sampledElements = elements;
    if (elements.length > 60) {
      const step = Math.ceil(elements.length / 45);
      sampledElements = [];
      elements.forEach((el, idx) => {
        const cp = el.getAttribute('data-checkpoint');
        if (cp === 'heading' || cp === 'image' || cp === 'table' || el.tagName.toLowerCase() === 'img' || el.classList.contains('katex-display-container')) {
          sampledElements.push(el);
        } else if (idx % step === 0 || idx === elements.length - 1) {
          sampledElements.push(el);
        }
      });
    }

    sampledElements.forEach(el => {
      let lineStart = null;
      const lineAttr = el.getAttribute('data-source-line');
      if (lineAttr) {
        lineStart = parseInt(lineAttr, 10);
      } else if (el.tagName.toLowerCase() === 'img') {
        const parentLine = el.closest('[data-source-line]')?.getAttribute('data-source-line');
        if (parentLine) lineStart = parseInt(parentLine, 10);
      } else if (el.classList.contains('katex-display-container')) {
        const parentLine = el.closest('[data-source-line]')?.getAttribute('data-source-line');
        if (parentLine) lineStart = parseInt(parentLine, 10);
      }
      if (!lineStart || isNaN(lineStart) || lineStart < 1) return;

      const charIndex = lineStarts[lineStart - 1] !== undefined ? lineStarts[lineStart - 1] : text.length;
      const coord = getCaretCoordinates(editor, charIndex, defaultLineHeight);
      const elRect = el.getBoundingClientRect();
      const pTop = elRect.top - previewRect.top + previewScrollTop;
      const pBottom = elRect.bottom - previewRect.top + previewScrollTop;

      const ye = Math.max(0, coord.top - paddingTop);
      const yp = Math.max(0, pTop - paddingTop);

      rawPoints.push({
        editorTop: ye,
        previewTop: yp
      });

      // Special Checkpoint: Immagine e testo subito sotto l'immagine
      if (el.tagName.toLowerCase() === 'img') {
        let nextTextLine = lineStart + 1;
        while (nextTextLine <= lineStarts.length) {
          const sIdx = lineStarts[nextTextLine - 1];
          const eIdx = lineStarts[nextTextLine] !== undefined ? lineStarts[nextTextLine] - 1 : text.length;
          const lineStr = text.substring(sIdx, eIdx).trim();
          if (lineStr.length > 0) break;
          nextTextLine++;
        }
        if (nextTextLine <= lineStarts.length) {
          const charIndexNext = lineStarts[nextTextLine - 1];
          const coordNext = getCaretCoordinates(editor, charIndexNext, defaultLineHeight);
          rawPoints.push({
            editorTop: Math.max(0, coordNext.top - paddingTop),
            previewTop: Math.max(0, pBottom - paddingTop)
          });
        }
      }

      // Checkpoint per fine blocco multiriga (code blocks, tabelle, citazioni, paragrafi estesi)
      const lineEndAttr = el.getAttribute('data-source-line-end');
      if (lineEndAttr && el.tagName.toLowerCase() !== 'img') {
        const lineEnd = parseInt(lineEndAttr, 10);
        if (!isNaN(lineEnd) && lineEnd > lineStart && pBottom > pTop + 20) {
          const charIndexEnd = lineStarts[lineEnd - 1] !== undefined ? lineStarts[lineEnd - 1] : text.length;
          const coordEnd = getCaretCoordinates(editor, charIndexEnd, defaultLineHeight);
          rawPoints.push({
            editorTop: Math.max(0, coordEnd.top + (coordEnd.height || defaultLineHeight) - paddingTop),
            previewTop: Math.max(0, pBottom - paddingTop)
          });
        }
      }
    });

    // Checkpoint per la fine del contenuto testuale (prima dello spazio bianco)
    rawPoints.push({
      editorTop: editorContentBottom,
      previewTop: previewContentBottom
    });

    // Checkpoint per il fondo corsa massimo dello spazio bianco
    rawPoints.push({
      editorTop: editorMax,
      previewTop: previewMax
    });

    // Ordina tutti i punti
    rawPoints.sort((a, b) => a.editorTop - b.editorTop || a.previewTop - b.previewTop);

    // Filtra per garantire stretta monotonia crescente senza superare editorMax o previewMax
    const cleaned = [];
    let lastEditorTop = -1;
    let lastPreviewTop = -1;

    for (const b of rawPoints) {
      if (b.editorTop >= editorMax || b.previewTop >= previewMax) {
        continue;
      }
      if (b.editorTop > lastEditorTop && b.previewTop > lastPreviewTop) {
        cleaned.push(b);
        lastEditorTop = b.editorTop;
        lastPreviewTop = b.previewTop;
      }
    }

    // Aggiungi SEMPRE come punto terminale assoluto (editorMax, previewMax)
    cleaned.push({
      editorTop: editorMax,
      previewTop: previewMax
    });

    syncBlocks = cleaned;
    scrollMapNeedsRebuild = false;
  }

  function getPreviewScrollForEditor(editorScrollTop) {
    if (!editor || !preview) return 0;
    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = preview.scrollHeight - preview.clientHeight;
    if (editorMax <= 0 || previewMax <= 0) return 0;

    if (syncBlocks.length < 2) {
      return (editorScrollTop / editorMax) * previewMax;
    }

    if (editorScrollTop <= 0.5) return 0;
    if (editorScrollTop >= editorMax - 0.5) return previewMax;

    let low = 0;
    let high = syncBlocks.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (syncBlocks[mid].editorTop <= editorScrollTop) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const prev = syncBlocks[high];
    const next = syncBlocks[low];
    if (!prev || !next) return prev ? prev.previewTop : 0;

    const range = next.editorTop - prev.editorTop;
    if (range <= 0) return prev.previewTop;

    const progress = (editorScrollTop - prev.editorTop) / range;
    return prev.previewTop + progress * (next.previewTop - prev.previewTop);
  }

  function getEditorScrollForPreview(previewScrollTop) {
    if (!editor || !preview) return 0;
    const editorMax = editor.scrollHeight - editor.clientHeight;
    const previewMax = preview.scrollHeight - preview.clientHeight;
    if (editorMax <= 0 || previewMax <= 0) return 0;

    if (syncBlocks.length < 2) {
      return (previewScrollTop / previewMax) * editorMax;
    }

    if (previewScrollTop <= 0.5) return 0;
    if (previewScrollTop >= previewMax - 0.5) return editorMax;

    let low = 0;
    let high = syncBlocks.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (syncBlocks[mid].previewTop <= previewScrollTop) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const prev = syncBlocks[high];
    const next = syncBlocks[low];
    if (!prev || !next) return prev ? prev.editorTop : 0;

    const range = next.previewTop - prev.previewTop;
    if (range <= 0) return prev.editorTop;

    const progress = (previewScrollTop - prev.previewTop) / range;
    return prev.editorTop + progress * (next.editorTop - prev.editorTop);
  }

  // ===== Autoscroll Sync =====
  let autoscrollEnabled = true;
  const savedAutoscroll = localStorage.getItem('autoscrollEnabled');
  if (savedAutoscroll !== null) {
    autoscrollEnabled = savedAutoscroll === 'true';
    autoscrollSwitch && (autoscrollSwitch.checked = autoscrollEnabled);
  }
  autoscrollSwitch && autoscrollSwitch.addEventListener("change", function () {
    autoscrollEnabled = this.checked;
    localStorage.setItem('autoscrollEnabled', autoscrollEnabled);
    if (autoscrollEnabled) {
      buildScrollMap();
      if (editor && preview) {
        preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
      }
    }
  });

  function markUserScrolling(pane) {
    activeScrollPane = pane;
    clearTimeout(activeScrollTimer);
    activeScrollTimer = setTimeout(() => {
      activeScrollPane = null;
    }, 150);
  }

  if (editor) {
    editor.addEventListener('wheel', () => markUserScrolling('editor'), { passive: true });
    editor.addEventListener('touchstart', () => markUserScrolling('editor'), { passive: true });
    editor.addEventListener('touchmove', () => markUserScrolling('editor'), { passive: true });
    editor.addEventListener('pointerdown', () => markUserScrolling('editor'), { passive: true });
    editor.addEventListener('mouseenter', () => { if (!isSyncingScroll) markUserScrolling('editor'); }, { passive: true });
    editor.addEventListener('keydown', () => { if (!isSyncingScroll) markUserScrolling('editor'); }, { passive: true });
  }

  if (preview) {
    preview.addEventListener('wheel', () => markUserScrolling('preview'), { passive: true });
    preview.addEventListener('touchstart', () => markUserScrolling('preview'), { passive: true });
    preview.addEventListener('touchmove', () => markUserScrolling('preview'), { passive: true });
    preview.addEventListener('pointerdown', () => markUserScrolling('preview'), { passive: true });
    preview.addEventListener('mouseenter', () => { if (!isSyncingScroll) markUserScrolling('preview'); }, { passive: true });
  }

  editor && editor.addEventListener('scroll', () => {
    if (!autoscrollEnabled || isSyncingScroll || isRenderingPreview) return;
    if (activeScrollPane && activeScrollPane !== 'editor') return;

    if (scrollMapNeedsRebuild) {
      buildScrollMap();
    }

    markUserScrolling('editor');
    isSyncingScroll = true;
    preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
    requestAnimationFrame(() => { isSyncingScroll = false; });
  });

  preview && preview.addEventListener('scroll', () => {
    if (!autoscrollEnabled || isSyncingScroll || isRenderingPreview || !editor) return;
    if (activeScrollPane && activeScrollPane !== 'preview') return;

    if (scrollMapNeedsRebuild) {
      buildScrollMap();
    }

    markUserScrolling('preview');
    isSyncingScroll = true;
    editor.scrollTop = getEditorScrollForPreview(preview.scrollTop);
    requestAnimationFrame(() => { isSyncingScroll = false; });
  });

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      buildScrollMap();
    });
    if (editor) ro.observe(editor);
    if (preview) ro.observe(preview);
  } else {
    window.addEventListener('resize', () => {
      buildScrollMap();
    });
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (typeof buildScrollMap === 'function') {
        buildScrollMap();
      }
    });
  }

  let updateTimer = null;
  function scheduleUpdate() {
    if (updateTimer) clearTimeout(updateTimer);
    const docLength = editor ? editor.value.length : 0;
    // Aggiornamento reattivo per file normali (180ms), fluido e non bloccante per documenti grandi (320-450ms)
    const delay = docLength > 60000 ? 450 : (docLength > 20000 ? 320 : 180);
    updateTimer = setTimeout(() => {
      updatePreview();
      updateWordCount();
      const sc = document.getElementById("search-container");
      if (sc && !sc.classList.contains("hidden")) {
        performSearch(false);
      }
    }, delay);
  }
  const debouncedUpdate = scheduleUpdate;

  editor && editor.addEventListener("input", () => {
    if (editor.value.length > 0) {
      if (isTypewriterActive) {
        stopTypewriterEffect();
      }
    } else {
      if (typewriterIdleTimer) clearTimeout(typewriterIdleTimer);
      typewriterIdleTimer = setTimeout(() => {
        if (editor && editor.value.length === 0 && !isTypewriterActive) {
          startTypewriterEffect();
        }
      }, 2200);
    }

    if (isProgrammaticEdit) {
      scheduleUpdate();
      return;
    }
    const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    if (activeTab) {
      activeTab.content = editor.value;
    }
    if (typingStartValue === null) {
      typingStartValue = lastKnownEditorValue;
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      recordAction("Typing", typingStartValue, editor.value);
      typingStartValue = null;
    }, 1000);

    scheduleUpdate();
    if (!isDirty) {
      setDirty(true);
    }

    // Aggiorna highlight di ricerca solo se la barra di ricerca è aperta ed attiva
    if (searchMatches.length > 0) {
      const searchContainer = document.getElementById("search-container");
      if (searchContainer && !searchContainer.classList.contains("hidden")) {
        performSearch();
      } else {
        clearSearchHighlights();
      }
    }
  });

  // Disattiva typewriter su composizione caratteri speciali/IME
  editor && editor.addEventListener('compositionstart', () => {
    stopTypewriterEffect();
  });

  // Sync scroll for overlay and typewriter placeholder
  const overlay = document.getElementById('editor-overlay');
  const typewriterPlaceholder = document.getElementById('typewriter-placeholder');
  if (editor) {
    editor.addEventListener('scroll', () => {
      if (overlay) {
        overlay.scrollTop = editor.scrollTop;
        overlay.scrollLeft = editor.scrollLeft;
      }
      if (typewriterPlaceholder) {
        typewriterPlaceholder.scrollTop = editor.scrollTop;
        typewriterPlaceholder.scrollLeft = editor.scrollLeft;
      }
    });
    // Initial sync
    if (overlay) updateEditorOverlay();
  }

  // ===== TYPEWRITER OVERLAY PLACEHOLDER MODULE =====
  const TYPEWRITER_QUOTES = {
    it: [
      `## Il mio testamento\nLascio tutti i miei averi al mio gatto, ad eccezione della collezione di calzini spaiati che andrà al mio peggior nemico...`,
      `## Piano di invasione aliena\n1. Atterrare in silenzio nel parcheggio del discount.\n2. Chiedere la password del Wi-Fi agli umani.\n3. Ripartire delusi dopo aver letto i social.`,
      `## Lettera formale di scuse al tostapane\nCaro tostapane,\nti chiedo umilmente scusa per averti urlato contro stamattina. So che bruciare il pane a sinistra era un tuo modo di esprimere la tua personalità artistica.`,
      `## Routine mattutina per dominare il mondo\n- [ ] Ore 07:00: Sveglia e triplo caffè.\n- [ ] Ore 07:15: Crisi esistenziale di rito.\n- [ ] Ore 07:30: Conquista dei primi satelliti orbitali.\n- [ ] Ore 08:00: Doccia e biscotti al cioccolato.`,
      `## Diario segreto di un gatto domestico\n> Ore 03:42: Ho corso a perdifiato lungo il corridoio senza alcun motivo. Gli umani si sono svegliati nel terrore. La mia supremazia è confermata.`,
      `## Scaletta del concerto esclusivo sotto la doccia\n1. Bohemian Rhapsody (in falsetto stonato)\n2. Assolo d'aria con il flacone di shampoo\n3. Ringraziamenti al bagnoschiuma per il supporto morale`,
      `## Trattato di pace con il cavo delle cuffie\nArticolo 1: Il cavo si impegna solennemente a non annodarsi spontaneamente in nove dimensioni ogni volta che viene riposto in tasca per più di venti secondi...`,
      `## Progetto Top Secret: Macchina del Tempo a pedali\n\`\`\`python\ndef viaggia_nel_tempo(anno=1985):\n    pedala_forte()\n    # TODO: procurarsi 1.21 Gigawatt\n\`\`\``,
      `## Lista della spesa per l'apocalisse zombie\n- [x] Caffè in grani (priorità assoluta)\n- [ ] Mazza da baseball con chiodi\n- [ ] Caricabatterie di riserva\n- [ ] Biscotti (per mantenere alto il morale)`,
      `## Regolamento ufficiale della casa\n1. Chi finisce il rotolo di carta igienica deve rimetterne uno nuovo.\n2. Appoggiarlo sopra il porta-rotolo NON conta come averlo rimesso.\n3. Si applicano sanzioni severe.`
    ],
    en: [
      `## My Last Will and Testament\nI leave everything to my cat, except for my collection of tangled USB cables, which goes to whoever manages to untangle them...`,
      `## Alien Invasion Checklist\n1. Land quietly behind the local convenience store.\n2. Ask politely for the Wi-Fi password.\n3. Leave in disappointment after 5 minutes on social media.`,
      `## Formal Apology Letter to the Toaster\nDear toaster,\nI am truly sorry for yelling at you this morning. Burning the crust was an artistic choice, and I failed to respect your craft.`,
      `## Morning Routine for Galactic Domination\n- [ ] 07:00 AM: Wake up & triple espresso.\n- [ ] 07:15 AM: Brief existential crisis.\n- [ ] 07:30 AM: Conquer outer orbital satellites.\n- [ ] 08:00 AM: Breakfast smoothie.`,
      `## Secret Diary of an Indoor Cat\n> 03:42 AM: Screamed outside a closed bedroom door for an hour. Once opened, refused to walk in. Psychological dominance maintained.`,
      `## Setlist: Live World Tour Under the Shower Head\n1. Bohemian Rhapsody (dramatically off-key)\n2. Shampoo bottle microphone solo\n3. Emotional acceptance speech to the shower curtain`,
      `## Peace Treaty with My Earphone Cables\nArticle 1: The cables solemnly swear not to spontaneously braid themselves into a 4D knot whenever placed in a pocket for over 30 seconds...`,
      `## Blueprints: Bicycle-Powered Time Machine\n\`\`\`python\ndef time_travel(year=1985):\n    pedal_faster()\n    # TODO: acquire 1.21 Gigawatts\n\`\`\``,
      `## Zombie Apocalypse Shopping List\n- [x] Coffee beans (top survival priority)\n- [ ] Spiked baseball bat\n- [ ] Portable power bank\n- [ ] Chocolate chip cookies (for emotional stability)`,
      `## Official Household Rules\n1. Whoever finishes the toilet paper roll must replace it.\n2. Balancing the new roll on top of the empty one does NOT count.\n3. Violations will be prosecuted.`
    ]
  };

  let typewriterTimeout = null;
  let typewriterIdleTimer = null;
  let isTypewriterActive = false;
  let lastQuoteIndex = -1;

  function stopTypewriterEffect() {
    if (typewriterTimeout) {
      clearTimeout(typewriterTimeout);
      typewriterTimeout = null;
    }
    if (typewriterIdleTimer) {
      clearTimeout(typewriterIdleTimer);
      typewriterIdleTimer = null;
    }
    isTypewriterActive = false;
    document.body.classList.remove('typewriter-running');
    const placeholderEl = document.getElementById('typewriter-placeholder');
    if (placeholderEl) {
      placeholderEl.classList.remove('active');
      placeholderEl.innerHTML = '';
    }
  }

  function startTypewriterEffect(forcedQuote = null) {
    if (!editor) return;

    // Se l'editor contiene già del testo reale, non mostrare overlay
    if (editor.value.length > 0) {
      stopTypewriterEffect();
      return;
    }

    // Se non ci sono tab aperti (schermata empty-state attiva), non mostrare overlay
    const emptyStateEl = document.getElementById('empty-state');
    if (emptyStateEl && !emptyStateEl.classList.contains('hidden')) {
      stopTypewriterEffect();
      return;
    }

    // Non avviare in modalità lettura o solo-preview
    if (typeof isReadingMode !== 'undefined' && isReadingMode) {
      stopTypewriterEffect();
      return;
    }
    const containerEl = document.getElementById('container');
    if (containerEl && containerEl.classList.contains('solo-preview')) {
      stopTypewriterEffect();
      return;
    }

    // Non avviare se collaborazione Yjs è attiva
    if (typeof getCollabState === 'function' && getCollabState().isActive) {
      stopTypewriterEffect();
      return;
    }

    // Cancella eventuali animazioni precedenti
    if (typewriterTimeout) {
      clearTimeout(typewriterTimeout);
      typewriterTimeout = null;
    }
    if (typewriterIdleTimer) {
      clearTimeout(typewriterIdleTimer);
      typewriterIdleTimer = null;
    }

    const placeholderEl = document.getElementById('typewriter-placeholder');
    if (!placeholderEl) return;

    isTypewriterActive = true;
    document.body.classList.add('typewriter-running');
    placeholderEl.classList.add('active');
    placeholderEl.scrollTop = editor.scrollTop;
    placeholderEl.scrollLeft = editor.scrollLeft;

    // Assicura che il placeholder nativo dell'editor rimanga vuoto e il cursore sia a 0
    editor.placeholder = '';
    if (document.activeElement === editor) {
      try {
        editor.setSelectionRange(0, 0);
      } catch (_) {}
    }

    // Determina la lingua attuale
    const currentLang = (typeof i18n !== 'undefined' && typeof i18n.getLanguage === 'function')
      ? i18n.getLanguage()
      : (localStorage.getItem('mark.lang') || 'en');
    const pool = (currentLang === 'it') ? TYPEWRITER_QUOTES.it : TYPEWRITER_QUOTES.en;

    let quote = forcedQuote;
    if (!quote) {
      let nextIdx;
      if (pool.length <= 1) {
        nextIdx = 0;
      } else {
        do {
          nextIdx = Math.floor(Math.random() * pool.length);
        } while (nextIdx === lastQuoteIndex);
      }
      lastQuoteIndex = nextIdx;
      quote = pool[nextIdx];
    }

    let charIndex = 0;
    placeholderEl.innerHTML = '<span class="typewriter-start-caret"></span><span class="typewriter-text"></span>';

    function escapeTypewriterHtml(str) {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function typeNextChar() {
      if (!isTypewriterActive || (editor && editor.value.length > 0)) {
        stopTypewriterEffect();
        return;
      }

      charIndex++;
      const currentSubstr = quote.slice(0, charIndex);
      placeholderEl.innerHTML = '<span class="typewriter-start-caret"></span><span class="typewriter-text">' + escapeTypewriterHtml(currentSubstr) + '</span>';

      if (charIndex < quote.length) {
        const currentChar = quote[charIndex - 1];
        let delay = 26 + Math.random() * 20; // 26-46ms base naturale e fluida

        if (currentChar === '\n') {
          delay = 140 + Math.random() * 60; // breve pausa naturale all'a capo
        } else if (['.', '!', '?'].includes(currentChar)) {
          delay = 200 + Math.random() * 80; // pausa di respiro alla fine di una frase
        } else if ([':', ';', ','].includes(currentChar)) {
          delay = 90 + Math.random() * 40; // micro pausa sui segni di punteggiatura
        }

        typewriterTimeout = setTimeout(typeNextChar, delay);
      }
    }

    typewriterTimeout = setTimeout(typeNextChar, 140);
  }

  // ===== Paste immagini =====
  editor && editor.addEventListener('paste', async (e) => {
    stopTypewriterEffect();
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
    if (typeof openFileInTab === 'function') {
      openFileInTab(filePath, content !== undefined ? content : null);
    }
  });

  ipcRenderer.on("export-pdf", () => exportToPdf());
  ipcRenderer.on("export-html", () => exportToHtml());
  ipcRenderer.on("new-file", () => createNewFile());
  ipcRenderer.on("open-folder", (event, folderPath) => openFolder(folderPath));
  ipcRenderer.on("trigger-save", () => saveCurrentFile());
  ipcRenderer.on("close-active-tab", () => {
    if (activeTabId && typeof closeTab === 'function') {
      closeTab(activeTabId);
    }
  });
  ipcRenderer.on("toggle-explorer", () => { const p = document.getElementById("explorer-panel"); p && p.classList.toggle("hidden"); });
  const toggleViewMode = (targetMode) => {
    const container = document.getElementById("container");
    if (!container) return;
    if (container.classList.contains(targetMode)) {
      container.className = "split-view";
      if (editor && editor.value.length === 0 && typeof startTypewriterEffect === 'function') {
        startTypewriterEffect();
      }
    } else {
      container.className = targetMode;
      if (targetMode === "solo-preview") {
        if (typeof stopTypewriterEffect === 'function') stopTypewriterEffect();
      } else if (targetMode === "solo-editor") {
        if (editor && editor.value.length === 0 && typeof startTypewriterEffect === 'function') {
          startTypewriterEffect();
        }
      }
    }
    refreshSearchIfOpen();
    setTimeout(() => {
      if (typeof buildScrollMap === 'function') {
        buildScrollMap();
        if (autoscrollEnabled && preview && editor && container.className === "split-view") {
          preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
        }
      }
    }, 250);
  };

  ipcRenderer.on("toggle-editor-view", () => toggleViewMode("solo-editor"));
  ipcRenderer.on("toggle-preview-view", () => toggleViewMode("solo-preview"));
  ipcRenderer.on("toggle-preview", () => toggleViewMode("solo-editor"));
  ipcRenderer.on("toggle-editor", () => toggleViewMode("solo-preview"));
  ipcRenderer.on("insert-link", () => { if (typeof insertMarkdownLink === 'function') insertMarkdownLink(); });
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

  // ===== FULLSCREEN FILE DRAG & DROP MODULE =====
  const IMAGE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif', '.avif'
  ]);

  const CODE_EXTENSIONS_MAP = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'sass',
    '.less': 'less',
    '.json': 'json',
    '.xml': 'xml',
    '.py': 'python',
    '.pyw': 'python',
    '.rb': 'ruby',
    '.php': 'php',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.fish': 'bash',
    '.bat': 'batch',
    '.cmd': 'batch',
    '.ps1': 'powershell',
    '.sql': 'sql',
    '.r': 'r',
    '.lua': 'lua',
    '.pl': 'perl',
    '.pm': 'perl',
    '.scala': 'scala',
    '.dart': 'dart',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.env': 'shell',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.txt': 'text',
    '.log': 'text',
    '.diff': 'diff',
    '.patch': 'diff'
  };

  function isImageFile(filePath, mimeType) {
    if (mimeType && mimeType.startsWith('image/')) return true;
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  }

  function processDroppedImage(filePath) {
    if (!filePath) return null;

    if (!currentFilePath) {
      const shouldSave = dialog.showMessageBoxSync({
        type: 'question',
        buttons: [i18n.t('dialog_save') || 'Save', i18n.t('dialog_cancel') || 'Cancel'],
        defaultId: 0,
        title: i18n.t('dialog_paste_img_title') || 'Save Document',
        message: i18n.t('dialog_paste_img_message') || 'Please save the markdown file first so images can be organized.'
      });
      if (shouldSave === 0) {
        const savedPath = dialog.showSaveDialogSync({ filters: [{ name: "Markdown", extensions: ["md"] }] });
        if (savedPath) {
          fs.writeFileSync(savedPath, editor.value, "utf8");
          currentFilePath = savedPath;
          const activeTab = getActiveTab();
          if (activeTab) {
            activeTab.filePath = savedPath;
            activeTab.title = path.basename(savedPath);
          }
          setDirty(false);
          renderTabs();
        }
      }
    }

    let fileName = path.basename(filePath).replace(/\s+/g, '_');
    let relativePath = filePath;

    if (currentFilePath) {
      const docDir = path.dirname(currentFilePath);
      const destDir = path.join(docDir, 'images');
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      let destPath = path.join(destDir, fileName);
      if (fs.existsSync(destPath) && path.resolve(destPath) !== path.resolve(filePath)) {
        const ext = path.extname(fileName);
        const name = path.basename(fileName, ext);
        fileName = `${name}_${Date.now()}${ext}`;
        destPath = path.join(destDir, fileName);
      }

      try {
        if (path.resolve(destPath) !== path.resolve(filePath)) {
          fs.copyFileSync(filePath, destPath);
        }
        relativePath = path.relative(docDir, destPath).replace(/\\/g, '/');
      } catch (err) {
        console.error('Error copying image file:', err);
        relativePath = path.relative(docDir, filePath).replace(/\\/g, '/');
      }
    }

    const alt = path.parse(fileName).name;
    return `![${alt}](${relativePath})`;
  }

  function processDroppedCode(filePath) {
    if (!filePath) return null;
    let content;
    try {
      const buffer = fs.readFileSync(filePath);
      const checkLen = Math.min(buffer.length, 1024);
      for (let i = 0; i < checkLen; i++) {
        if (buffer[i] === 0) {
          showNotification(i18n.t('notif_binary_file_skip', { name: path.basename(filePath) }) || `Cannot import binary file: ${path.basename(filePath)}`, "info");
          return null;
        }
      }
      content = buffer.toString('utf8');
    } catch (err) {
      console.error('Error reading code file:', err);
      return null;
    }

    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    let lang = CODE_EXTENSIONS_MAP[ext] || CODE_EXTENSIONS_MAP[base] || '';
    if (!lang && ext.startsWith('.')) {
      lang = ext.slice(1);
    }

    const matches = content.match(/`+/g) || [];
    let maxBackticks = 2;
    for (const m of matches) {
      if (m.length > maxBackticks) maxBackticks = m.length;
    }
    const fence = '`'.repeat(maxBackticks + 1);

    return `${fence}${lang}\n${content}\n${fence}`;
  }

  function insertSnippetsIntoEditor(snippets) {
    if (!editor || !snippets || snippets.length === 0) return;
    if (typeof stopTypewriterEffect === 'function') stopTypewriterEffect();

    const container = document.getElementById("container");
    if (container && container.classList.contains("solo-preview")) {
      container.className = "split-view";
    }

    const joinedText = snippets.join('\n\n');
    const val = editor.value;

    let start, end;
    const hasSelector = editorHasUserCursor && editorUserCaret && typeof editorUserCaret.start === 'number';

    if (hasSelector) {
      start = Math.max(0, Math.min(editorUserCaret.start, val.length));
      end = Math.max(0, Math.min(editorUserCaret.end, val.length));
    } else {
      start = val.length;
      end = val.length;
    }

    let textToInsert = joinedText;

    if (hasSelector) {
      textToInsert = joinedText;
    } else {
      if (val.length > 0) {
        if (val.endsWith('\n\n')) {
          textToInsert = joinedText + '\n';
        } else if (val.endsWith('\n')) {
          textToInsert = '\n' + joinedText + '\n';
        } else {
          textToInsert = '\n\n' + joinedText + '\n';
        }
      } else {
        textToInsert = joinedText + '\n';
      }
    }

    executeAction("Drop File", () => {
      const textBefore = val.substring(0, start);
      const textAfter = val.substring(end);
      editor.value = textBefore + textToInsert + textAfter;

      const newCursorPos = textBefore.length + textToInsert.length;
      editor.setSelectionRange(newCursorPos, newCursorPos);
      editorHasUserCursor = true;
      editorUserCaret = { start: newCursorPos, end: newCursorPos };

      updatePreview();
      if (wordCountEl && typeof updateWordCount === 'function') updateWordCount();
      setDirty(true);
      if (typeof updateEditorOverlay === 'function') updateEditorOverlay();
      editor.focus();
    });

    requestAnimationFrame(() => {
      if (typeof buildScrollMap === 'function') buildScrollMap();
      if (autoscrollEnabled && preview && editor) {
        preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
      }
    });
  }

  function handleDroppedFiles(e) {
    const fileList = e.dataTransfer && e.dataTransfer.files;
    if (!fileList || fileList.length === 0) return;

    if (tabs.length === 0) {
      createNewTab();
    }

    const snippets = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const filePath = file.path;
      if (!filePath) continue;

      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          continue;
        }
      } catch (_) {
        continue;
      }

      if (isImageFile(filePath, file.type)) {
        const imgSnippet = processDroppedImage(filePath);
        if (imgSnippet) snippets.push(imgSnippet);
      } else {
        const codeSnippet = processDroppedCode(filePath);
        if (codeSnippet) snippets.push(codeSnippet);
      }
    }

    if (snippets.length === 0) return;

    insertSnippetsIntoEditor(snippets);
  }

  let fileDragCounter = 0;
  const fileDropOverlay = document.getElementById('file-drop-overlay');

  function isDraggingFiles(e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.from(e.dataTransfer.types).includes('Files');
  }

  window.addEventListener('dragenter', (e) => {
    if (!isDraggingFiles(e)) return;
    fileDragCounter++;
    if (fileDragCounter === 1 && fileDropOverlay) {
      fileDropOverlay.classList.add('active');
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (!isDraggingFiles(e)) return;
    fileDragCounter--;
    if (fileDragCounter <= 0) {
      fileDragCounter = 0;
      if (fileDropOverlay) fileDropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('dragover', (e) => {
    if (!isDraggingFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('drop', (e) => {
    if (!isDraggingFiles(e)) return;
    e.preventDefault();
    fileDragCounter = 0;
    if (fileDropOverlay) fileDropOverlay.classList.remove('active');

    handleDroppedFiles(e);
  });

  window.addEventListener('blur', () => {
    fileDragCounter = 0;
    if (fileDropOverlay) fileDropOverlay.classList.remove('active');
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
    const isMod = isMac ? (e.metaKey || e.ctrlKey) : e.ctrlKey;
    if (isMod && (e.key === "f" || e.key === "F")) { e.preventDefault(); toggleSearchPanel(true); }
    if (isMod && !e.shiftKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); insertMarkdownLink(); }
    if (isMod && e.shiftKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); toggleViewMode("solo-editor"); }
    if (isMod && e.shiftKey && (e.key === "p" || e.key === "P")) { e.preventDefault(); toggleViewMode("solo-preview"); }
    if (isMod && (e.key === "h" || e.key === "H")) { e.preventDefault(); formatAsCode(); }
    if (isMod && (e.key === "k" || e.key === "K")) { e.preventDefault(); formatMarkdown(); }
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

    tempDiv.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());
    tempDiv.querySelectorAll('.callout-color-btn').forEach(btn => btn.remove());

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

  // ===== HTML export =====
  function exportToHtml() {
    if (!preview) return;

    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = preview.innerHTML;

      // 1. Rimuovi eventuali bottoni di copia o colore già presenti nella preview per pulire l'HTML
      tempDiv.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());
      tempDiv.querySelectorAll('.callout-color-btn').forEach(btn => btn.remove());

      // 2. Converti immagini locali / relative in Base64 data URLs
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
            if (process.platform === 'win32' && filePath.startsWith('/')) {
              filePath = filePath.slice(1);
            }
          } else if (currentFilePath) {
            const folder = path.dirname(currentFilePath);
            filePath = path.resolve(folder, decodeURIComponent(src));
          }

          if (!fs.existsSync(filePath)) {
            console.warn('[HTML export] Immagine non trovata:', filePath);
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

          img.setAttribute('src', `data:${mime};base64,${base64}`);
        } catch (err) {
          console.error('[HTML export] Errore nel leggere/convertire immagine:', src, err);
        }
      });

      // 3. Estrai titoli (h1..h6), assegna ID univoci per il Table of Contents e scroll-spy
      const headingEls = tempDiv.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const headings = [];
      const usedIds = new Set();

      headingEls.forEach((h, idx) => {
        let text = (h.textContent || '').trim();
        if (!text) text = `Heading ${idx + 1}`;
        let baseId = text.toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        if (!baseId) baseId = `heading-${idx + 1}`;
        let id = baseId;
        let count = 1;
        while (usedIds.has(id)) {
          id = `${baseId}-${count++}`;
        }
        usedIds.add(id);
        h.id = id;
        const level = parseInt(h.tagName.substring(1), 10) || 1;
        headings.push({ id, level, text });
      });

      // 4. Determina percorso di salvataggio
      const currentName = currentFilePath ? path.basename(currentFilePath) : "document.md";
      const defaultName = currentName.replace(/\.[^/.]+$/, "") + ".html";
      let defaultPath = defaultName;
      if (currentFilePath) {
        defaultPath = path.join(path.dirname(currentFilePath), defaultName);
      } else {
        try {
          const docsDir = remote.app.getPath("documents");
          if (docsDir) defaultPath = path.join(docsDir, defaultName);
        } catch (_) {}
      }

      const savePath = dialog.showSaveDialogSync({
        title: i18n.t("dialog_save_html_title") || "Save HTML",
        defaultPath: defaultPath,
        filters: [
          { name: "HTML Files (*.html, *.htm)", extensions: ["html", "htm"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });

      if (!savePath) return;

      // 5. Genera standalone HTML
      const isDark = document.body.classList.contains("dark");
      const lang = (typeof i18n.getLanguage === 'function') ? i18n.getLanguage() : (localStorage.getItem('mark.lang') || 'en');

      const fullHtml = buildExportHtml({
        filename: currentName,
        bodyHtml: tempDiv.innerHTML,
        headings,
        theme: isDark ? "dark" : "light",
        lang
      });

      // 6. Scrivi file su disco e mostra notifica
      fs.writeFileSync(savePath, fullHtml, "utf8");
      showNotification(i18n.t("notif_html_saved") || "HTML file exported successfully", "success");
    } catch (err) {
      console.error('[HTML export] Errore esportazione:', err);
      showNotification(i18n.t("notif_html_export_error", { msg: err.message }) || ("Error: " + err.message), "error");
    }
  }

  // ===== Format Folder Path with ~ for Home Directory =====
  function formatFolderPath(folderPath) {
    if (!folderPath) return '';
    try {
      const home = os.homedir();
      if (!home) return folderPath;

      const normalizedFolder = path.resolve(folderPath);
      const normalizedHome = path.resolve(home);

      const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
      const folderKey = isCaseInsensitive ? normalizedFolder.toLowerCase() : normalizedFolder;
      const homeKey = isCaseInsensitive ? normalizedHome.toLowerCase() : normalizedHome;

      if (folderKey === homeKey) {
        return '~';
      }

      const relative = path.relative(normalizedHome, normalizedFolder);
      const isInsideHome = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

      if (isInsideHome) {
        return '~/' + relative.split(path.sep).join('/');
      }

      return folderPath;
    } catch (_) {
      return folderPath;
    }
  }

  function collapseAllFolders() {
    if (!fileTree) return;
    const openFolders = fileTree.querySelectorAll('.tree-folder:not(.collapsed)');
    openFolders.forEach(folder => {
      folder.classList.add('collapsed');
    });
  }

  // ===== File tree / IO =====
  function openFolder(folderPath) {
    currentFolderPath = folderPath;

    const displayPath = formatFolderPath(folderPath);
    if (folderPathEl) {
      folderPathEl.title = folderPath;
      folderPathEl.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span class="folder-path-text">${escapeHtml(displayPath)}</span>
      `;
      folderPathEl.classList.remove('hidden');
    }

    if (fileTree) {
      fileTree.innerHTML = '';
      if (!fileTree.dataset.hasClickListener) {
        fileTree.dataset.hasClickListener = 'true';
        fileTree.addEventListener('click', (e) => {
          if (!e.target.closest('.tree-item')) {
            clearExplorerSelection();
          }
        });
      }
    }
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

  // ====== MULTI-TAB FILE MANAGEMENT ======
  let tabs = [];
  let activeTabId = null;
  let untitledCounter = 0;
  let isDraggingTab = false;

  function getActiveTab() {
    return tabs.find(t => t.id === activeTabId) || null;
  }

  function saveStateForActiveTab() {
    const activeTab = getActiveTab();
    if (activeTab && editor) {
      activeTab.content = editor.value;
      activeTab.scrollTop = editor.scrollTop;
      activeTab.selectionStart = editor.selectionStart;
      activeTab.selectionEnd = editor.selectionEnd;
      activeTab.actionHistory = actionHistory;
      activeTab.lastKnownEditorValue = lastKnownEditorValue;
      activeTab.hasUserCursor = editorHasUserCursor;
      activeTab.userCaret = editorUserCaret;
    }
  }

  function updateTabDirtyIndicator(tabId, dirty) {
    const tabEl = document.querySelector(`.editor-tab[data-tab-id="${tabId}"]`);
    if (tabEl) {
      const dirtySpan = tabEl.querySelector('.tab-dirty');
      if (dirtySpan) {
        if (dirty) {
          dirtySpan.classList.add('visible');
        } else {
          dirtySpan.classList.remove('visible');
        }
      }
    }
  }

  function renderTabs() {
    if (!tabsScrollArea) return;
    tabsScrollArea.innerHTML = '';

    if (tabs.length === 0) {
      if (tabsBar) tabsBar.classList.add('hidden');
      if (viewContainer) viewContainer.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
      if (wordCountEl) wordCountEl.textContent = i18n.t('word_count', { count: 0 });
      document.querySelectorAll('.tree-item').forEach(item => item.classList.remove('active'));
      return;
    }

    if (tabsBar && !isReadingMode) tabsBar.classList.remove('hidden');
    if (viewContainer) viewContainer.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');

    tabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = 'editor-tab' + (tab.id === activeTabId ? ' active' : '');
      tabEl.dataset.tabId = tab.id;
      tabEl.title = tab.filePath || tab.title;

      tabEl.innerHTML = `
        <span class="tab-icon">${FILE_SVG}</span>
        <span class="tab-title">${escapeHtml(tab.title)}</span>
        <span class="tab-dirty ${tab.isDirty ? 'visible' : ''}">*</span>
        <button class="tab-close-btn" data-tab-id="${tab.id}" title="${escapeHtml(i18n.t('tab_close_btn') || 'Close')}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;

      tabEl.addEventListener('pointerdown', (e) => {
        initTabDrag(e, tab.id, tabEl);
      });

      tabEl.addEventListener('dragstart', (e) => {
        e.preventDefault();
      });

      tabEl.addEventListener('click', (e) => {
        if (isDraggingTab) return;
        if (!e.target.closest('.tab-close-btn')) {
          switchToTab(tab.id);
        }
      });

      tabEl.addEventListener('auxclick', (e) => {
        if (e.button === 1) { // Middle click
          e.preventDefault();
          closeTab(tab.id);
        }
      });

      const closeBtn = tabEl.querySelector('.tab-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeTab(tab.id);
        });
      }

      tabsScrollArea.appendChild(tabEl);
    });

    const activeTab = getActiveTab();
    if (activeTab && activeTab.filePath) {
      document.querySelectorAll('.tree-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.path === activeTab.filePath) item.classList.add('active');
      });
    } else {
      document.querySelectorAll('.tree-item').forEach(item => item.classList.remove('active'));
    }
  }

  function initTabDrag(e, tabId, tabEl) {
    if (e.button !== 0) return;
    if (e.target.closest('.tab-close-btn')) return;
    if (isDraggingTab) return;
    if (!tabs || tabs.length <= 1) return;

    const fromIndex = tabs.findIndex(t => t.id === tabId);
    if (fromIndex === -1) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let isDragging = false;
    let currentTargetIndex = fromIndex;

    const scrollArea = tabsScrollArea;
    if (!scrollArea) return;
    const tabsBarEl = tabsBar || document.getElementById('tabs-bar');
    let indicatorEl = document.getElementById('tab-drop-indicator');
    if (!indicatorEl && tabsBarEl) {
      indicatorEl = document.createElement('div');
      indicatorEl.id = 'tab-drop-indicator';
      tabsBarEl.appendChild(indicatorEl);
    }

    const allTabEls = Array.from(scrollArea.querySelectorAll('.editor-tab'));
    if (allTabEls.length !== tabs.length) return;

    const initialScrollLeft = scrollArea.scrollLeft;
    const tabRects = allTabEls.map(el => el.getBoundingClientRect());
    const draggedWidth = tabRects[fromIndex].width;

    function onPointerMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (!isDragging) {
        if (Math.hypot(deltaX, deltaY) < 5) return;
        isDragging = true;
        isDraggingTab = true;

        tabEl.classList.add('is-dragging');
        allTabEls.forEach((el, idx) => {
          if (idx !== fromIndex) {
            el.classList.add('tab-sliding');
          }
        });
        if (indicatorEl) indicatorEl.style.display = 'block';
      }

      // Move dragged tab smoothly with pointer
      tabEl.style.transform = `translateX(${deltaX}px) scale(1.02)`;

      // Auto-scroll near edges of tab scroll area
      const scrollRect = scrollArea.getBoundingClientRect();
      if (moveEvent.clientX < scrollRect.left + 25) {
        scrollArea.scrollLeft -= 6;
      } else if (moveEvent.clientX > scrollRect.right - 25) {
        scrollArea.scrollLeft += 6;
      }

      const scrollDelta = scrollArea.scrollLeft - initialScrollLeft;
      const currentDraggedCenter = (tabRects[fromIndex].left - scrollDelta) + deltaX + (draggedWidth / 2);

      // Determine newTargetIndex
      let newTargetIndex = fromIndex;
      for (let i = 0; i < fromIndex; i++) {
        const siblingCenter = (tabRects[i].left - scrollDelta) + (tabRects[i].width * 0.5);
        if (currentDraggedCenter < siblingCenter) {
          newTargetIndex = i;
          break;
        }
      }
      if (newTargetIndex === fromIndex) {
        for (let i = tabs.length - 1; i > fromIndex; i--) {
          const siblingCenter = (tabRects[i].left - scrollDelta) + (tabRects[i].width * 0.5);
          if (currentDraggedCenter > siblingCenter) {
            newTargetIndex = i;
            break;
          }
        }
      }

      if (newTargetIndex !== currentTargetIndex) {
        currentTargetIndex = newTargetIndex;
        // Shift sibling tabs to visually preview the new arrangement
        allTabEls.forEach((el, i) => {
          if (i === fromIndex) return;
          if (currentTargetIndex > fromIndex && i > fromIndex && i <= currentTargetIndex) {
            el.style.transform = `translateX(-${draggedWidth}px)`;
          } else if (currentTargetIndex < fromIndex && i < fromIndex && i >= currentTargetIndex) {
            el.style.transform = `translateX(${draggedWidth}px)`;
          } else {
            el.style.transform = 'translateX(0px)';
          }
        });
      }

      // Position glowing drop indicator at the target slot boundary
      if (indicatorEl && tabsBarEl) {
        if (currentTargetIndex === fromIndex) {
          indicatorEl.style.display = 'none';
        } else {
          indicatorEl.style.display = 'block';
          const tabsBarRect = tabsBarEl.getBoundingClientRect();
          let indicatorX;
          if (currentTargetIndex > fromIndex) {
            indicatorX = tabRects[currentTargetIndex].right - scrollDelta - draggedWidth - tabsBarRect.left;
          } else {
            indicatorX = tabRects[currentTargetIndex].left - scrollDelta - tabsBarRect.left;
          }
          indicatorEl.style.left = `${indicatorX}px`;
        }
      }
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);

      if (!isDragging) {
        return;
      }

      if (indicatorEl) indicatorEl.style.display = 'none';

      // Smooth landing glide into the final slot
      let finalDeltaX = 0;
      if (currentTargetIndex > fromIndex) {
        finalDeltaX = (tabRects[currentTargetIndex].right - draggedWidth) - tabRects[fromIndex].left;
      } else if (currentTargetIndex < fromIndex) {
        finalDeltaX = tabRects[currentTargetIndex].left - tabRects[fromIndex].left;
      }

      tabEl.style.transition = 'transform 0.16s cubic-bezier(0.2, 0, 0, 1)';
      tabEl.style.transform = `translateX(${finalDeltaX}px)`;

      setTimeout(() => {
        if (currentTargetIndex !== fromIndex) {
          const [movedTab] = tabs.splice(fromIndex, 1);
          tabs.splice(currentTargetIndex, 0, movedTab);
          renderTabs();
        } else {
          tabEl.classList.remove('is-dragging');
          allTabEls.forEach(el => {
            el.classList.remove('tab-sliding');
            el.style.transform = '';
            el.style.transition = '';
          });
        }
        setTimeout(() => {
          isDraggingTab = false;
        }, 50);
      }, 160);
    }

    function onKeyDown(keyEvent) {
      if (keyEvent.key === 'Escape' && isDragging) {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);

        if (indicatorEl) indicatorEl.style.display = 'none';
        tabEl.style.transition = 'transform 0.15s ease-out';
        tabEl.style.transform = 'translateX(0px)';
        allTabEls.forEach(el => {
          el.style.transform = 'translateX(0px)';
        });
        setTimeout(() => {
          tabEl.classList.remove('is-dragging');
          allTabEls.forEach(el => {
            el.classList.remove('tab-sliding');
            el.style.transform = '';
            el.style.transition = '';
          });
          setTimeout(() => {
            isDraggingTab = false;
          }, 50);
        }, 150);
      }
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  }

  function switchToTab(tabId) {
    if (activeTabId === tabId) {
      renderTabs();
      return;
    }

    const targetTab = tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    if (getCollabState().isActive) {
      if (!confirmLeaveCollabIfActive('action_open_file', { name: targetTab.title })) {
        return;
      }
    }

    saveStateForActiveTab();

    activeTabId = targetTab.id;
    currentFilePath = targetTab.filePath;
    isDirty = targetTab.isDirty;

    if (editor) {
      isProgrammaticEdit = true;
      editor.value = targetTab.content;
      lastKnownEditorValue = targetTab.lastKnownEditorValue !== undefined ? targetTab.lastKnownEditorValue : targetTab.content;
      actionHistory = Array.isArray(targetTab.actionHistory) ? targetTab.actionHistory : [];
      isProgrammaticEdit = false;

      updatePreview();
      updateWordCount();
      updateEditorOverlay();

      editor.scrollTop = targetTab.scrollTop || 0;
      const sStart = targetTab.selectionStart !== undefined ? targetTab.selectionStart : 0;
      const sEnd = targetTab.selectionEnd !== undefined ? targetTab.selectionEnd : 0;
      try {
        editor.setSelectionRange(sStart, sEnd);
      } catch (_) {}

      if (targetTab.hasUserCursor && targetTab.userCaret) {
        editorHasUserCursor = true;
        editorUserCaret = targetTab.userCaret;
      } else {
        editorHasUserCursor = false;
        editorUserCaret = null;
      }
      requestAnimationFrame(() => {
        buildScrollMap();
        if (autoscrollEnabled && preview) {
          preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
        }
      });

      if (editor.value.length === 0) {
        if (typeof startTypewriterEffect === 'function') startTypewriterEffect();
      } else {
        if (typeof stopTypewriterEffect === 'function') stopTypewriterEffect();
      }
    }

    renderTabs();

    const activeEl = document.querySelector(`.editor-tab[data-tab-id="${tabId}"]`);
    activeEl?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  }

  function createNewTab(title = null, content = '') {
    if (getCollabState().isActive) {
      if (!confirmLeaveCollabIfActive('creare un nuovo file')) {
        return;
      }
    }

    untitledCounter++;
    const defaultTitle = (i18n.t('untitled_file') || 'untitled') + '-' + untitledCounter;
    const newTab = {
      id: 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      filePath: null,
      title: title || defaultTitle,
      content: content,
      isDirty: false,
      scrollTop: 0,
      selectionStart: 0,
      selectionEnd: 0,
      actionHistory: [],
      lastKnownEditorValue: content
    };

    saveStateForActiveTab();
    tabs.push(newTab);
    switchToTab(newTab.id);
    if (editor) {
      editor.focus();
      try {
        editor.setSelectionRange(0, 0);
      } catch (_) {}
    }
    if (!content && typeof startTypewriterEffect === 'function') {
      startTypewriterEffect();
    }
  }

  function openFileInTab(filePath, content = null) {
    if (!filePath) return null;
    const normalPath = path.resolve(filePath);

    // If already open, switch to it
    const existing = tabs.find(t => t.filePath && path.resolve(t.filePath) === normalPath);
    if (existing) {
      switchToTab(existing.id);
      return existing;
    }

    if (getCollabState().isActive) {
      if (!confirmLeaveCollabIfActive('action_open_file', { name: path.basename(normalPath) })) {
        return null;
      }
    }

    let fileContent = content;
    if (fileContent === null) {
      try {
        fileContent = fs.readFileSync(normalPath, 'utf8');
      } catch (err) {
        dialog.showErrorBox(i18n.t('notif_error', { msg: err.message }) || 'Error', err.message);
        return null;
      }
    }

    // Check if current single tab is an untouched, empty untitled tab
    if (tabs.length === 1 && !tabs[0].filePath && !tabs[0].isDirty && (tabs[0].content === '' || (editor && editor.value === ''))) {
      tabs[0].filePath = normalPath;
      tabs[0].title = path.basename(normalPath);
      tabs[0].content = fileContent;
      tabs[0].isDirty = false;
      tabs[0].lastKnownEditorValue = fileContent;
      tabs[0].actionHistory = [];
      activeTabId = null;
      switchToTab(tabs[0].id);

      const containingFolder = path.dirname(normalPath);
      if (currentFolderPath !== containingFolder && !currentFolderPath) {
        openFolder(containingFolder);
      }
      return tabs[0];
    }

    saveStateForActiveTab();

    const newTab = {
      id: 'tab-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      filePath: normalPath,
      title: path.basename(normalPath),
      content: fileContent,
      isDirty: false,
      scrollTop: 0,
      selectionStart: 0,
      selectionEnd: 0,
      actionHistory: [],
      lastKnownEditorValue: fileContent
    };

    tabs.push(newTab);
    switchToTab(newTab.id);

    const containingFolder = path.dirname(normalPath);
    if (currentFolderPath !== containingFolder && !currentFolderPath) {
      openFolder(containingFolder);
    }
    return newTab;
  }

  function saveSpecificTab(tab) {
    if (!tab) return false;
    if (tab.id === activeTabId && editor) {
      tab.content = editor.value;
    }

    if (tab.filePath) {
      try {
        fs.writeFileSync(tab.filePath, tab.content, 'utf8');
        tab.isDirty = false;
        if (tab.id === activeTabId) {
          isDirty = false;
        }
        updateTabDirtyIndicator(tab.id, false);
        return true;
      } catch (err) {
        dialog.showErrorBox('Error saving file', err.message);
        return false;
      }
    } else {
      const defaultName = tab.title.endsWith('.md') ? tab.title : tab.title + '.md';
      const file = dialog.showSaveDialogSync({
        defaultPath: path.join(currentFolderPath || '', defaultName),
        filters: [{ name: "Markdown", extensions: ["md"] }],
        title: i18n.t('dialog_save')
      });
      if (!file) return false;
      try {
        fs.writeFileSync(file, tab.content, 'utf8');
        tab.filePath = file;
        tab.title = path.basename(file);
        tab.isDirty = false;
        if (tab.id === activeTabId) {
          currentFilePath = file;
          isDirty = false;
        }
        renderTabs();
        if (currentFolderPath && file.startsWith(currentFolderPath)) {
          openFolder(currentFolderPath);
        }
        return true;
      } catch (err) {
        dialog.showErrorBox('Error saving file', err.message);
        return false;
      }
    }
  }

  function saveCurrentFile() {
    const activeTab = getActiveTab();
    if (!activeTab) return false;
    return saveSpecificTab(activeTab);
  }

  function createNewFile() {
    createNewTab();
  }

  let isClosingTab = false;

  function closeTab(tabId) {
    if (isClosingTab) return false;
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return true;
    const tab = tabs[tabIndex];

    if (tab.id === activeTabId && editor) {
      tab.content = editor.value;
      if (isDirty) tab.isDirty = true;
    }

    // Safety check: if unsaved, prompt user
    if (tab.isDirty) {
      if (tab.id !== activeTabId) {
        switchToTab(tab.id);
      }

      const messageText = i18n.t('dialog_unsaved_tab_message', { name: tab.title }) ||
        `Do you want to save the changes you made to "${tab.title}"?`;

      const answer = dialog.showMessageBoxSync({
        type: 'question',
        buttons: [i18n.t('dialog_save'), i18n.t('dialog_dont_save'), i18n.t('dialog_cancel')],
        defaultId: 0,
        cancelId: 2,
        title: i18n.t('dialog_unsaved_title'),
        message: messageText
      });

      if (answer === 0) { // Save
        const saved = saveSpecificTab(tab);
        if (!saved) return false;
      } else if (answer === 1) { // Don't Save
        tab.isDirty = false;
      } else { // Cancel
        return false;
      }
    }

    isClosingTab = true;

    // Rimuovi immediatamente il tab dal DOM (feedback visivo a 0ms)
    const closedTabEl = document.querySelector(`.editor-tab[data-tab-id="${tabId}"]`);
    if (closedTabEl) {
      closedTabEl.remove();
    }

    if (getCollabState().isActive && tab.filePath === currentFilePath) {
      leaveCollaboration();
      const bCollab = document.getElementById("btn-collab");
      bCollab?.classList.remove("active-collab");
      const sContainer = document.getElementById("collab-status-container");
      sContainer?.classList.add("hidden");
      if (typeof updateCollabModalView === 'function') updateCollabModalView();
    }

    tabs.splice(tabIndex, 1);

    if (tab.id === activeTabId) {
      if (tabs.length > 0) {
        const nextIdx = Math.min(tabIndex, tabs.length - 1);
        activeTabId = null;
        const nextTab = tabs[nextIdx];
        const nextTabEl = document.querySelector(`.editor-tab[data-tab-id="${nextTab.id}"]`);
        if (nextTabEl) nextTabEl.classList.add('active');
        switchToTab(nextTab.id);
      } else {
        activeTabId = null;
        currentFilePath = null;
        isDirty = false;
        if (editor) editor.value = '';
        if (preview) preview.innerHTML = '';
        if (typeof stopTypewriterEffect === 'function') stopTypewriterEffect();
        renderTabs();
      }
    } else {
      renderTabs();
    }

    setTimeout(() => {
      isClosingTab = false;
    }, 60);

    return true;
  }

  // ====== EXPLORER SELECTION, ACTIONS & CONTEXT MENU ======
  let selectedExplorerPath = null;
  let selectedExplorerElement = null;
  let isRenamingInExplorer = false;

  function clearExplorerSelection() {
    if (selectedExplorerElement) {
      selectedExplorerElement.classList.remove('selected');
    }
    selectedExplorerPath = null;
    selectedExplorerElement = null;
  }

  function selectExplorerItem(itemPath, element) {
    if (selectedExplorerElement && selectedExplorerElement !== element) {
      selectedExplorerElement.classList.remove('selected');
    }
    selectedExplorerPath = itemPath;
    selectedExplorerElement = element;
    if (element) {
      element.classList.add('selected');
      if (element.tabIndex < 0) {
        element.tabIndex = -1;
      }
      try {
        element.focus();
      } catch (_) {}
    }
  }

  function showFileContextMenu(filePath, fileElement) {
    const { Menu, MenuItem } = require('@electron/remote');
    const menu = new Menu();
    const fileName = path.basename(filePath);
    const isDarwin = platform === 'darwin';

    menu.append(new MenuItem({
      label: i18n.t('ctx_open') || 'Open',
      click: () => {
        openFileInTab(filePath);
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: isDarwin ? (i18n.t('ctx_reveal_mac') || 'Reveal in Finder') : (i18n.t('ctx_reveal_win') || 'Reveal in File Explorer'),
      click: () => {
        shell.showItemInFolder(filePath);
      }
    }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_copy_content') || 'Copy Content',
      click: () => {
        try {
          let content = '';
          const openTab = tabs.find(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath));
          if (openTab && openTab.id === activeTabId && editor) {
            content = editor.value;
          } else if (openTab) {
            content = openTab.content;
          } else {
            content = fs.readFileSync(filePath, 'utf8');
          }
          clipboard.writeText(content);
          showNotification(i18n.t('notif_content_copied') || 'File content copied to clipboard', 'success');
        } catch (err) {
          dialog.showErrorBox('Error', err.message);
        }
      }
    }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_copy_path') || 'Copy Path',
      click: () => {
        clipboard.writeText(filePath);
        showNotification(i18n.t('notif_path_copied') || 'Path copied to clipboard', 'info');
      }
    }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_copy_rel_path') || 'Copy Relative Path',
      click: () => {
        const relPath = currentFolderPath ? path.relative(currentFolderPath, filePath) : fileName;
        clipboard.writeText(relPath);
        showNotification(i18n.t('notif_path_copied') || 'Path copied to clipboard', 'info');
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_rename') || 'Rename',
      accelerator: 'Enter',
      click: () => {
        startInlineRename(filePath, fileElement);
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_delete') || 'Move to Trash',
      accelerator: isDarwin ? 'Cmd+Backspace' : 'Delete',
      click: () => {
        deleteExplorerFile(filePath);
      }
    }));

    menu.popup();
  }

  function showFolderContextMenu(folderPath) {
    const { Menu, MenuItem } = require('@electron/remote');
    const menu = new Menu();
    const isDarwin = platform === 'darwin';

    menu.append(new MenuItem({
      label: isDarwin ? (i18n.t('ctx_reveal_mac') || 'Reveal in Finder') : (i18n.t('ctx_reveal_win') || 'Reveal in File Explorer'),
      click: () => {
        shell.showItemInFolder(folderPath);
      }
    }));

    menu.append(new MenuItem({
      label: i18n.t('ctx_copy_path') || 'Copy Path',
      click: () => {
        clipboard.writeText(folderPath);
        showNotification(i18n.t('notif_path_copied') || 'Path copied to clipboard', 'info');
      }
    }));

    menu.popup();
  }

  function startInlineRename(filePath, fileElement) {
    if (!filePath || !fileElement) return;

    // Se c'è già un input di rinomina aperto nel tree, ripuliscilo
    document.querySelectorAll('.tree-inline-input').forEach(existingInput => {
      const parent = existingInput.parentElement;
      existingInput.remove();
      if (parent) {
        const lbl = parent.querySelector('.tree-label');
        if (lbl) lbl.style.display = '';
      }
    });
    isRenamingInExplorer = false;

    const labelEl = fileElement.querySelector('.tree-label');
    if (!labelEl) return;

    isRenamingInExplorer = true;

    const currentName = path.basename(filePath);
    const ext = path.extname(currentName);
    const stem = path.basename(currentName, ext);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-inline-input';
    input.value = currentName;
    input.spellcheck = false;

    labelEl.style.display = 'none';
    fileElement.appendChild(input);
    input.focus();

    try {
      input.setSelectionRange(0, stem.length);
    } catch (_) {}

    let isFinished = false;
    let isCommitting = false;

    const cancel = () => {
      if (isFinished) return;
      isFinished = true;
      isRenamingInExplorer = false;
      input.remove();
      labelEl.style.display = '';
      if (fileElement) {
        try { fileElement.focus(); } catch (_) {}
      }
    };

    const commit = () => {
      if (isFinished || isCommitting) return;
      isCommitting = true;

      try {
        let newName = input.value.trim();
        if (!newName || newName === currentName) {
          cancel();
          return;
        }

        if (!newName.toLowerCase().endsWith('.md') && currentName.toLowerCase().endsWith('.md')) {
          if (newName.endsWith('.')) {
            newName = newName.slice(0, -1);
          }
          newName += '.md';
        }

        if (newName === currentName) {
          cancel();
          return;
        }

        if (/[\/\\:\*\?"<>\|]/.test(newName)) {
          dialog.showErrorBox(i18n.t('ctx_rename') || 'Rename', 'Invalid file name.');
          cancel();
          return;
        }

        const dir = path.dirname(filePath);
        const newPath = path.join(dir, newName);

        if (fs.existsSync(newPath) && path.resolve(newPath).toLowerCase() !== path.resolve(filePath).toLowerCase()) {
          dialog.showErrorBox(i18n.t('ctx_rename') || 'Rename', i18n.t('dialog_file_exists') || 'A file with this name already exists.');
          cancel();
          return;
        }

        try {
          fs.renameSync(filePath, newPath);
        } catch (err) {
          dialog.showErrorBox(i18n.t('ctx_rename') || 'Rename', err.message);
          cancel();
          return;
        }

        isFinished = true;
        isRenamingInExplorer = false;
        input.remove();

        tabs.forEach(t => {
          if (t.filePath && path.resolve(t.filePath) === path.resolve(filePath)) {
            t.filePath = newPath;
            t.title = newName;
            if (t.id === activeTabId) {
              currentFilePath = newPath;
            }
          }
        });
        renderTabs();

        if (currentFolderPath) {
          openFolder(currentFolderPath);
          setTimeout(() => {
            const newEl = document.querySelector(`.tree-item[data-path="${CSS.escape(newPath)}"]`);
            if (newEl) {
              selectExplorerItem(newPath, newEl);
            }
          }, 60);
        } else {
          labelEl.textContent = newName;
          labelEl.style.display = '';
          fileElement.title = newName;
          fileElement.dataset.path = newPath;
          selectExplorerItem(newPath, fileElement);
        }
      } finally {
        isCommitting = false;
      }
    };

    // Blocca la propagazione degli eventi del mouse affinché non interferiscano col fileElement genitore
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('mouseup', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
    input.addEventListener('contextmenu', (e) => e.stopPropagation());

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      if (!isFinished) {
        commit();
      }
    });
  }

  async function deleteExplorerFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    const fileName = path.basename(filePath);

    const answer = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: [i18n.t('dialog_move_to_trash') || 'Move to Trash', i18n.t('dialog_cancel') || 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      title: i18n.t('dialog_delete_title') || 'Move to Trash',
      message: i18n.t('dialog_delete_confirm', { name: fileName }) || `Are you sure you want to move "${fileName}" to Trash?`
    });

    if (answer !== 0) return;

    try {
      if (shell && typeof shell.trashItem === 'function') {
        await shell.trashItem(filePath);
      } else if (shell && typeof shell.moveItemToTrash === 'function') {
        shell.moveItemToTrash(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      dialog.showErrorBox(i18n.t('dialog_delete_title') || 'Error', err.message);
      return;
    }

    const openTabs = tabs.filter(t => t.filePath && path.resolve(t.filePath) === path.resolve(filePath));
    for (const t of openTabs) {
      t.isDirty = false;
      closeTab(t.id);
    }

    clearExplorerSelection();
    showNotification(i18n.t('notif_item_deleted', { name: fileName }) || `"${fileName}" moved to Trash`, 'info');

    if (currentFolderPath) {
      openFolder(currentFolderPath);
    }
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
          folderHeader.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showFolderContextMenu(itemPath);
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
          fileElement.tabIndex = -1;
          fileElement.innerHTML = `
            <span class="tree-file-icon">${FILE_SVG}</span>
            <span class="tree-label">${item}</span>
          `;
          fileElement.addEventListener('click', (e) => {
            selectExplorerItem(itemPath, fileElement);
            openFileInTab(itemPath);
          });
          fileElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectExplorerItem(itemPath, fileElement);
            showFileContextMenu(itemPath, fileElement);
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

    if (editor) {
      editor.placeholder = '';
      if (editor.value.length === 0 && typeof startTypewriterEffect === 'function' && !isReadingMode) {
        startTypewriterEffect();
      }
    }

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

  window.addEventListener('beforeunload', (e) => {
    if (typeof saveStateForActiveTab === 'function') {
      saveStateForActiveTab();
    }
    const dirtyTabs = tabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
      for (const t of dirtyTabs) {
        switchToTab(t.id);
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: [i18n.t('dialog_save'), i18n.t('dialog_dont_save'), i18n.t('dialog_cancel')],
          defaultId: 0,
          cancelId: 2,
          title: i18n.t('dialog_unsaved_title'),
          message: i18n.t('dialog_unsaved_tab_message', { name: t.title }) || `Do you want to save the changes you made to "${t.title}"?`
        });
        if (choice === 0) {
          const saved = saveSpecificTab(t);
          if (!saved) {
            e.preventDefault();
            e.returnValue = false;
            return false;
          }
        } else if (choice === 2) {
          e.preventDefault();
          e.returnValue = false;
          return false;
        }
      }
    }
    if (getCollabState().isActive) {
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
      if (currentCalloutPicker) {
        closeCalloutColorPicker();
        e.preventDefault();
        return;
      }
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
    if (editor && editor.value.length === 0 && typeof startTypewriterEffect === 'function') {
      startTypewriterEffect();
    }
  });

  btnViewSplit && btnViewSplit.addEventListener("click", () => {
    if (container) container.className = "split-view";
    refreshSearchIfOpen();
    if (editor && editor.value.length === 0 && typeof startTypewriterEffect === 'function') {
      startTypewriterEffect();
    }
    setTimeout(() => {
      if (typeof buildScrollMap === 'function') {
        buildScrollMap();
        if (autoscrollEnabled && preview && editor) {
          preview.scrollTop = getPreviewScrollForEditor(editor.scrollTop);
        }
      }
    }, 350);
  });

  btnViewPreview && btnViewPreview.addEventListener("click", () => {
    if (container) container.className = "solo-preview";
    refreshSearchIfOpen();
    if (typeof stopTypewriterEffect === 'function') {
      stopTypewriterEffect();
    }
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

  // ===== EMPTY STATE & SHORTCUTS SETUP =====
  const kbdNew = document.getElementById('kbd-new-file');
  const kbdOpen = document.getElementById('kbd-open-file');
  const kbdFolder = document.getElementById('kbd-open-folder');
  if (kbdNew) kbdNew.textContent = isMac ? '⌘ N' : 'Ctrl + N';
  if (kbdOpen) kbdOpen.textContent = isMac ? '⌘ O' : 'Ctrl + O';
  if (kbdFolder) kbdFolder.textContent = isMac ? '⇧ ⌘ O' : 'Ctrl + Shift + O';

  btnNewTab && btnNewTab.addEventListener("click", () => createNewTab());
  emptyBtnNewFile && emptyBtnNewFile.addEventListener("click", () => createNewTab());
  emptyBtnOpenFile && emptyBtnOpenFile.addEventListener("click", async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (!result.canceled && result.filePaths.length > 0) {
      for (const fp of result.filePaths) {
        openFileInTab(fp);
      }
    }
  });
  emptyBtnOpenFolder && emptyBtnOpenFolder.addEventListener("click", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (!result.canceled && result.filePaths.length > 0) openFolder(result.filePaths[0]);
  });

  // Keyboard shortcut Cmd+W / Ctrl+W to close active tab
  document.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (isCmdOrCtrl && e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (activeTabId && typeof closeTab === 'function') {
        closeTab(activeTabId);
      }
    }
  });

  // Explorer keyboard shortcuts: Rename (Enter / F2) and Delete (Cmd+Backspace on Mac, Delete on Win/Linux)
  document.addEventListener('keydown', (e) => {
    if (isRenamingInExplorer) return;

    const activeEl = document.activeElement;
    const tag = activeEl ? activeEl.tagName : '';
    if (['TEXTAREA', 'INPUT', 'BUTTON', 'SELECT'].includes(tag) || activeEl?.isContentEditable) {
      return;
    }

    if (document.querySelector('.modal:not(.hidden)')) {
      return;
    }

    if (!selectedExplorerPath || !selectedExplorerElement) {
      return;
    }

    const isExplorerFocused =
      document.activeElement === selectedExplorerElement ||
      document.getElementById('explorer-panel')?.contains(document.activeElement) ||
      document.activeElement === document.body;

    if (!isExplorerFocused) {
      return;
    }

    // Rename (Enter or F2)
    if ((e.key === 'Enter' || e.key === 'F2') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      startInlineRename(selectedExplorerPath, selectedExplorerElement);
      return;
    }

    // Delete (Cmd+Backspace/Cmd+Delete on Mac, Delete/Canc on Win/Linux)
    const isDarwin = platform === 'darwin';
    const isDelete = isDarwin
      ? (e.metaKey && (e.key === 'Backspace' || e.key === 'Delete'))
      : (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Delete');

    if (isDelete) {
      e.preventDefault();
      deleteExplorerFile(selectedExplorerPath);
      return;
    }
  });

  // Initial startup: if no file or folder has been opened after brief delay, create initial tab
  setTimeout(() => {
    if (tabs.length === 0 && !currentFolderPath) {
      createNewTab();
    } else if (tabs.length === 0) {
      renderTabs();
    }
  }, 120);

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
