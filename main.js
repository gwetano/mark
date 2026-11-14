const { app, BrowserWindow, Menu, MenuItem, dialog, clipboard, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const remoteMain = require("@electron/remote/main");
const { autoUpdater } = require("electron-updater");
const i18n = require("./i18n.js");

let win;
let printWin = null;
let openFilePath = null; 
let openFolderPath = null; 

const args = process.defaultApp ? process.argv.slice(2) : process.argv.slice(1);
const targetArg = args.find(arg => !arg.startsWith('--'));

if (targetArg) {
  const absolutePath = path.resolve(process.cwd(), targetArg);
  if (fs.existsSync(absolutePath)) {
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      openFolderPath = absolutePath;
    } else if (stat.isFile() && absolutePath.endsWith('.md')) {
      openFilePath = absolutePath;
    }
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    let targetFile = null;
    let targetFolder = null;
    const instanceArgs = argv.slice(process.defaultApp ? 2 : 1);
    const target = instanceArgs.find(arg => !arg.startsWith('--'));
    if (target) {
      const absPath = path.resolve(workingDirectory, target);
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isFile() && absPath.endsWith('.md')) {
          targetFile = absPath;
        } else if (stat.isDirectory()) {
          targetFolder = absPath;
        }
      }
    }

    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (targetFile) {
        const content = fs.readFileSync(targetFile, 'utf8');
        win.webContents.send('load-md', targetFile, content);
      } else if (targetFolder) {
        win.webContents.send('open-folder', targetFolder);
      }
    } else {
      if (targetFile) openFilePath = targetFile;
      if (targetFolder) openFolderPath = targetFolder;
      createWindow();
    }
  });
}

function initializeRemote() {
  if (!remoteMain.isInitialized()) {
    remoteMain.initialize();
  }
}

// Window control IPC handlers (for Windows/Linux custom buttons)
ipcMain.on('window-minimize', () => {
  if (win && !win.isDestroyed()) win.minimize();
});
ipcMain.on('window-maximize', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (win && !win.isDestroyed()) win.close();
});
ipcMain.on('get-platform', (event) => {
  event.returnValue = process.platform;
});
ipcMain.on('is-window-maximized', (event) => {
  event.returnValue = (win && !win.isDestroyed()) ? win.isMaximized() : false;
});

// ===== CUSTOM DICTIONARY (Offline & Session/Folder Persistent) =====
let customWords = [];
let dictPath = '';

function getDictPath() {
  if (!dictPath) {
    try {
      dictPath = path.join(app.getPath('userData'), 'custom-dictionary.json');
    } catch (_) {
      dictPath = path.resolve(__dirname, 'custom-dictionary.json');
    }
  }
  return dictPath;
}

function loadCustomDictionary() {
  try {
    const p = getDictPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(data)) customWords = data;
    }
  } catch (err) {
    console.error('Error loading custom dictionary:', err);
    customWords = [];
  }
}

function initCustomDictionary(targetSession) {
  loadCustomDictionary();
  const sess = targetSession || (win && !win.isDestroyed() && win.webContents ? win.webContents.session : null);
  if (!sess) return;
  for (const word of customWords) {
    try {
      sess.addWordToSpellCheckerDictionary(word);
    } catch (_) {}
  }
}

