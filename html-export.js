// ====== MARK HTML EXPORT MODULE ======
const path = require('path');
const fs = require('fs');

// Module-level caches for offline assets
const fontBase64Cache = {};
let katexCssCache = null;

function getLocalFontBase64(subfolder, filename) {
  const key = `${subfolder}/${filename}`;
  if (fontBase64Cache[key]) {
    return fontBase64Cache[key];
  }
  try {
    const fullPath = path.join(__dirname, 'fonts', subfolder, filename);
    if (fs.existsSync(fullPath)) {
      const data = fs.readFileSync(fullPath).toString('base64');
      fontBase64Cache[key] = data;
      return data;
    }
  } catch (err) {
    console.error(`[html-export] Error reading local font ${key}:`, err);
  }
  return null;
}

function getLocalKatexAssets() {
  if (katexCssCache !== null) return katexCssCache;
  try {
    let css = '';
    const minCssPath = path.join(__dirname, 'api', 'katex.min.css');
    const fontsCssPath = path.join(__dirname, 'api', 'katex-fonts.css');
    if (fs.existsSync(minCssPath)) {
      css += fs.readFileSync(minCssPath, 'utf8') + '\n';
    }
    if (fs.existsSync(fontsCssPath)) {
      css += fs.readFileSync(fontsCssPath, 'utf8') + '\n';
    }
    katexCssCache = css;
    return katexCssCache;
  } catch (err) {
    console.error('[html-export] Error reading local KaTeX assets:', err);
    katexCssCache = '';
    return '';
  }
}

/**
 * Escapes HTML characters.
 */
