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
          label: "Apri...",
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
          label: "Salva...",
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
      label: "Shorts",
      submenu: [
        {
          label: "Annulla",
          accelerator: "CmdOrCtrl+Z",
          enabled: false,
        },
        {
          label: "Taglia",
          accelerator: "CmdOrCtrl+X",
          enabled: false,
        },
        {
          label: "Copia",
          accelerator: "CmdOrCtrl+C",
          enabled: false,
        },
        {
          label: "Incolla",
          accelerator: "CmdOrCtrl+V",
          enabled: false,
        },
        { type: "separator" },
        {
          label: "Dark Mode",
          accelerator: "Alt+M",
          enabled: false,
        },
        {
          label: "Nascondi Preview",
          accelerator: "Alt+E",
          enabled: false,
        },
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);
