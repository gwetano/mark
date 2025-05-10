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

// Funzionalità di ricerca
let searchMatches = [];
let currentMatchIndex = -1;

// Aggiorna la funzione toggleSearchPanel per ripulire la ricerca
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

// Gestione della ricerca
function performSearch() {
  const searchTerm = document.getElementById("search-input").value;
  const editor = document.getElementById("editor");
  const text = editor.value;
  
  // Pulisci le evidenziazioni precedenti
  clearSearchHighlights();
  
  if (!searchTerm) {
    document.getElementById("search-results").textContent = "0/0";
    currentMatchIndex = -1;
    return;
  }
  
  // Trova tutte le occorrenze
  searchMatches = [];
  let match;
  const regex = new RegExp(escapeRegExp(searchTerm), "gi");
  
  while ((match = regex.exec(text)) !== null) {
    searchMatches.push({
      start: match.index,
      end: match.index + searchTerm.length
    });
  }
  
  // Aggiorna il contatore dei risultati
  updateSearchResultsCounter();
  
  // Vai al primo risultato se ce ne sono
  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    navigateToMatch(currentMatchIndex);
  }
}

// Funzione per navigare al match precedente
function goToPreviousMatch() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  navigateToMatch(currentMatchIndex);
}

// Funzione per navigare al match successivo
function goToNextMatch() {
  if (searchMatches.length === 0) return;
  
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  navigateToMatch(currentMatchIndex);
}

// Funzione migliorata per evidenziare e navigare al match corrente
function navigateToMatch(index) {
  const editor = document.getElementById("editor");
  const match = searchMatches[index];
  
  if (!match) return;
  
  // Seleziona il testo corrispondente
  editor.focus();
  editor.setSelectionRange(match.start, match.end);
  
  // Per calcolare la posizione esatta del match nel testo:
  // 1. Crea un elemento temporaneo che rispecchi le proprietà dell'editor
  // 2. Inserisci solo il testo fino al match
  // 3. Misura l'altezza di questo testo
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
  
  // Inserisci il testo fino al match
  temp.value = editor.value.substring(0, match.start);
  document.body.appendChild(temp);
  
  // Calcola la posizione esatta (l'altezza del testo fino al match)
  const matchPosition = temp.scrollHeight;
  
  // Rimuovi l'elemento temporaneo
  document.body.removeChild(temp);
  
  // Scorri l'editor in modo che il match sia visibile al centro
  // Usa scrollIntoView se disponibile, altrimenti posiziona manualmente
  try {
    // Calcola la posizione di scorrimento
    const scrollPosition = matchPosition - (editor.clientHeight / 2);
    
    // Assicurati che la posizione non sia negativa
    editor.scrollTop = Math.max(0, scrollPosition);
    
    // Opzionale: aggiungi un effetto per rendere visibile il match
    const origBackground = editor.style.background;
    const origTransition = editor.style.transition;
    
    editor.style.transition = 'background-color 0.3s ease';
    editor.style.backgroundColor = '#ffff9980'; // Giallo chiaro con trasparenza
    
    setTimeout(() => {
      editor.style.backgroundColor = origBackground;
      editor.style.transition = origTransition;
    }, 500);
  } catch (e) {
    console.error("Errore nel calcolo della posizione di scorrimento:", e);
    
    // Fallback alla vecchia logica come piano B
    const textBeforeMatch = editor.value.substring(0, match.start);
    const lineBreaks = textBeforeMatch.split("\n").length - 1;
    
    // Calcola l'altezza della riga in modo dinamico
    const computedLineHeight = parseInt(window.getComputedStyle(editor).lineHeight) || 20;
    const scrollPosition = lineBreaks * computedLineHeight;
    editor.scrollTop = scrollPosition - editor.clientHeight / 2;
  }
  
  // Aggiorna il contatore
  updateSearchResultsCounter();
}

