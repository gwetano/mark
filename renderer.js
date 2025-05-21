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

const SCROLL_DEBOUNCE_DELAY = 200;

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
  
  setTimeout(calculateLineHeights, 100);
});

document.getElementById("toggle-explorer").addEventListener("click", () => {
  const explorerPanel = document.getElementById("explorer-panel");
  explorerPanel.classList.toggle("hidden");
});

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
    editor.style.backgroundColor = '#ffff9980'; // Giallo chiaro con trasparenza
    
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
    const linkText = `[${selectedText}](insert your link...)`;
    
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    
    const cursorPos = start + selectedText.length + 3;
    editor.setSelectionRange(cursorPos, cursorPos + 19); // Seleziona "insert your link..."
    
    updatePreview();
    setDirty(true);
  } else {
    const linkText = "[](insert your link...)";
    
    editor.value = editor.value.substring(0, start) + linkText + editor.value.substring(end);
    editor.setSelectionRange(start + 1, start + 1);
    
    updatePreview();
    setDirty(true);
  }
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

    const scrollPercent = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
  
    let html = marked.parse(raw, {
      highlight: (code, lang) => {
        return hljs.highlightAuto(code).value;
      }
    });
  
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
      codeBlock.addEventListener('click', function() {
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
    
    explorerPanel.classList.remove('hidden');
    
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
      
      if (answer === 0) { // Salva
        saveCurrentFile();
      } else if (answer === 2) { // Annulla
        return;
      }
    }
    
    const filename = dialog.showSaveDialogSync({
      defaultPath: path.join(currentFolderPath, 'nuovo-file.md'),
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: 'Crea nuovo file'
    });
    
    if (!filename) return; // Utente ha annullato
    
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
          
          const relativeImagePath = path.relative(path.dirname(currentFilePath), imagePath).replace(/\\/g, "/");
          const markdownImage = `![immagine](${imagePath})`;

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
      
      if (!file) return;
      
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

  setupExternalLinks();
});