function addWordToCustomDictionary(word) {
  if (!word || typeof word !== 'string') return;
  const trimmed = word.trim();
  if (!trimmed) return;
  const sess = win && !win.isDestroyed() && win.webContents ? win.webContents.session : null;
  if (sess) {
    try {
      sess.addWordToSpellCheckerDictionary(trimmed);
    } catch (_) {}
  }
  if (!customWords.includes(trimmed)) {
    customWords.push(trimmed);
    try {
      fs.writeFileSync(getDictPath(), JSON.stringify(customWords, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving custom dictionary:', err);
    }
  }
}

ipcMain.handle('add-word-to-dictionary', (event, word) => {
  addWordToCustomDictionary(word);
  return true;
});

ipcMain.handle('get-custom-dictionary', () => {
  return customWords;
});

function createWindow() {

  initializeRemote();

  const isMac = process.platform === 'darwin';

  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 650,
    minHeight: 400,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 15, y: 19 } }
      : { frame: false }),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      clipboard: true,
      spellcheck: true
    }
  };

  win = new BrowserWindow(windowOptions);

  remoteMain.enable(win.webContents);

  // Spellchecker setup (macOS native offline / Hunspell + custom dictionary)
  const session = win.webContents.session;
  try {
    const currentLang = i18n.getLanguage() === 'it' ? ['it-IT', 'it', 'en-US', 'en'] : ['en-US', 'en', 'it-IT', 'it'];
    session.setSpellCheckerLanguages(currentLang);
  } catch (e) {
    console.error('Error setting spellchecker languages:', e);
  }
  initCustomDictionary(session);

  // Context Menu with Spellchecker Suggestions & Add to Dictionary
  win.webContents.on('context-menu', (event, params) => {
    if (params.defaultPrevented) return;
    if (!params.isEditable && !params.selectionText && !params.misspelledWord) return;

    const menu = new Menu();

    // 1. Suggerimenti ortografici se cliccato su parola con errore
    if (params.misspelledWord) {
      if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
        for (const suggestion of params.dictionarySuggestions) {
          menu.append(new MenuItem({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion)
          }));
        }
      } else {
        menu.append(new MenuItem({
          label: i18n.t('context_no_suggestions'),
          enabled: false
        }));
      }

      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: i18n.t('context_add_to_dictionary'),
        click: () => {
          addWordToCustomDictionary(params.misspelledWord);
          win.webContents.send('word-added-to-dictionary', params.misspelledWord);
        }
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 2. Azioni di modifica standard
    if (params.isEditable) {
      menu.append(new MenuItem({
        label: i18n.t('context_cut'),
        accelerator: 'CmdOrCtrl+X',
        role: 'cut'
      }));
    }
    menu.append(new MenuItem({
      label: i18n.t('context_copy'),
      accelerator: 'CmdOrCtrl+C',
      role: 'copy'
    }));
    if (params.isEditable) {
      menu.append(new MenuItem({
        label: i18n.t('context_paste'),
        accelerator: 'CmdOrCtrl+V',
        role: 'paste'
      }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: i18n.t('context_format_markdown'),
        accelerator: 'CmdOrCtrl+K',
        click: () => win.webContents.send('format-markdown')
      }));
      menu.append(new MenuItem({
        label: i18n.t('context_show_history'),
        accelerator: 'Ctrl+Alt+Z',
        click: () => win.webContents.send('show-undo-history')
      }));
    }

    // 3. AI Tool se c'è testo selezionato
    if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'AI Tool',
        accelerator: 'CmdOrCtrl+Shift+A',
        click: () => win.webContents.send('trigger-ai-tool', params.selectionText.trim())
      }));
    }

    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: i18n.t('context_select_all'),
      accelerator: 'CmdOrCtrl+A',
      role: 'selectAll'
    }));

    menu.popup();
  });

  win.loadFile("index.html");

  win.on('maximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-changed', true);
    }
  });
  win.on('unmaximize', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window-maximize-changed', false);
    }
  });
  win.on('closed', () => {
    win = null;
    if (printWin && !printWin.isDestroyed()) {
      printWin.destroy();
      printWin = null;
    }
  });

  buildApplicationMenu();
}

ipcMain.on('app-language-changed', (event, lang) => {
  i18n.setLanguage(lang);
  buildApplicationMenu();
  if (win && !win.isDestroyed()) {
    try {
      const langs = lang === 'it' ? ['it-IT', 'it', 'en-US', 'en'] : ['en-US', 'en', 'it-IT', 'it'];
      win.webContents.session.setSpellCheckerLanguages(langs);
    } catch (_) {}
  }
});

