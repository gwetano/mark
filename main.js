const { app, BrowserWindow, Menu, dialog, clipboard, ipcMain } = require("electron");
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
      clipboard: true
    }
  };

  win = new BrowserWindow(windowOptions);

  remoteMain.enable(win.webContents);

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
              filters: [{ name: "Markdown", extensions: ["md"] }],
              properties: ["openFile", "multiSelections"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              for (const filePath of result.filePaths) {
                const content = fs.readFileSync(filePath, "utf8");
                win.webContents.send("load-md", filePath, content);
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

ipcMain.on("print-to-pdf", async (event, content, title, exportSettings, targetPath) => {
  if (!printWin) {
    createPrintWindow();
    
    await new Promise(resolve => {
      printWin.webContents.once('did-finish-load', resolve);
    });
  }
  
  printWin.webContents.send('print-content', content, exportSettings);
  
  await new Promise(resolve => {
    ipcMain.once('content-ready', resolve);
  });
  
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

    const fontFamily = exportSettings?.font === 'jetbrains'
      ? '"JetBrains Mono", monospace'
      : '"Inter", -apple-system, BlinkMacSystemFont, sans-serif';

    const numSpan = pageNumbers === 'total'
      ? '<span class="pageNumber"></span> / <span class="totalPages"></span>'
      : '<span class="pageNumber"></span>';

    let footerPadding = '20mm';
    if (exportSettings?.margins === 'minimum' || exportSettings?.margins === 'none') {
      footerPadding = '10mm';
    }

    footerTemplate = `<div style="width:100%; display:flex; ${alignCss} padding:0 ${footerPadding}; font-size:9px; color:#666666; font-family:${fontFamily}; box-sizing:border-box;">${numSpan}</div>`;
  }

  let marginsType = 0;
  if (exportSettings?.margins === 'minimum') marginsType = 2;
  else if (exportSettings?.margins === 'none' && !displayHeaderFooter) marginsType = 1;
  else if (exportSettings?.margins === 'none' && displayHeaderFooter) marginsType = 2;
  else marginsType = 0;

  const options = {
    marginsType: marginsType,
    pageSize: exportSettings?.pageSize || 'A4',
    printBackground: true,
    printSelectionOnly: false,
    landscape: exportSettings?.orientation === 'landscape',
    displayHeaderFooter: displayHeaderFooter,
    headerTemplate: headerTemplate,
    footerTemplate: footerTemplate
  };

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
    const data = await printWin.webContents.printToPDF(options);
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