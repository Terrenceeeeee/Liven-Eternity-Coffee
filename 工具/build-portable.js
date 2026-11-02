/**
 * 打一个绿色版：dist/EternityCoffee-<版本>-win-x64/
 * 解压后双击 Eternity coffee.exe 即可运行，不需要安装。
 * 只用 Electron 自带的运行时和 docx 运行依赖，不打包 devDependencies。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, `EternityCoffee-${VERSION}-win-x64`);
const ELECTRON_DIST = path.join(APP, 'node_modules', 'electron', 'dist');

function copy(src, dest) {
  if (!fs.existsSync(src)) throw new Error('缺少文件：' + src);
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function real(p) {
  return fs.realpathSync(p);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. Electron 运行时
console.log('copy electron runtime ...');
copy(ELECTRON_DIST, OUT);
const exe = path.join(OUT, 'electron.exe');
if (!fs.existsSync(exe)) throw new Error('Electron 运行时里没有 electron.exe');
fs.renameSync(exe, path.join(OUT, 'EternityCoffee-runtime.exe'));

// Electron 运行时本身带的是 Electron 图标。把咖啡杯图标嵌进去，
// 任务栏在拿不到窗口图标时会回退到 exe 图标，这样也不会再显示默认图标。
const runtimeExe = path.join(OUT, 'EternityCoffee-runtime.exe');
const rcedit = path.join(APP, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
if (!fs.existsSync(rcedit)) throw new Error('缺少 rcedit，请先在 app 目录安装开发依赖。');
console.log('embed app icon into runtime ...');
execFileSync(rcedit, [runtimeExe, '--set-icon', path.join(ROOT, 'assets', 'ui', 'icon.ico')], { stdio: 'inherit' });

// 2. 应用代码
const RES = path.join(OUT, 'resources');
const APP_OUT = path.join(RES, 'app');
fs.mkdirSync(APP_OUT, { recursive: true });
for (const item of ['main.js', 'preload.js', 'engine', 'src']) {
  copy(path.join(APP, item), path.join(APP_OUT, item));
}

// 3. 运行依赖（pnpm 的软链接要解引用后复制成扁平目录）
const NM = path.join(APP_OUT, 'node_modules');
fs.mkdirSync(NM, { recursive: true });
const docxReal = real(path.join(APP, 'node_modules', 'docx'));
const depsDir = path.dirname(docxReal);
copy(docxReal, path.join(NM, 'docx'));
for (const name of ['fflate', 'nanoid']) {
  copy(real(path.join(depsDir, name)), path.join(NM, name));
}

// 4. 应用清单（不含 electron / 开发依赖）
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
const prod = {
  name: pkg.name || 'liven-pet',
  version: VERSION,
  description: pkg.description || '虚拟 Liven 桌宠与写作间',
  main: 'main.js',
  private: true,
  dependencies: { docx: pkg.dependencies.docx }
};
fs.writeFileSync(path.join(APP_OUT, 'package.json'), JSON.stringify(prod, null, 2), 'utf8');

// 5. 资源、知识库、文档、作品目录
console.log('copy assets / knowledge / docs ...');
for (const item of ['assets', 'knowledge', 'docs']) {
  copy(path.join(ROOT, item), path.join(RES, item));
}
for (const item of ['小说', '文学推荐', '读书感想', '连载']) {
  fs.mkdirSync(path.join(RES, '作品', item), { recursive: true });
  fs.mkdirSync(path.join(OUT, '作品', item), { recursive: true });
}
copy(path.join(ROOT, 'README.md'), path.join(OUT, 'README.md'));
// 带自定义图标的启动器（小 exe，启动同目录的 Electron 运行时）
copy(path.join(ROOT, '工具', 'Eternity coffee.exe'), path.join(OUT, 'Eternity coffee.exe'));
copy(path.join(ROOT, 'assets', 'ui', 'icon.ico'), path.join(OUT, 'Eternity coffee.ico'));

// 6. 启动脚本（纯 ASCII + CRLF，避免 cmd 解析中文/换行出问题）
const bat = [
  '@echo off',
  'chcp 65001 >nul',
  'set "ELECTRON_RUN_AS_NODE="',
  'cd /d "%~dp0"',
  'start "" "Eternity coffee.exe"',
  ''
].join('\r\n');
fs.writeFileSync(path.join(OUT, '启动 Eternity coffee.bat'), bat, 'utf8');

console.log('done:', OUT);
console.log('size(MB):', (fs.statSync(path.join(OUT, 'EternityCoffee-runtime.exe')).size / 1024 / 1024).toFixed(1));