function escapeHtml(s) {
  if (typeof s !== 'string') return String(s || '');
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/**
 * Generates a full standalone HTML page with:
 * - Minimalist monochrome aesthetic inspired by mark website
 * - Table of contents on the left with hierarchy and scroll-spy (if enabled)
 * - Ability to toggle/hide the TOC sidebar and center the preview document
 * - Clean floating controls (Theme toggle & TOC toggle) with no fixed header bar
 * - Preview markdown formatting, math, syntax highlighting
 * - Interactive code copy buttons
 * - Offline-first embedded fonts (Inter, JetBrains Mono)
 * - Footer with link to Mark on GitHub ("Made with Mark")
 * 
 * @param {Object} options
 * @param {string} options.filename - Name of the file being exported (e.g. document.md)
 * @param {string} options.bodyHtml - Rendered HTML content
 * @param {Array<{id: string, level: number, text: string}>} options.headings - List of extracted headings
 * @param {string} options.theme - 'light' or 'dark'
 * @param {string} options.lang - 'en' or 'it'
 * @param {string} options.font - 'inter' or 'jetbrains'
 * @param {number|string} options.fontSize - font size in px (e.g. 16)
 * @param {string} options.textAlign - 'left' or 'justify'
 * @param {boolean} options.includeToc - whether to include the table of contents
 * @param {boolean} options.isForPreview - whether this HTML is rendered in the in-app desktop preview
 * @returns {string} Standalone HTML document
 */
function buildExportHtml({
  filename = 'document.md',
  bodyHtml = '',
  headings = [],
  theme = 'dark',
  lang = 'en',
  font = 'inter',
  fontSize = 16,
  textAlign = 'left',
  includeToc = true,
  isForPreview = false
}) {
  const isIt = lang === 'it';
  const tocTitle = isIt ? 'Indice' : 'Contents';

  // Title: Clean filename without .md followed by " - Mark"
  const cleanName = (filename || 'document').replace(/\.md$/i, '');
  const pageTitle = `${cleanName} - Mark`;

  // Offline-first Font Resolution & Embedding
  const isJetBrains = (font === 'jetbrains');
  const jetbrainsB64 = getLocalFontBase64('jetbrains', 'JetBrainsMono-Regular.ttf');
  const interRegB64 = !isJetBrains ? getLocalFontBase64('inter', 'Inter-Regular.ttf') : null;
  const interSemiB64 = !isJetBrains ? getLocalFontBase64('inter', 'Inter-SemiBold.ttf') : null;

  let localFontFaceCss = '';
  if (isJetBrains) {
    if (jetbrainsB64) {
      localFontFaceCss = `
    @font-face {
      font-family: 'JetBrains Mono';
      src: url('data:font/truetype;charset=utf-8;base64,${jetbrainsB64}') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }`;
    }
  } else {
    if (interRegB64) {
      localFontFaceCss += `
    @font-face {
      font-family: 'Inter';
      src: url('data:font/truetype;charset=utf-8;base64,${interRegB64}') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }`;
    }
    if (interSemiB64) {
      localFontFaceCss += `
    @font-face {
      font-family: 'Inter';
      src: url('data:font/truetype;charset=utf-8;base64,${interSemiB64}') format('truetype');
      font-weight: 600 800;
      font-style: normal;
      font-display: swap;
    }`;
    }
    if (jetbrainsB64) {
      localFontFaceCss += `
    @font-face {
      font-family: 'JetBrains Mono';
      src: url('data:font/truetype;charset=utf-8;base64,${jetbrainsB64}') format('truetype');
      font-weight: 400 700;
      font-style: normal;
      font-display: swap;
    }`;
    }
  }

  const fontFamilyCss = isJetBrains
    ? `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
    : `'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  const fontMonoCss = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

  // Local KaTeX CSS if math formulas are present (100% offline)
  const hasMath = bodyHtml && (bodyHtml.includes('katex') || bodyHtml.includes('class="math'));
  const localKatexCss = hasMath ? getLocalKatexAssets() : '';

  const parsedFontSize = parseInt(fontSize, 10) || 16;
  const alignment = (textAlign === 'justify') ? 'justify' : 'left';

  // Build Table of Contents navigation items if TOC is included
  let tocItemsHtml = '';
  if (includeToc) {
    if (headings.length > 0) {
      tocItemsHtml = headings.map((h, i) => {
        const activeClass = i === 0 ? ' active' : '';
        return `<li><a href="#${escapeHtml(h.id)}" class="docs-menu-item${activeClass}" data-level="${h.level}" title="${escapeHtml(h.text)}">${escapeHtml(h.text)}</a></li>`;
      }).join('\n        ');
    } else {
      tocItemsHtml = `<li class="toc-empty">${isIt ? 'Nessun titolo presente' : 'No headings found'}</li>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  
  <style>
    /* ==========================================================================
       Mark Export — Offline-First Minimalist Monochrome Design
       ========================================================================== */

    /* Embedded Local Fonts (Offline) */
    ${localFontFaceCss}

    /* Embedded KaTeX Styles (Offline) */
    ${localKatexCss}

    :root {
      --bg: #000000;
      --bg-subtle: #0d0d0d;
      --bg-card: #0a0a0a;
      --bg-hover: #141414;
      
      --text-primary: #ffffff;
      --text-secondary: #a3a3a3;
      --text-muted: #666666;
      
      --border: #222222;
      --border-subtle: #181818;
      --border-hover: #ffffff;
      
      --accent-active: #ffffff;
      --accent-active-text: #000000;
      
      --font: ${fontFamilyCss};
      --font-mono: ${fontMonoCss};
      --font-size-base: ${parsedFontSize}px;
      
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --radius-full: 9999px;
      
      --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.5);
      --shadow-md: 0 12px 30px -10px rgba(0, 0, 0, 0.7);

      --code-bg: #0d0d0d;
      --code-text: #f0f0f0;
      --code-inline-bg: #161616;

      --btn-bg: rgba(17, 17, 17, 0.85);
      --btn-hover: #1c1c1c;

      --link-color: #3b82f6;
      --link-color-hover: #60a5fa;
    }

    body:not(.dark) {
      --bg: #ffffff;
      --bg-subtle: #f8f9fa;
      --bg-card: #ffffff;
      --bg-hover: #f1f3f5;
      
      --text-primary: #111111;
      --text-secondary: #4b5563;
      --text-muted: #888888;
      
      --border: #e5e7eb;
      --border-subtle: #f0f2f5;
      --border-hover: #000000;
      
      --accent-active: #000000;
      --accent-active-text: #ffffff;

      --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);

      --code-bg: #f8f9fa;
      --code-text: #1f2328;
      --code-inline-bg: #f3f4f6;

      --btn-bg: rgba(243, 244, 246, 0.88);
      --btn-hover: #e5e7eb;

      --link-color: #007bff;
      --link-color-hover: #0056b3;
    }

    body.dark {
      --bg: #000000;
      --bg-subtle: #0d0d0d;
      --bg-card: #0a0a0a;
      --bg-hover: #141414;
      --text-primary: #ffffff;
      --text-secondary: #a3a3a3;
      --text-muted: #666666;
      --border: #222222;
      --border-subtle: #181818;
      --border-hover: #ffffff;
      --accent-active: #ffffff;
      --accent-active-text: #000000;
      --code-bg: #0d0d0d;
      --code-text: #f0f0f0;
      --code-inline-bg: #161616;
      --btn-bg: rgba(17, 17, 17, 0.85);
      --btn-hover: #1c1c1c;
      --link-color: #3b82f6;
      --link-color-hover: #60a5fa;
    }

    /* Reset & Base */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
      font-size: 16px;
      background-color: var(--bg);
    }

    body {
      font-family: var(--font);
      background-color: var(--bg);
      color: var(--text-primary);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      letter-spacing: -0.015em;
      overflow-x: hidden;
      width: 100%;
      min-height: 100vh;
      transition: background-color 0.25s ease, color 0.25s ease;
    }

    ::selection {
      background: var(--accent-active);
      color: var(--accent-active-text);
    }

    /* ====== FLOATING CONTROLS (TOP-RIGHT: THEME ONLY) ====== */
    .floating-controls {
      position: fixed;
      top: 18px;
      right: 22px;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ====== LEFT FLOATING TOC SPAWN BUTTON ====== */
    .btn-toc-spawn {
      position: fixed;
      top: 18px;
      left: 22px;
      z-index: 100;
      width: 36px;
      height: 36px;
      display: none;
      align-items: center;
      justify-content: center;
      background: var(--btn-bg);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: var(--radius-full);
      cursor: pointer;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
      padding: 0;
      user-select: none;
    }

    .btn-toc-spawn:hover {
      color: var(--text-primary);
      border-color: var(--border-hover);
      background: var(--btn-hover);
      transform: scale(1.05);
    }

    body.toc-hidden .btn-toc-spawn {
      display: inline-flex;
    }

    .btn-floating-icon {
      background: var(--btn-bg);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      border-radius: var(--radius-full);
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
      padding: 0;
      user-select: none;
    }

    .btn-floating-icon:hover {
      color: var(--text-primary);
      border-color: var(--border-hover);
      background: var(--btn-hover);
      transform: scale(1.05);
    }

    /* ====== CONTAINER & DOCS LAYOUT ====== */
    .container-doc-page {
      max-width: ${includeToc ? '1160px' : '860px'};
      margin: 0 auto;
      padding: 0 28px;
      width: 100%;
      box-sizing: border-box;
      transition: max-width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .docs-layout {
      ${includeToc ? `display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px;` : `display: block; max-width: 860px; margin: 0 auto;`}
      padding-top: 48px;
      padding-bottom: 60px;
      min-height: 100vh;
      box-sizing: border-box;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* ====== WHEN TOC IS HIDDEN: CENTER PREVIEW IN THE MIDDLE ====== */
    body.toc-hidden .container-doc-page {
      max-width: 860px;
    }

    body.toc-hidden .docs-layout {
      grid-template-columns: 100%;
      gap: 0;
    }

    body.toc-hidden .docs-sidebar {
      display: none !important;
    }

    body.toc-hidden .docs-main {
      width: 100%;
      max-width: 820px;
      margin: 0 auto;
    }

    /* ====== LEFT TOC SIDEBAR ====== */
    .docs-sidebar {
      position: sticky;
      top: 36px;
      height: fit-content;
      max-height: calc(100vh - 60px);
      overflow-y: auto;
      padding-right: 10px;
      box-sizing: border-box;
    }

    .docs-sidebar::-webkit-scrollbar {
      width: 4px;
    }
    .docs-sidebar::-webkit-scrollbar-thumb {
      background: var(--border);
      border-radius: 4px;
    }

    .docs-sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding: 0 4px;
    }

    .docs-menu-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      font-weight: 700;
    }

    .sidebar-close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .sidebar-close-btn:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .docs-menu {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .docs-menu li {
      margin-bottom: 4px;
    }

    .docs-menu-item {
      font-size: 0.88rem;
      color: var(--text-secondary);
      display: block;
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      border-left: 2px solid transparent;
      font-weight: 500;
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .docs-menu-item:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .docs-menu-item.active {
      color: var(--accent-active-text) !important;
      background: var(--accent-active) !important;
      font-weight: 700 !important;
      border-left-color: var(--accent-active) !important;
      box-shadow: var(--shadow-sm);
      transform: translateX(3px);
    }

    /* Hierarchical indentations */
    .docs-menu-item[data-level="1"] {
      padding-left: 10px;
      font-weight: 600;
    }
    .docs-menu-item[data-level="2"] {
      padding-left: 20px;
    }
    .docs-menu-item[data-level="3"] {
      padding-left: 30px;
      font-size: 0.84rem;
    }
    .docs-menu-item[data-level="4"] {
      padding-left: 40px;
      font-size: 0.80rem;
    }
    .docs-menu-item[data-level="5"] {
      padding-left: 50px;
      font-size: 0.78rem;
    }
    .docs-menu-item[data-level="6"] {
      padding-left: 58px;
      font-size: 0.76rem;
    }

    .toc-empty {
      font-size: 0.84rem;
      color: var(--text-muted);
      font-style: italic;
      padding: 8px 10px;
    }

    /* ====== MAIN CONTENT & MARKDOWN TYPOGRAPHY ====== */
    .docs-main {
      min-width: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
    }

    .markdown-body {
      font-family: var(--font);
      color: var(--text-secondary);
      font-size: var(--font-size-base, 16px);
      line-height: 1.65;
      width: 100%;
      word-wrap: break-word;
      overflow-wrap: break-word;
      word-break: break-word;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body pre,
    .markdown-body code,
    .markdown-body table {
      text-align: left;
    }

    .markdown-body h1,
    .markdown-body h2,
    .markdown-body h3,
    .markdown-body h4,
    .markdown-body h5,
    .markdown-body h6 {
      color: var(--text-primary);
      line-height: 1.25;
      scroll-margin-top: 84px;
      text-align: left;
    }

    .markdown-body h1 {
      font-size: 2.1em;
      font-weight: 800;
      letter-spacing: -0.035em;
      margin-top: 10px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }

    .markdown-body h2 {
      font-size: 1.5em;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-top: 38px;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }

    .markdown-body h3 {
      font-size: 1.25em;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-top: 30px;
      margin-bottom: 14px;
    }

    .markdown-body h4 {
      font-size: 1.1em;
      font-weight: 600;
      margin-top: 24px;
      margin-bottom: 10px;
    }

    .markdown-body h5,
    .markdown-body h6 {
      font-size: 1em;
      font-weight: 600;
      color: var(--text-muted);
      margin-top: 20px;
      margin-bottom: 8px;
    }

    .markdown-body p {
      color: var(--text-secondary);
      font-size: inherit;
      line-height: 1.65;
      margin-top: 0;
      margin-bottom: 18px;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body strong,
    .markdown-body b {
      color: var(--text-primary);
      font-weight: 600;
    }

    .markdown-body em,
    .markdown-body i {
      color: var(--text-secondary);
    }

    .markdown-body a {
      color: var(--link-color);
      text-decoration: underline;
      text-underline-offset: 3px;
      transition: color 0.15s ease;
    }
    .markdown-body a:hover {
      color: var(--link-color-hover);
    }

    .markdown-body hr {
      height: 1px;
      background: var(--border);
      border: none;
      margin: 36px 0;
    }

    .markdown-body blockquote {
      background: var(--bg-card);
      border-left: 3px solid var(--text-primary);
      padding: 14px 18px;
      font-size: 0.95em;
      color: var(--text-secondary);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      margin: 0 0 18px 0;
      line-height: 1.6;
      border-top: 1px solid var(--border);
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      font-style: normal;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body blockquote p {
      font-size: inherit;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body blockquote p:last-child {
      margin-bottom: 0;
    }

    /* Callout / Alert Blockquotes */
    .markdown-body blockquote.callout-alert {
      position: relative;
      background-color: var(--callout-bg, rgba(16, 185, 129, 0.06));
      border-left: 4px solid var(--callout-color, #10b981) !important;
      border-top: 1px solid var(--callout-border, rgba(16, 185, 129, 0.22));
      border-right: 1px solid var(--callout-border, rgba(16, 185, 129, 0.22));
      border-bottom: 1px solid var(--callout-border, rgba(16, 185, 129, 0.22));
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      padding: 14px 18px;
      margin: 18px 0 22px 0;
      color: var(--text-primary);
      font-style: normal;
    }

    .markdown-body .callout-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 0.95em;
      letter-spacing: 0.3px;
      margin-bottom: 8px;
      color: var(--callout-color, #10b981);
    }

    .markdown-body .callout-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .markdown-body .callout-icon svg {
      width: 16px;
      height: 16px;
    }

    .markdown-body .callout-title {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      font-size: 0.9em;
    }

    .markdown-body .callout-content {
      color: var(--text-secondary);
      line-height: 1.6;
      font-size: inherit;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body .callout-content p {
      margin: 0 0 8px 0;
      font-size: inherit;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body .callout-content p:last-child {
      margin-bottom: 0;
    }

    .markdown-body ul,
    .markdown-body ol {
      padding-left: 24px;
      margin-bottom: 18px;
      color: var(--text-secondary);
      font-size: inherit;
    }

    .markdown-body li {
      margin-bottom: 6px;
      line-height: 1.65;
      font-size: inherit;
      text-align: ${alignment};
      ${alignment === 'justify' ? 'text-justify: inter-word; -webkit-hyphens: auto; hyphens: auto;' : 'text-justify: auto; -webkit-hyphens: manual; hyphens: manual;'}
    }

    .markdown-body li::marker {
      color: var(--text-muted);
    }

    /* Image styling */
    .markdown-body img:not(.badge-img) {
      max-width: 100%;
      height: auto;
      display: block;
      margin: 24px auto;
      border-radius: var(--radius-md);
      border: 1px solid var(--border);
    }

    .markdown-body img.img-small,
    .markdown-body img[data-size="small"] {
      width: 25% !important;
      max-width: 25% !important;
      height: auto !important;
      display: block !important;
      margin: 24px auto !important;
    }

    .markdown-body img.img-medium,
    .markdown-body img[data-size="medium"] {
      width: 50% !important;
      max-width: 50% !important;
      height: auto !important;
      display: block !important;
      margin: 24px auto !important;
    }

    .markdown-body img.img-large,
    .markdown-body img[data-size="large"] {
      width: 75% !important;
      max-width: 75% !important;
      height: auto !important;
      display: block !important;
      margin: 24px auto !important;
    }

    .markdown-body img.img-full,
    .markdown-body img[data-size="full"] {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      margin: 24px auto !important;
    }

    .markdown-body img.badge-img {
      display: inline-block !important;
      vertical-align: middle !important;
      margin: 2px 3px !important;
      max-width: 100% !important;
      width: auto !important;
      height: auto !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    .markdown-body a.badge-link,
    .markdown-body a:has(> img.badge-img) {
      display: inline-block !important;
      vertical-align: middle !important;
      line-height: 1 !important;
      text-decoration: none !important;
      margin: 2px 2px !important;
    }

    .markdown-body p.badge-paragraph {
      display: flex !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 4px 6px !important;
      margin: 0.5rem 0 !important;
      line-height: normal !important;
    }

    .markdown-body [align="center"] p.badge-paragraph,
    .markdown-body div[align="center"] p.badge-paragraph {
      justify-content: center !important;
    }

    /* ====== CODE & SYNTAX HIGHLIGHTING ====== */
    .markdown-body pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 18px;
      font-family: var(--font-mono);
      font-size: 0.88em;
      line-height: 1.55;
      color: var(--code-text);
      margin-bottom: 22px;
      overflow-x: auto;
      position: relative;
      text-align: left;
    }

    .markdown-body code {
      font-family: var(--font-mono);
      font-size: 0.86em;
      background: var(--code-inline-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 7px;
      color: var(--text-primary);
    }

    .markdown-body pre code {
      background: transparent;
      border: none;
      padding: 0;
      color: inherit;
      font-size: inherit;
      display: block;
      overflow-x: auto;
    }

    /* Interactive Code Copy Button */
    .code-copy-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 30px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--btn-bg);
      color: var(--text-secondary);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      cursor: pointer;
      opacity: 0;
      transition: all 0.2s ease;
      z-index: 5;
      padding: 0;
      user-select: none;
    }

    .markdown-body pre:hover .code-copy-btn {
      opacity: 0.85;
    }

    .code-copy-btn:hover {
      opacity: 1 !important;
      color: var(--text-primary);
      border-color: var(--border-hover);
      background: var(--btn-hover);
    }

    .code-copy-btn.copied {
      color: #10b981 !important;
      border-color: #10b981 !important;
    }

    /* Syntax Highlighting - Light Theme */
    .hljs,
    body:not(.dark) .hljs {
      color: #24292e;
      background: transparent;
    }
    .hljs-comment, .hljs-punctuation { color: #6a737d; font-style: italic; }
    .hljs-keyword, .hljs-selector-tag, .hljs-subst { color: #d73a49; font-weight: 600; }
    .hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-attr, .hljs-literal, .hljs-template-tag, .hljs-template-variable, .hljs-type { color: #032f62; }
    .hljs-variable, .hljs-title.class_, .hljs-title.function_, .hljs-property { color: #6f42c1; }
    .hljs-number { color: #005cc5; }
    .hljs-meta, .hljs-built_in { color: #e36209; }
    .hljs-tag, .hljs-name { color: #22863a; }
    .hljs-deletion { color: #b31d28; background-color: #ffeef0; }
    .hljs-addition { color: #22863a; background-color: #f0fff4; }

    /* Syntax Highlighting - Dark Theme */
    body.dark .hljs {
      color: #c9d1d9;
    }
    body.dark .hljs-comment, body.dark .hljs-punctuation { color: #8b949e; font-style: italic; }
    body.dark .hljs-keyword, body.dark .hljs-selector-tag, body.dark .hljs-subst { color: #ff7b72; font-weight: 600; }
    body.dark .hljs-string, body.dark .hljs-title, body.dark .hljs-section, body.dark .hljs-attribute, body.dark .hljs-attr, body.dark .hljs-literal, body.dark .hljs-template-tag, body.dark .hljs-template-variable, body.dark .hljs-type { color: #a5d6ff; }
    body.dark .hljs-variable, body.dark .hljs-title.class_, body.dark .hljs-title.function_, body.dark .hljs-property { color: #d2a8ff; }
    body.dark .hljs-number { color: #79c0ff; }
    body.dark .hljs-meta, body.dark .hljs-built_in { color: #ffa657; }
    body.dark .hljs-tag, body.dark .hljs-name { color: #7ee787; }
    body.dark .hljs-deletion { color: #ffdcd7; background-color: #67060c; }
    body.dark .hljs-addition { color: #aff5b4; background-color: #033a16; }

    /* ====== TABLES ====== */
    .markdown-body table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9em;
      margin-bottom: 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      display: table;
    }

    .markdown-body th,
    .markdown-body td {
      padding: 11px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    .markdown-body th {
      background: var(--bg-card);
      font-weight: 700;
      color: var(--text-primary);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .markdown-body td {
      color: var(--text-secondary);
    }

    .markdown-body tr:last-child td {
      border-bottom: none;
    }

    /* ====== TASK LISTS ====== */
    .markdown-body .task-list-item {
      list-style-type: none;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .markdown-body input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      border: 1.5px solid var(--text-muted);
      border-radius: 4px;
      outline: none;
      background-color: var(--bg-card);
      cursor: default;
      vertical-align: -2px;
      position: relative;
      flex-shrink: 0;
    }

    .markdown-body input[type="checkbox"]:checked {
      background-color: var(--accent-active);
      border-color: var(--accent-active);
    }

    .markdown-body input[type="checkbox"]:checked::after {
      content: "";
      position: absolute;
      left: 4.5px;
      top: 1.5px;
      width: 4px;
      height: 8px;
      border: solid var(--accent-active-text);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }

    /* KaTeX & Mermaid */
    .katex { color: var(--text-primary); }
    .katex-display { margin: 1.5em 0; overflow-x: auto; overflow-y: hidden; }
    .mermaid { text-align: center; margin: 1.5em 0; }

    /* ====== FOOTER ====== */
    .export-footer {
      border-top: 1px solid var(--border);
      margin-top: 52px;
      padding: 22px 0 18px 0;
      font-size: 0.72rem;
      color: var(--text-muted);
      width: 100%;
      letter-spacing: 0.2px;
    }

    .footer-inner {
      text-align: center;
      user-select: none;
    }

    .mark-footer-link {
      color: var(--link-color);
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 2.5px;
      transition: color 0.15s ease;
    }

    .mark-footer-link:hover {
      color: var(--link-color-hover);
    }

    ${isForPreview ? `
    /* ====== FORCED DESKTOP LAYOUT (IN-APP PREVIEW) ====== */
    .container-doc-page {
      max-width: 100% !important;
      padding: 0 20px !important;
    }

    .docs-layout {
      ${includeToc ? `display: grid !important; grid-template-columns: 210px minmax(0, 1fr) !important; gap: 28px !important;` : `display: block !important; max-width: 820px !important; margin: 0 auto !important;`}
      padding-top: 24px !important;
      padding-bottom: 40px !important;
    }

    .docs-sidebar {
      display: block !important;
      position: sticky !important;
      top: 20px !important;
      width: 210px !important;
      max-height: calc(100vh - 40px) !important;
      flex-shrink: 0 !important;
    }

    .docs-main {
      min-width: 0 !important;
      width: 100% !important;
    }

    body.toc-hidden .docs-sidebar {
      display: none !important;
    }

    body.toc-hidden .docs-layout {
      grid-template-columns: 100% !important;
      gap: 0 !important;
    }

    body.toc-hidden .btn-toc-spawn {
      display: inline-flex !important;
    }

    body.toc-hidden .docs-main {
      max-width: 820px !important;
      margin: 0 auto !important;
    }
    ` : `
    /* ====== RESPONSIVE ENHANCEMENTS (STANDALONE EXPORT) ====== */
    @media (max-width: 768px) {
      .container-doc-page {
        padding: 0 18px;
      }
      .docs-layout {
        grid-template-columns: 100%;
        gap: 24px;
        padding-top: 20px;
      }
      .docs-sidebar {
        display: none;
      }
      .btn-toc-spawn {
        display: inline-flex;
      }
      body.toc-mobile-open .btn-toc-spawn {
        display: none !important;
      }
      body.toc-mobile-open .docs-sidebar {
        display: block !important;
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: 280px;
        max-width: 85vw;
        background: var(--bg);
        border-right: 1px solid var(--border);
        box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
        z-index: 150;
        padding: 24px 20px;
      }
      .markdown-body h1 { font-size: 1.85rem; }
      .markdown-body h2 { font-size: 1.35rem; }
      .markdown-body pre { font-size: 0.82rem; padding: 14px; }
      .markdown-body table th, .markdown-body table td { padding: 9px 12px; font-size: 0.82rem; }
    }
    `}

    @media print {
      .heading-keep-group {
        display: block !important;
        margin: 0 !important;
        padding: 0 !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      h1, h2, h3, h4, h5, h6 {
        break-after: avoid-page !important;
        break-after: avoid !important;
        page-break-after: avoid !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      h1 + *, h2 + *, h3 + *, h4 + *, h5 + *, h6 + * {
        break-before: avoid-page !important;
        break-before: avoid !important;
        page-break-before: avoid !important;
      }

      h1 + ul > li:first-child, h2 + ul > li:first-child, h3 + ul > li:first-child,
      h4 + ul > li:first-child, h5 + ul > li:first-child, h6 + ul > li:first-child,
      h1 + ol > li:first-child, h2 + ol > li:first-child, h3 + ol > li:first-child,
      h4 + ol > li:first-child, h5 + ol > li:first-child, h6 + ol > li:first-child,
      h1 + ul > li:nth-child(2), h2 + ul > li:nth-child(2), h3 + ul > li:nth-child(2),
      h4 + ul > li:nth-child(2), h5 + ul > li:nth-child(2), h6 + ul > li:nth-child(2),
      h1 + ol > li:nth-child(2), h2 + ol > li:nth-child(2), h3 + ol > li:nth-child(2),
      h4 + ol > li:nth-child(2), h5 + ol > li:nth-child(2), h6 + ol > li:nth-child(2) {
        break-before: avoid !important;
        page-break-before: avoid !important;
      }

      p, li, blockquote, dd, dt {
        orphans: 3 !important;
        widows: 3 !important;
      }

      .table-of-contents-sidebar,
      .toc-floating-spawn-btn,
      .floating-controls {
        display: none !important;
      }
    }
  </style>
</head>
<body class="${theme === 'dark' ? 'dark' : ''}${isForPreview ? ' html-preview-mode' : ''}">

  ${includeToc ? `
  <!-- LEFT FLOATING TOC SPAWN BUTTON (APPEARS WHEN TOC IS CLOSED) -->
  <button id="toc-open-btn" class="btn-toc-spawn" type="button" title="${isIt ? 'Mostra indice' : 'Show Table of Contents'}" aria-label="Show Table of Contents">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="9" y1="3" x2="9" y2="21"></line>
    </svg>
  </button>
  ` : ''}

  <!-- FLOATING CONTROLS (TOP-RIGHT: THEME ONLY) -->
  <div class="floating-controls">
    <!-- Toggle Theme Button -->
    <button id="theme-toggle-btn" class="btn-floating-icon" type="button" title="${isIt ? 'Cambia tema' : 'Toggle Theme'}" aria-label="Toggle Theme">
      <!-- Sun icon (shown in dark mode) -->
      <svg id="sun-icon" style="display:${theme === 'dark' ? 'block' : 'none'};" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <!-- Moon icon (shown in light mode) -->
      <svg id="moon-icon" style="display:${theme === 'dark' ? 'none' : 'block'};" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </button>
  </div>

  <!-- CONTAINER & DOCUMENTATION LAYOUT -->
  <div class="container-doc-page">
    <div class="docs-layout" id="docs-layout">
      
      ${includeToc ? `
      <!-- LEFT SIDEBAR TOC -->
      <aside class="docs-sidebar" id="docs-sidebar">
        <div class="docs-sidebar-header">
          <span class="docs-menu-title">${escapeHtml(tocTitle)}</span>
          <button id="sidebar-close-btn" class="sidebar-close-btn" type="button" title="${isIt ? 'Nascondi indice' : 'Hide Table of Contents'}" aria-label="Hide Table of Contents">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <ul class="docs-menu" id="docs-sidebar-menu">
          ${tocItemsHtml}
        </ul>
      </aside>
      ` : ''}

      <!-- MAIN DOCUMENTATION CONTENT -->
      <main class="docs-main" id="docs-main">
        <article class="markdown-body">
          ${bodyHtml}
        </article>

        <!-- FOOTER -->
        <footer class="export-footer">
          <div class="footer-inner">
            Made with <a href="https://github.com/gwetano/mark" target="_blank" rel="noopener noreferrer" class="mark-footer-link">Mark</a>
          </div>
        </footer>
      </main>

    </div>
  </div>

  <!-- CLIENT SCRIPTS -->
  <script>
    // ====== TOC TOGGLE & STORAGE ======
    (function() {
      const openBtn = document.getElementById('toc-open-btn');
      const closeBtn = document.getElementById('sidebar-close-btn');

      function setTocHidden(hidden) {
        if (hidden) {
          document.body.classList.add('toc-hidden');
          document.body.classList.remove('toc-mobile-open');
        } else {
          document.body.classList.remove('toc-hidden');
          if (window.innerWidth <= 768) {
            document.body.classList.add('toc-mobile-open');
          }
        }
        try {
          localStorage.setItem('mark-html-toc-hidden', hidden ? '1' : '0');
        } catch (_) {}
      }

      // Restore saved state
      try {
        const saved = localStorage.getItem('mark-html-toc-hidden');
        if (saved === '1') {
          setTocHidden(true);
        }
      } catch (_) {}

      // Click "X" in sidebar header -> hides sidebar and spawns left button
      closeBtn && closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (${!isForPreview} && window.innerWidth <= 768) {
          document.body.classList.remove('toc-mobile-open');
        } else {
          setTocHidden(true);
        }
      });

      // Click left spawn button -> hides button and shows sidebar
      openBtn && openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (${!isForPreview} && window.innerWidth <= 768) {
          document.body.classList.add('toc-mobile-open');
        } else {
          setTocHidden(false);
        }
      });

      // On mobile, clicking any TOC item closes the mobile drawer
      document.querySelectorAll('.docs-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          if (window.innerWidth <= 768) {
            document.body.classList.remove('toc-mobile-open');
          }
        });
      });
    })();

    // ====== THEME TOGGLE ======
    (function() {
      const toggleBtn = document.getElementById('theme-toggle-btn');
      const sunIcon = document.getElementById('sun-icon');
      const moonIcon = document.getElementById('moon-icon');

      function updateTheme(theme) {
        if (theme === 'dark') {
          document.body.classList.add('dark');
          if (sunIcon) sunIcon.style.display = 'block';
          if (moonIcon) moonIcon.style.display = 'none';
        } else {
          document.body.classList.remove('dark');
          if (sunIcon) sunIcon.style.display = 'none';
          if (moonIcon) moonIcon.style.display = 'block';
        }
      }

      // Check saved theme
      try {
        const saved = localStorage.getItem('mark-html-theme');
        if (saved) {
          updateTheme(saved);
        }
      } catch (_) {}

      toggleBtn && toggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark');
        const nextTheme = isDark ? 'light' : 'dark';
        updateTheme(nextTheme);
        try {
          localStorage.setItem('mark-html-theme', nextTheme);
        } catch (_) {}
      });
    })();

    // ====== CODE COPY BUTTONS ======
    (function() {
      const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      const CHECK_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

      document.querySelectorAll('.markdown-body pre').forEach(pre => {
        const codeBlock = pre.querySelector('code');
        if (!codeBlock) return;

        // Clean any existing button
        pre.querySelectorAll('.code-copy-btn').forEach(btn => btn.remove());

        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.type = 'button';
        btn.title = '${isIt ? 'Copia codice' : 'Copy code'}';
        btn.innerHTML = COPY_ICON;

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const text = codeBlock.innerText || codeBlock.textContent;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              btn.innerHTML = CHECK_ICON;
              btn.classList.add('copied');
              btn.title = '${isIt ? 'Copiato!' : 'Copied!'}';
              setTimeout(() => {
                btn.innerHTML = COPY_ICON;
                btn.classList.remove('copied');
                btn.title = '${isIt ? 'Copia codice' : 'Copy code'}';
              }, 1600);
            }).catch(err => console.error('Copy failed:', err));
          }
        });

        pre.appendChild(btn);
      });
    })();

    // ====== TOC SCROLL-SPY & AUTO-SCROLL ======
    (function() {
      const headings = Array.from(document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6'));
      const tocLinks = Array.from(document.querySelectorAll('.docs-menu-item'));
      const tocSidebar = document.getElementById('docs-sidebar');

      if (headings.length === 0 || tocLinks.length === 0) return;

      let activeId = null;

      function updateActiveHeading() {
        const headerOffset = 90;
        let currentHeading = headings[0];

        for (let i = 0; i < headings.length; i++) {
          const rect = headings[i].getBoundingClientRect();
          if (rect.top <= headerOffset + 25) {
            currentHeading = headings[i];
          } else {
            break;
          }
        }

        if (currentHeading && currentHeading.id && currentHeading.id !== activeId) {
          activeId = currentHeading.id;
          let targetLink = null;

          tocLinks.forEach(link => {
            if (link.getAttribute('href') === '#' + activeId) {
              link.classList.add('active');
              targetLink = link;
            } else {
              link.classList.remove('active');
            }
          });

          // Auto-scroll the sidebar TOC container to keep active item in view
          if (targetLink && tocSidebar) {
            const linkRect = targetLink.getBoundingClientRect();
            const sidebarRect = tocSidebar.getBoundingClientRect();
            if (linkRect.top < sidebarRect.top + 30 || linkRect.bottom > sidebarRect.bottom - 30) {
              targetLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      }

      window.addEventListener('scroll', () => {
        window.requestAnimationFrame(updateActiveHeading);
      }, { passive: true });

      // Click smooth scroll with offset
      tocLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = link.getAttribute('href').slice(1);
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            const top = targetEl.getBoundingClientRect().top + window.pageYOffset - 84;
            window.scrollTo({ top, behavior: 'smooth' });
            if (history.pushState) {
              history.pushState(null, null, '#' + targetId);
            }
          }
          if (window.innerWidth <= 768) {
            document.body.classList.remove('toc-mobile-open');
          }
        });
      });

      // Initial check
      updateActiveHeading();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  buildExportHtml
};
