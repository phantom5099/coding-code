import { app, BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron'

export function createMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开文件夹...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            // Handled in renderer via IPC
            win.webContents.send('menu:openFolder')
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '查看',
      submenu: [
        {
          label: 'Agent 模式',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => win.webContents.send('menu:switchMode', 'agent'),
        },
        {
          label: '编辑器模式',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => win.webContents.send('menu:switchMode', 'ide'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '报告问题',
          click: () => shell.openExternal('https://github.com'),
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
