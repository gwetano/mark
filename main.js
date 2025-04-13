const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const remoteMain = require("@electron/remote/main");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "renderer.js"),
      nodeIntegration: true,
      contextIsolation: false
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
        { type: "separator" },
        { role: "quit", label: "Esci" }
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
          accelerator: "CmdOrCtrl+E",
          click: () => {
            win.webContents.send("toggle-preview");
          }
        },
        { type: "separator" },
        {
          label: "Dark Mode",
          accelerator: "CmdOrCtrl+M",
          click: () => {
            win.webContents.send("toggle-theme");
          }
        }
      ]
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Repeat",
          accelerator: "CmdOrCtrl+Shift+Z",
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
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    createWindow()
  if (process.argv.length >= 3) {
    const filePath = process.argv[2];
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('load-md', filePath, content);
      });
    } else {
      console.error(`Il file ${filePath} non esiste.`);
    }
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