const { ipcRenderer, remote } = require("electron");
const fs = require("fs");
const { dialog } = require("@electron/remote");
let isSyncingScroll = false;
let editorLineHeights = [];
let currentFilePath = null;
let isDirty = false;

function debounce(func, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

document.getElementById("toggle-theme").addEventListener("click", () => {
  document.body.classList.toggle("dark");
});

document.getElementById("toggle-preview").addEventListener("click", () => {
  const preview = document.getElementById('preview');
  const editor = document.getElementById('editor');
  
  if (preview.style.display === 'none') {
    preview.style.display = 'block';
    editor.style.width = '50%';
  } else {
    preview.style.display = 'none';
    editor.style.width = '100%';
  }
  
  // Ricalcola le altezze dopo il toggle
  setTimeout(calculateLineHeights, 100);
});


window.addEventListener("DOMContentLoaded", () => {
  const editor = document.getElementById("editor");
  const preview = document.getElementById("preview");
  const wordCountEl = document.getElementById("word-count");

  const updateWordCount = () => {
    const text = editor.value;
    const words = text.trim().split(/\s+/).filter(Boolean);
    wordCountEl.textContent = `Parole: ${words.length}`;
  };
  
  const setDirty = (dirty) => {
    isDirty = dirty;
    title.textContent = dirty ? "*" : "";
  };

  const updatePreview = () => {
    const raw = editor.value;
  
    // Parse markdown in HTML
    let html = marked.parse(raw, {
      highlight: (code, lang) => {
        return hljs.highlightAuto(code).value;
      }
    });
  
    // Trova i blocchi mermaid e rimpiazza con div
    html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
      return `<div class="mermaid">${code}</div>`;
    });
  
    preview.innerHTML = html;
  
    // Renderizza i grafici mermaid
    mermaid.init(undefined, ".mermaid");
  };

  editor.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
  
      // Inserisci 4 spazi
      this.value = this.value.substring(0, start) + "    " + this.value.substring(end);
  
      // Sposta il cursore dopo i 4 spazi
      this.selectionStart = this.selectionEnd = start + 4;
    }
  });
  
  
  function calculateLineHeights() {
    editorLineHeights = [];
    const lines = editor.value.split('\n');
    let totalHeight = 0;
    
    // Calcola l'altezza cumulativa di ogni riga
    lines.forEach((line, index) => {
      const lineHeight = line.length === 0 ? 1 : Math.ceil(line.length / 100); // Stima approssimativa
      editorLineHeights.push(totalHeight);
      totalHeight += lineHeight;
    });
  }

  editor.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    isSyncingScroll = true;
    
    const scrollPercent = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
    preview.scrollTop = scrollPercent * (preview.scrollHeight - preview.clientHeight);
    
    setTimeout(() => { isSyncingScroll = false; }, 100);
  });
  
  preview.addEventListener('scroll', () => {
    if (isSyncingScroll) return;
    isSyncingScroll = true;
    
    const scrollPercent = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    editor.scrollTop = scrollPercent * (editor.scrollHeight - editor.clientHeight);
    
    setTimeout(() => { isSyncingScroll = false; }, 100);
  });
  
  
  function addPreviewClickHandlers() {
    const elements = preview.querySelectorAll('h1, h2, h3, h4, h5, h6, p, pre, li');
    elements.forEach((element, index) => {
      element.dataset.lineIndex = index;
      element.style.cursor = 'pointer';
      element.addEventListener('click', (e) => {
        const lineIndex = parseInt(e.target.dataset.lineIndex);
        if (!isNaN(lineIndex) && lineIndex < editorLineHeights.length) {
          const linePos = editorLineHeights[lineIndex];
          editor.scrollTop = linePos;
          editor.focus();
        }
      });
    });
  }


  const debouncedUpdate = debounce(() => {
    updatePreview();
    updateWordCount();
  }, 300);

  editor.addEventListener("input", () =>{
    debouncedUpdate();
    setDirty(true);
  });

  ipcRenderer.on("load-md", (event,filePath, content) => {
    editor.value = content;
    updatePreview();
    updateWordCount();
    currentFilePath = filePath; 
    setDirty(false);
  });

  ipcRenderer.on("trigger-save", () => {
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
      }
    }
  });

  updatePreview();
});
