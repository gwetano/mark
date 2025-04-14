const { app, BrowserWindow, Menu, dialog, clipboard } = require("electron");
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
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          role: "undo"
        },
        {
          label: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          role: "redo"
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

app.whenReady().then(() => {
  createWindow();
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