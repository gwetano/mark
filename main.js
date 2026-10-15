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

function initializeRemote() {
  if (!remoteMain.isInitialized()) {
    remoteMain.initialize();
  }
}

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

  // Window control IPC handlers (for Windows/Linux custom buttons)
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on('window-close', () => win.close());
  ipcMain.on('get-platform', (event) => {
    event.returnValue = process.platform;
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
              properties: ["openFile"]
            });

            if (!result.canceled && result.filePaths.length > 0) {
              const filePath = result.filePaths[0];
              const content = fs.readFileSync(filePath, "utf8");
              win.webContents.send("load-md", filePath, content);
            }
          }
        },
        {
          label: i18n.t("menu_import"),
          accelerator: "CmdOrCtrl+I",
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
          accelerator: "CmdOrCtrl+E",
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
          accelerator: "CmdOrCtrl+L",
          click: () => {
            win.webContents.send("toggle-preview");
          }
        },
        {
          label: i18n.t("menu_preview"),
          accelerator: "CmdOrCtrl+P",
          click: () => {
            win.webContents.send("toggle-editor");
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
}

ipcMain.on("print-to-pdf", async (event, content, title) => {
  if (!printWin) {
    createPrintWindow();
    
    await new Promise(resolve => {
      printWin.webContents.once('did-finish-load', resolve);
    });
  }
  
  printWin.webContents.send('print-content', content);
  
  await new Promise(resolve => {
    ipcMain.once('content-ready', resolve);
  });
  
  const options = {
    marginsType: 1,
    pageSize: 'A4',
    printBackground: true,
    printSelectionOnly: false,
    landscape: false
  };

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
  
  try {
    const data = await printWin.webContents.printToPDF(options);
    fs.writeFile(result.filePath, data, (error) => {
      if (error) {
        console.error("Errore nel salvataggio del PDF:", error);
        return;
      }
      event.reply('pdf-saved', result.filePath);
    });
  } catch (error) {
    console.error("Errore nella generazione del PDF:", error);
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

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', () => {
    win.webContents.send('update-available');
  });

  autoUpdater.on('update-downloaded', () => {
    win.webContents.send('update-downloaded');
  });
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