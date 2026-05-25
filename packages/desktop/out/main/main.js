"use strict";
const electron = require("electron");
const path = require("path");
function createMenu(win) {
  const isMac = process.platform === "darwin";
  const template = [
    ...isMac ? [
      {
        label: electron.app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    {
      label: "文件",
      submenu: [
        {
          label: "打开文件夹...",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            win.webContents.send("menu:openFolder");
          }
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "查看",
      submenu: [
        {
          label: "Agent 模式",
          accelerator: "CmdOrCtrl+Shift+A",
          click: () => win.webContents.send("menu:switchMode", "agent")
        },
        {
          label: "编辑器模式",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => win.webContents.send("menu:switchMode", "ide")
        },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "报告问题",
          click: () => electron.shell.openExternal("https://github.com")
        }
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(template);
  electron.Menu.setApplicationMenu(menu);
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1e1e1e",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}
electron.app.whenReady().then(() => {
  const win = createWindow();
  createMenu(win);
  electron.ipcMain.handle("ping", () => "pong");
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