function buildApplicationMenu() {
  if (!win) return;
  const menu = Menu.buildFromTemplate([
    {
      label: i18n.t("menu_file"),
      submenu: [
        {
          label: i18n.t("menu_new_file"),
          accelerator: "CmdOrCtrl+N",
          click: () => {
            win.webContents.send("new-file");
          }
        },
        {
          label: i18n.t("menu_open_file"),
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              filters: [
                { name: "Documenti supportati", extensions: ["md", "pdf"] },
                { name: "Markdown", extensions: ["md"] },
                { name: "PDF", extensions: ["pdf"] }
              ],
              properties: ["openFile", "multiSelections"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              for (const filePath of result.filePaths) {
                if (filePath.toLowerCase().endsWith('.pdf')) {
                  win.webContents.send("load-pdf", filePath);
                } else {
                  const content = fs.readFileSync(filePath, "utf8");
                  win.webContents.send("load-md", filePath, content);
                }
              }
            }
          }
        },
        {
          label: i18n.t("menu_close_tab"),
          accelerator: "CmdOrCtrl+W",
          click: () => {
            win.webContents.send("close-active-tab");
          }
        },
        {
          label: i18n.t("menu_import"),
          accelerator: "CmdOrCtrl+Alt+I",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              filters: [{ name: "Documenti supportati", extensions: ["pdf", "docx", "pptx", "html", "xlsx"] }],
              properties: ["openFile"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              const filePath = result.filePaths[0];
              try {
                // Caricamento asincrono per non bloccare l'app
                const Markitdown = require("markitdown-js").default;
                const md = new Markitdown();
                const output = await md.convert(filePath);
                
                // Passiamo il testo convertito al tuo editor simulando un nuovo file
                const targetPath = filePath.replace(/\.[^/.]+$/, "") + ".md";
                win.webContents.send("load-md", targetPath, output.textContent || output);
              } catch (err) {
                dialog.showErrorBox(i18n.t("dialog_import_error_title"), i18n.t("dialog_import_error_message", { msg: err.message }));
              }
            }
          }
        },
        {
          label: i18n.t("menu_open_folder"),
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              properties: ["openDirectory"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              const folderPath = result.filePaths[0];
              win.webContents.send("open-folder", folderPath);
            }
          }
        },
        {
          label: i18n.t("menu_close_folder"),
          accelerator: "CmdOrCtrl+Alt+O",
          click: () => {
            win.webContents.send("close-folder");
          }
        },
        {
          label: i18n.t("menu_save"),
          accelerator: "CmdOrCtrl+S",
          click: () => {
            win.webContents.send("trigger-save");
          }
        },
        {
          label: i18n.t("menu_export_pdf"),
          accelerator: "CmdOrCtrl+Alt+E",
          click: () => {
            win.webContents.send("export-pdf");
          }
        },
        {
          label: i18n.t("menu_export_html"),
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => {
            win.webContents.send("export-html");
          }
        },
        { type: "separator" },
        { role: "quit", label: i18n.t("menu_quit") }
      ]
    },
    {
      label: i18n.t("menu_edit"),
      submenu: [
        {
          label: i18n.t("menu_undo"),
          accelerator: "CmdOrCtrl+Z",
          role: "undo"
        },
        {
          label: i18n.t("menu_redo"),
          accelerator: "CmdOrCtrl+Y",
          role: "redo"
        },
        { type: "separator" },
        {
          label: i18n.t("menu_cut"),
          accelerator: "CmdOrCtrl+X",
          role: "cut"
        },
        {
          label: i18n.t("menu_copy"),
          accelerator: "CmdOrCtrl+C",
          role: "copy"
        },
        {
          label: i18n.t("menu_paste"),
          accelerator: "CmdOrCtrl+V",
          role: "paste"
        },
        { type: "separator" },
        {
          label: i18n.t("menu_select_all"),
          accelerator: "CmdOrCtrl+A",
          role: "selectAll"
        },
        {
          label: i18n.t("menu_find"),
          accelerator: "CmdOrCtrl+F",
          click: () => {
            win.webContents.send("open-search");
          }
        },
        {
          label: i18n.t("menu_insert_link"),
          accelerator: "CmdOrCtrl+L",
          click: () => {
            win.webContents.send("insert-link");
          }
        },
        { type: "separator" },
        {
          label: i18n.t("menu_insert_image"),
          accelerator: "CmdOrCtrl+Shift+I",
          click: async () => {
            const result = await dialog.showOpenDialog(win, {
              filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp"] }],
              properties: ["openFile"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              const imagePath = result.filePaths[0];
              win.webContents.send("insert-image-from-file", imagePath);
            }
          }
        },
        {
          label: i18n.t("menu_paste_image"),
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => {
            win.webContents.send("paste-image-from-clipboard");
          }
        }
      ]
    },
    {
      label: i18n.t("menu_view"),
      submenu: [
        {
          label: i18n.t("menu_explorer"),
          accelerator: "CmdOrCtrl+R",
          click: () => {
            win.webContents.send("toggle-explorer");
          }
        },
        {
          label: i18n.t("menu_editor"),
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => {
            win.webContents.send("toggle-editor-view");
          }
        },
        {
          label: i18n.t("menu_preview"),
          accelerator: "CmdOrCtrl+Shift+P",
          click: () => {
            win.webContents.send("toggle-preview-view");
          }
        },
        { type: "separator" },
        {
          label: i18n.t("menu_dark_mode"),
          accelerator: "CmdOrCtrl+M",
          click: () => {
            win.webContents.send("toggle-theme");
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function createPrintWindow() {
  printWin = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  printWin.loadFile("print.html");
  printWin.on('closed', () => {
    printWin = null;
  });
}

let interFontBase64 = null;
function getInterFontBase64() {
  if (!interFontBase64) {
    try {
      const fontPath = path.join(__dirname, "fonts", "inter", "Inter-Regular.ttf");
      if (fs.existsSync(fontPath)) {
        interFontBase64 = fs.readFileSync(fontPath).toString("base64");
      }
    } catch (err) {
      console.error("Error reading Inter font for PDF export:", err);
    }
  }
  return interFontBase64;
}

function buildPdfPrintOptions(exportSettings) {
  const pageNumbers = exportSettings?.pageNumbers || 'none';
  const pageAlign = exportSettings?.pageNumberAlign || 'right';

  let displayHeaderFooter = false;
  let headerTemplate = '<div></div>';
  let footerTemplate = '';

  if (pageNumbers !== 'none') {
    displayHeaderFooter = true;
    let alignCss = 'justify-content: flex-end; text-align: right;';
    if (pageAlign === 'center') {
      alignCss = 'justify-content: center; text-align: center;';
    } else if (pageAlign === 'left') {
      alignCss = 'justify-content: flex-start; text-align: left;';
    }

    const numSpan = pageNumbers === 'total'
      ? '<span class="pageNumber"></span> / <span class="totalPages"></span>'
      : '<span class="pageNumber"></span>';

    let footerPadding = '20mm';
    if (exportSettings?.margins === 'minimum' || exportSettings?.margins === 'none') {
      footerPadding = '10mm';
    }

    const interB64 = getInterFontBase64();
    const fontFaceCss = interB64
      ? `@font-face { font-family: 'Inter'; src: url('data:font/truetype;charset=utf-8;base64,${interB64}') format('truetype'); font-weight: normal; font-style: normal; }`
      : '';

    footerTemplate = `<style>
      ${fontFaceCss}
      .pdf-footer-root {
        width: 100%;
        display: flex;
        ${alignCss}
        padding: 0 ${footerPadding};
        font-size: 10px;
        color: #666666;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
        box-sizing: border-box;
        margin-bottom: 5mm;
      }
      .pdf-footer-root span {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
      }
    </style>
    <div class="pdf-footer-root">${numSpan}</div>`;
  }

  const marginsSetting = exportSettings?.margins || 'normal';
  let marginsObj;

  if (marginsSetting === 'minimum') {
    marginsObj = {
      top: 0.5,     // ~12.7mm
      bottom: 0.55, // ~14mm
      left: 0.4,    // ~10mm
      right: 0.4    // ~10mm
    };
  } else if (marginsSetting === 'none') {
    if (displayHeaderFooter) {
      marginsObj = {
        top: 0.25,
        bottom: 0.45,
        left: 0.25,
        right: 0.25
      };
    } else {
      marginsObj = {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      };
    }
  } else {
    // 'normal' (standard) - increased top and bottom spacing as requested (comfortably 24-25mm)
    marginsObj = {
      top: 0.95,    // ~24.1mm
      bottom: 0.95, // ~24.1mm
      left: 0.7,    // ~17.8mm
      right: 0.7    // ~17.8mm
    };
  }

  return {
    margins: marginsObj,
    pageSize: exportSettings?.pageSize || 'A4',
    printBackground: true,
    printSelectionOnly: false,
    landscape: exportSettings?.orientation === 'landscape',
    displayHeaderFooter: displayHeaderFooter,
    headerTemplate: headerTemplate,
    footerTemplate: footerTemplate
  };
}

let printQueue = Promise.resolve();

function renderPdfBuffer(content, exportSettings) {
  const task = printQueue.then(async () => {
    if (!printWin || printWin.isDestroyed()) {
      createPrintWindow();
      await new Promise(resolve => {
        printWin.webContents.once('did-finish-load', resolve);
      });
    }

    const options = buildPdfPrintOptions(exportSettings);

    const contentReadyPromise = new Promise(resolve => {
      ipcMain.once('content-ready', resolve);
    });

    printWin.webContents.send('print-content', content, exportSettings);
    await contentReadyPromise;

    const data = await printWin.webContents.printToPDF(options);
    return data;
  });

  printQueue = task.catch(() => {});
  return task;
}

ipcMain.handle('generate-pdf-preview', async (event, content, exportSettings) => {
  try {
    const data = await renderPdfBuffer(content, exportSettings);
    return data;
  } catch (error) {
    console.error("Errore nella generazione preview PDF:", error);
    throw error;
  }
});

ipcMain.on("print-to-pdf", async (event, content, title, exportSettings, targetPath) => {
  let destinationPath = targetPath;
  if (!destinationPath) {
    let defaultPath = "exported.pdf";
    if (title && title !== "*") {
      defaultPath = `${title.replace(/\.[^/.]+$/, "")}.pdf`;
    }

    const result = await dialog.showSaveDialog({
      title: i18n.t("dialog_save_pdf_title"),
      defaultPath: defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });

    if (result.canceled) return;
    destinationPath = result.filePath;
  }
  
  try {
    const data = await renderPdfBuffer(content, exportSettings);
    fs.writeFile(destinationPath, data, (error) => {
      if (error) {
        console.error("Errore nel salvataggio del PDF:", error);
        event.reply('pdf-export-error', error.message);
        return;
      }
      event.reply('pdf-saved', destinationPath);
    });
  } catch (error) {
    console.error("Errore nella generazione del PDF:", error);
    event.reply('pdf-export-error', error.message);
  }
});

ipcMain.on("folder-closed", () => {
  openFolderPath = null;
});

app.whenReady().then(() => {
  createWindow();

  win.webContents.once('did-finish-load', () => {
    if (openFilePath && fs.existsSync(openFilePath)) {
      const content = fs.readFileSync(openFilePath, 'utf8');
      win.webContents.send('load-md', openFilePath, content);
    } else if (openFolderPath && fs.existsSync(openFolderPath)) {
      win.webContents.send('open-folder', openFolderPath);
    }
  });

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-download-progress', Math.round(progressObj.percent));
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[AutoUpdater] Error:', err);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-error', err ? (err.message || String(err)) : 'Unknown error');
    }
  });

  ipcMain.on('start-download-update', () => {
    autoUpdater.downloadUpdate().catch((err) => {
      console.warn('[AutoUpdater] downloadUpdate error:', err);
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-error', err ? (err.message || String(err)) : 'Unknown error');
      }
    });
  });

  ipcMain.on('quit-and-install-update', () => {
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[AutoUpdater] Check for updates failed:', err);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();

  const handlePath = () => {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        win.webContents.send('open-folder', filePath);
      } else if (stat.isFile() && filePath.endsWith('.md')) {
        const content = fs.readFileSync(filePath, 'utf8');
        win.webContents.send('load-md', filePath, content);
      }
    }
  };

  if (app.isReady() && win) {
    handlePath();
  } else {
    // Salva il percorso se l'app non è ancora inizializzata
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        openFolderPath = filePath;
      } else {
        openFilePath = filePath;
      }
    }
  }
});