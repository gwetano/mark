const { ipcRenderer, remote } = require("electron");
const fs = require("fs");
const path = require("path");
const { dialog } = require("@electron/remote");
let isSyncingScroll = false;
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
  const newFileBtn = document.getElementById("new-file");

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

    const codeBlocks = preview.querySelectorAll('pre code');
    codeBlocks.forEach(codeBlock => {
      codeBlock.classList.add('clickable-code');
      codeBlock.title = 'Clicca per copiare il codice';
      codeBlock.addEventListener('click', function() {
        // Ottieni il testo non formattato (senza la formattazione HTML)
        const text = this.textContent;
        
        // Copia negli appunti
        navigator.clipboard.writeText(text)
          .then(() => {
            // Mostra feedback visivo temporaneo
            const originalBg = this.style.backgroundColor;
            this.style.backgroundColor = '#4CAF50';
            
            // Ripristina lo sfondo originale dopo 500ms
            setTimeout(() => {
              this.style.backgroundColor = originalBg;
            }, 500);
            
            // Opzionale: mostra un tooltip o notifica
            const notification = document.createElement('div');
            notification.className = 'copy-notification';
            notification.textContent = 'Copiato!';
            notification.style.position = 'absolute';
            notification.style.top = `${window.scrollY + this.getBoundingClientRect().top - 30}px`;
            notification.style.left = `${window.scrollX + this.getBoundingClientRect().left + this.offsetWidth/2}px`;
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

  // Funzione per esportare in PDF
  function exportToPdf() {
    // Ottieni solo il contenuto HTML della preview
    const content = preview.innerHTML;
    
    // Invia il contenuto e il nome del file alla finestra principale
    ipcRenderer.send("print-to-pdf", content, path.basename(currentFilePath || ""));
    
    // Feedback visivo all'utente
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    notification.textContent = 'Preparazione PDF in corso...';
    notification.style.position = 'absolute';
    notification.style.top = '50%';
    notification.style.left = '50%';
    notification.style.transform = 'translate(-50%, -50%)';
    document.body.appendChild(notification);
    
    // Rimuovi la notifica quando il PDF è stato salvato
    ipcRenderer.once('pdf-saved', (event, filePath) => {
      document.body.removeChild(notification);
    });
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

  function createNewFile() {
    // Controlla se ci sono modifiche non salvate
    if (isDirty) {
      const answer = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Salva', 'Non salvare', 'Annulla'],
        defaultId: 0,
        title: 'File non salvato',
        message: 'Ci sono modifiche non salvate. Vuoi salvare prima di creare un nuovo file?'
      });
      
      if (answer === 0) { // Salva
        saveCurrentFile();
      } else if (answer === 2) { // Annulla
        return;
      }
    }
    
    // Chiedi il nome del nuovo file
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath, 'nuovo-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: 'Crea nuovo file'
    });
    
    if (!filename) return; // Utente ha annullato
    
    // Crea il file vuoto
    fs.writeFileSync(filename, '', 'utf8');
    
    // Carica il nuovo file nell'editor
    editor.value = '';
    updatePreview();
    updateWordCount();
    currentFilePath = filename;
    setDirty(false);
    
    // Aggiorna l'explorer per mostrare il nuovo file
    openFolder(currentFolderPath);
    
    // Evidenzia il nuovo file nell'explorer
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
    
    // Controlla se ci sono immagini negli appunti
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      
      // Verifica se l'elemento è di tipo immagine
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault(); // Previeni il comportamento di incollare di default
        
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
          
          // Ottieni il percorso relativo dell'immagine rispetto al file markdown
          const relativeImagePath = path.relative(path.dirname(currentFilePath), imagePath).replace(/\\/g, "/");
          const markdownImage = `![immagine](${imagePath})`;

          // Inserisci il tag dell'immagine nel punto in cui si trova il cursore
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          
          editor.value = editor.value.slice(0, start) + markdownImage + editor.value.slice(end);
          
          updatePreview();
          updateWordCount();
          setDirty(true);
        };
        
        reader.readAsArrayBuffer(blob);
      }
    }
  });

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
    explorerPanel.classList.toggle("hidden");
  });

  ipcRenderer.on("toggle-preview", () => {
    document.getElementById("toggle-preview").click();
  });

  ipcRenderer.on("toggle-theme", () => {
    document.getElementById("toggle-theme").click();
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
      
      if (!file) return; // L'utente ha annullato
      
      fs.writeFileSync(file, editor.value, "utf8");
      currentFilePath = file;
      setDirty(false);
    }
    
    const fileName = path.basename(imagePath);
    
    const folderPath = path.dirname(currentFilePath);
    const destDir = path.join(folderPath, "images");
    const destPath = path.join(destDir, fileName);
    
    if (imagePath !== destPath) {
      fs.copyFileSync(imagePath, destPath);
    }
    
    const relativeImagePath = path.relative(folderPath, destPath);
    
    const cursorPos = editor.selectionStart;
    const textBefore = editor.value.substring(0, cursorPos);
    const textAfter = editor.value.substring(cursorPos);
    const imageTag = `![${fileName}](${destPath.replace(/\\/g, '/')})`;
    
    editor.value = textBefore + imageTag + textAfter;
    
    updatePreview();
    updateWordCount();
    setDirty(true);
    
    editor.focus();
    editor.selectionStart = editor.selectionEnd = cursorPos + imageTag.length;
  });

  ipcRenderer.on("paste-image-from-clipboard", () => {
    editor.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: clipboard.availableFormats().some(format => format.includes('image'))
        ? clipboard
        : new DataTransfer()
    }));
  });

  updatePreview();
});