// Funzione per calcolare l'altezza delle righe in base al contenuto effettivo
function calculateLineHeights() {
  const editor = document.getElementById('editor');
  if (!editor) return;
  
  // Ottieni lo stile calcolato dell'editor
  const style = window.getComputedStyle(editor);
  const lineHeight = parseFloat(style.lineHeight);
  
  // Se lineHeight è in pixel, usa direttamente quel valore
  if (!isNaN(lineHeight)) {
    editor.dataset.lineHeight = lineHeight;
    return lineHeight;
  }
  
  // Altrimenti, calcola in base all'altezza del font
  const fontSize = parseFloat(style.fontSize);
  if (!isNaN(fontSize)) {
    // lineHeight normale è generalmente circa 1.2 volte la dimensione del font
    const calculatedLineHeight = fontSize * 1.2;
    editor.dataset.lineHeight = calculatedLineHeight;
    return calculatedLineHeight;
  }
  
  // Fallback a un valore di default
  editor.dataset.lineHeight = 20;
  return 20;
}

// Funzione per aggiornare il contatore dei risultati di ricerca
function updateSearchResultsCounter() {
  const counter = document.getElementById("search-results");
  if (searchMatches.length > 0) {
    counter.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
  } else {
    counter.textContent = "0/0";
  }
}

// Funzione per rimuovere le evidenziazioni della ricerca
function clearSearchHighlights() {
  searchMatches = [];
  currentMatchIndex = -1;
}

// Funzione di utilità per escape di caratteri speciali in regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        throwOnError: false,
        output: 'html',    // Usa l'output HTML per migliore controllo
        trust: true,       // Necessario per alcune operazioni avanzate
        macros: {          // Macros personalizzate se necessarie
          "\\eqref": "\\href{#1}{}",  // esempio
        }
      });
    
      // Post-processamento delle formule KaTeX per assicurare che rispettino lo spazio disponibile
      const katexDisplays = preview.querySelectorAll('.katex-display');
      katexDisplays.forEach(display => {
        // Assicura che le formule display non escano dal contenitore
        display.style.overflowX = 'auto';
        display.style.maxWidth = '100%';
      });
    
      // Gestione opzionale per formule inline molto lunghe
      const katexInlines = preview.querySelectorAll('.katex');
      katexInlines.forEach(inline => {
        // Imposta una larghezza massima relativa per le formule inline
        if (!inline.closest('.katex-display')) { // Solo per formule veramente inline
          inline.style.maxWidth = '100%';
          inline.style.whiteSpace = 'normal';
        }
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
  // Aggiungi event listener per l'invio sulla casella di ricerca
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      performSearch();
      
      // Decidi se andare al match precedente o successivo
      if (e.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  });

  // Usa il pulsante di ricerca esistente invece di crearne uno nuovo
  const searchButton = document.getElementById("search-button");
  if (searchButton) {
    // Rimuovi eventuali listener esistenti per sicurezza
    searchButton.replaceWith(searchButton.cloneNode(true));
    
    // Ottieni il riferimento al nuovo elemento clonato
    const newSearchButton = document.getElementById("search-button");
    
    // Aggiungi il listener al pulsante di ricerca esistente
    newSearchButton.addEventListener("click", () => {
      performSearch();
      goToNextMatch(); // Vai al primo match quando si clicca il pulsante
    });
  }

  
  searchPrevBtn.addEventListener("click", goToPreviousMatch);
  
  searchNextBtn.addEventListener("click", goToNextMatch);
  
  searchCloseBtn.addEventListener("click", () => {
    toggleSearchPanel(false);
  });

  // Gestione scorciatoia da tastiera Ctrl+F
  document.addEventListener("keydown", (e) => {
    // Ctrl+F per aprire la ricerca
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault(); // Previeni il comportamento predefinito del browser
      toggleSearchPanel(true);
    }
    
    // ESC per chiudere la ricerca
    if (e.key === "Escape" && !document.getElementById("search-container").classList.contains("hidden")) {
      toggleSearchPanel(false);
    }
    
    // Enter per andare al prossimo risultato
    if (e.key === "Enter" && !document.getElementById("search-container").classList.contains("hidden")) {
      if (e.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  });
  
  // Ricevi il messaggio per aprire la ricerca
  ipcRenderer.on("open-search", () => {
    toggleSearchPanel(true);
  });



});