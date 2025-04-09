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
          click: () => {
            const files = dialog.showOpenDialogSync(win, {
              properties: ["openFile"],
              filters: [{ name: "Markdown", extensions: ["md"] }]
            });
            if (files) {
              const content = fs.readFileSync(files[0], "utf8");
              win.webContents.send("load-md", content);
            }
          }
        },
        {
          label: "Salva come...",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            win.webContents.send("trigger-save");
          }
        },
        { type: "separator" },
        { role: "quit", label: "Esci" }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);
