'use strict';
// 开发用：不启动完整应用，只把页面渲染成图片，检查布局。
// 用法： electron shot.js studio|pet
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const which = process.argv[2] === 'pet' ? 'pet' : 'studio';
const isPet = which === 'pet';

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: isPet ? 380 : 1200,
    height: isPet ? 560 : 820,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: { offscreen: false, javascript: false, contextIsolation: true }
  });
  await win.loadFile(path.join(__dirname, 'src', isPet ? 'pet.html' : 'studio.html'));
  await new Promise((r) => setTimeout(r, 700));
  const image = await win.webContents.capturePage();
  const dir = path.join(__dirname, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, which + '.png');
  fs.writeFileSync(out, image.toPNG());
  console.log(out);
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
