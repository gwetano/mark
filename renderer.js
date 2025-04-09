const { ipcRenderer, remote } = require("electron");
const fs = require("fs");
const { dialog } = require("@electron/remote");
let isSyncingScroll = false;
let editorLineHeights = [];

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

  const updatePreview = () => {
    const raw = editor.value;
    const html = marked.parse(raw, {
      highlight: (code, lang) => {
        return hljs.highlightAuto(code).value;
      }
    });
    preview.innerHTML = html;
    
    // Calcola le altezze delle righe nell'editor
    calculateLineHeights();
    
    // Aggiungi gli event listener per gli elementi della preview
    addPreviewClickHandlers();
  };
  
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

  editor.addEventListener("input", updatePreview);

  ipcRenderer.on("load-md", (event, content) => {
    editor.value = content;
    updatePreview();
  });

  ipcRenderer.on("trigger-save", () => {
    const content = editor.value;
    const file = dialog.showSaveDialogSync({
      filters: [{ name: "Markdown", extensions: ["md"] }]
    });
    if (file) {
      fs.writeFileSync(file, content, "utf8");
    }
  });

  updatePreview();
});
