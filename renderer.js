const { ipcRenderer, remote } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog } = require("@electron/remote");
let isSyncingScroll = false;
let editorLineHeights = [];
let currentFilePath = null;
let isDirty = false;
let currentFolderPath = null;

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

document.getElementById("toggle-explorer").addEventListener("click", () => {
  const explorerPanel = document.getElementById("explorer-panel");
  explorerPanel.classList.toggle("hidden");
});


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

  // Inizialmente nascondi il pannello dell'explorer
  explorerPanel.classList.add("hidden");

  // Pulsante per aprire cartella
  openFolderBtn.addEventListener("click", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      openFolder(result.filePaths[0]);
    }
  });

  collapseAllBtn.addEventListener("click", () => {
    const folders = document.querySelectorAll('.tree-folder');
    folders.forEach(folder => {
      folder.classList.add('collapsed');
    });
  });

  refreshExplorerBtn.addEventListener("click", () => {
    if (currentFolderPath) {
      openFolder(currentFolderPath);
    }
  });

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
  
    // Renderizza formule matematiche con KaTeX
    if (window.renderMathInElement) {
      renderMathInElement(preview, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false }
        ],
        throwOnError: false
      });
    }
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

  // Gestione del Tab nell'editor
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

  // Sincronizzazione dello scroll
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
  
  // Gestione input editor
  const debouncedUpdate = debounce(() => {
    updatePreview();
    updateWordCount();
  }, 300);
 
  editor.addEventListener("input", () => {
    debouncedUpdate();
    setDirty(true);
  });

  // Funzione per verificare se un percorso è un file markdown
  function isMarkdownFile(filePath) {
    return filePath.toLowerCase().endsWith('.md');
  }

  // Crea la struttura dell'albero file da visualizzare nell'explorer
  function createFileTree(folderPath, parentElement) {
    try {
      const items = fs.readdirSync(folderPath);
      
      // Prima mostro le cartelle
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
          
          // Gestisci il click sulla cartella per espandere/comprimere
          folderHeader.addEventListener('click', () => {
            folderElement.classList.toggle('collapsed');
            
            // Carica il contenuto solo quando viene espanso per la prima volta
            if (!folderElement.dataset.loaded && !folderElement.classList.contains('collapsed')) {
              createFileTree(itemPath, folderContent);
              folderElement.dataset.loaded = 'true';
            }
          });
        });
      
      // Poi mostro i file
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
            // Prima di caricare un nuovo file, controlla se ci sono modifiche non salvate
            if (isDirty) {
              const answer = dialog.showMessageBoxSync({
                type: 'question',
                buttons: ['Salva', 'Non salvare', 'Annulla'],
                defaultId: 0,
                title: 'File non salvato',
                message: 'Ci sono modifiche non salvate. Vuoi salvare prima di aprire un nuovo file?'
              });
              
              if (answer === 0) { // Salva
                saveCurrentFile();
              } else if (answer === 2) { // Annulla
                return;
              }
            }
            
            // Rimuovi la classe active da tutti i file
            document.querySelectorAll('.tree-item').forEach(item => {
              item.classList.remove('active');
            });
            
            // Aggiungi la classe active al file corrente
            fileElement.classList.add('active');
            
            // Carica il file
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

  function openFolder(folderPath) {
    currentFolderPath = folderPath;
    folderPathEl.textContent = folderPath;
    
    // Pulisci l'albero dei file
    fileTree.innerHTML = '';
    
    // Mostra il pannello explorer
    explorerPanel.classList.remove('hidden');
    
    // Crea l'albero dei file
    createFileTree(folderPath, fileTree);
  }

  // Funzione per salvare il file corrente
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
        
        // Se abbiamo una cartella aperta e il nuovo file è nella stessa cartella, aggiorna l'explorer
        if (currentFolderPath && file.startsWith(currentFolderPath)) {
          openFolder(currentFolderPath);
        }
      }
    }
  }

  // Gestione dei messaggi IPC da main.js
  ipcRenderer.on("load-md", (event, filePath, content) => {
    editor.value = content;
    updatePreview();
    updateWordCount();
    currentFilePath = filePath;
    setDirty(false);
    
    // Evidenzia il file corrente nell'explorer se è presente
    document.querySelectorAll('.tree-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.path === filePath) {
        item.classList.add('active');
      }
    });
  });

  ipcRenderer.on("open-folder", (event, folderPath) => {
    openFolder(folderPath);
  });

  ipcRenderer.on("trigger-save", () => {
    saveCurrentFile();
  });

  ipcRenderer.on("toggle-explorer", () => {
    explorerPanel.classList.toggle("hidden");
  });

  ipcRenderer.on("toggle-preview", () => {
    togglePreviewBtn.click();
  });

  ipcRenderer.on("toggle-theme", () => {
    toggleThemeBtn.click();
  });

  updatePreview();
});