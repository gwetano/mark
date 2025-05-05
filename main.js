const { app, BrowserWindow, Menu, dialog, clipboard, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const remoteMain = require("@electron/remote/main");

let win;
let printWin = null;
let openFilePath = null; 


function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      nodeIntegration: true,
      contextIsolation: false,
      clipboard: true
    }
  });

  remoteMain.initialize();
  remoteMain.enable(win.webContents);

  win.loadFile("index.html");

  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "New file",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            win.webContents.send("new-file");
          }
        },
        {
          label: "Open file",
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
          label: "Open folder",
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
          label: "Save...",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            win.webContents.send("trigger-save");
          }
        },
        {
          label: "Export as PDF",
          accelerator: "CmdOrCtrl+E",
          click: () => {
            win.webContents.send("export-pdf");
          }
        },
        { type: "separator" },
        { role: "quit", label: "Esci" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          role: "undo"
        },
        { type: "separator" },
        {
          label: "Cut",
          accelerator: "CmdOrCtrl+X",
          role: "cut"
        },
        {
          label: "Copy",
          accelerator: "CmdOrCtrl+C",
          role: "copy"
        },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          role: "paste"
        },
        { type: "separator" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          role: "selectAll"
        },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            win.webContents.send("open-search");
          }
        },
        { type: "separator" },
        {
          label: "Insert Image from File",
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
          label: "Paste Image from Clipboard",
          accelerator: "CmdOrCtrl+Shift+V",
          click: () => {
            win.webContents.send("paste-image-from-clipboard");
          }
        }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Explorer",
          accelerator: "CmdOrCtrl+B",
          click: () => {
            win.webContents.send("toggle-explorer");
          }
        },
        {
          label: "Only Editor",
          accelerator: "Alt+E",
          click: () => {
            win.webContents.send("toggle-preview");
          }
        },
        { type: "separator" },
        {
          label: "Dark Mode",
          accelerator: "Alt+M",
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
    show: false, // Finestra nascosta
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  printWin.loadFile('print.html');
  
  // Facoltativo: per debug
  // printWin.webContents.openDevTools();
}

ipcMain.on("print-to-pdf", async (event, content, title) => {
  // Crea la finestra di stampa se non esiste
  if (!printWin) {
    createPrintWindow();
    
    // Attendi che la finestra sia pronta
    await new Promise(resolve => {
      printWin.webContents.once('did-finish-load', resolve);
    });
  }
  
  // Invia il contenuto alla finestra di stampa
  printWin.webContents.send('print-content', content);
  
  // Attendi che il contenuto sia elaborato
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
    title: "Salva PDF",
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

if (process.platform !== 'darwin') {
  const passedFile = process.argv.find(arg => arg.endsWith(".md"));
  if (passedFile) openFilePath = passedFile;
}

app.whenReady().then(() => {
  createWindow();

  if (openFilePath && fs.existsSync(openFilePath)) {
    const content = fs.readFileSync(openFilePath, 'utf8');
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('load-md', openFilePath, content);
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
  openFilePath = filePath;

  if (app.isReady() && win) {
    const content = fs.readFileSync(openFilePath, 'utf8');
    win.webContents.send('load-md', openFilePath, content);
  }
});
