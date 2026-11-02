/**
 * 打一个带初始化向导的安装包。
 * 用法：
 *   node 工具/build-installer.js          # 完整版（含作品语料）
 *   node 工具/build-installer.js --lite   # 分享版（不含 39 篇语料）
 *
 * 安装包是“自解压 + WinForms 安装器”：payload 追加在 exe 尾部，
 * 不包含 %APPDATA% 下的 settings.json / chat.json / API Key。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { signFiles } = require('./sign');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(ROOT, 'build');
const TOOLS = path.join(ROOT, '工具');
const VERSION = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
const LITE = process.argv.includes('--lite');
const LABEL = LITE ? '-lite' : '';
const STAGE = path.join(BUILD, 'stage-' + VERSION + LABEL);
const PORTABLE = path.join(DIST, `EternityCoffee-${VERSION}-win-x64`);
const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const REFS = [
  'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
  'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'
].map((name) => path.join('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319', name));

const MAGIC = 'ETERNITYCOFFEE01';

function run(cmd, args, opts) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function compile(source, out, extra = []) {
  const temp = path.join(BUILD, path.basename(out).replace(/\.exe$/i, '.cs'));
  let code = fs.readFileSync(source, 'utf8');
  if (source.endsWith('installer.cs')) code = code.replace('__VERSION__', VERSION);
  fs.writeFileSync(temp, '\ufeff' + code, 'utf8');
  run(CSC, [
    '/nologo', '/codepage:65001', '/utf8output', '/target:winexe',
    '/win32icon:' + path.join(ROOT, 'assets', 'ui', 'icon.ico'),
    '/out:' + out,
    ...extra,
    ...REFS.map((r) => '/reference:' + r),
    temp
  ]);
}

function zipDir(dir, out) {
  if (fs.existsSync(out)) fs.rmSync(out, { force: true });
  const ps = [
    '$ErrorActionPreference = "Stop";',
    `Compress-Archive -Path '${dir.replace(/'/g, "''")}\\*' -DestinationPath '${out.replace(/'/g, "''")}' -CompressionLevel Optimal -Force`
  ].join(' ');
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
}

function audit(dir) {
  const bad = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const rel = path.relative(dir, full).replace(/\\/g, '/');
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/(^|\/)(settings|chat|library|reading|serials)\.json$/i.test(rel) || /\.(key|pem)$/i.test(rel)) {
        bad.push(rel);
      }
    }
  };
  walk(dir);
  if (bad.length) throw new Error('安装包中出现了不应包含的个人数据：' + bad.join(', '));
}

fs.mkdirSync(BUILD, { recursive: true });

console.log('build portable ...');
run(process.execPath, [path.join(TOOLS, 'build-portable.js')], { cwd: ROOT });
if (!fs.existsSync(PORTABLE)) throw new Error('没有找到绿色版目录：' + PORTABLE);

console.log('sign app ...');
signFiles([
  path.join(PORTABLE, 'Eternity coffee.exe'),
  path.join(PORTABLE, 'EternityCoffee-runtime.exe')
]);

console.log('stage ...');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.cpSync(PORTABLE, STAGE, { recursive: true, dereference: true });
// 「作品」目录只放空壳，不应进入安装包；用户的作品始终在「文档」。
for (const rel of ['作品', path.join('resources', '作品'), path.join('assets', 'character', 'source')]) {
  fs.rmSync(path.join(STAGE, rel), { recursive: true, force: true });
}
if (LITE) {
  fs.rmSync(path.join(STAGE, 'resources', 'knowledge', 'corpus'), { recursive: true, force: true });
  // 分享版不带内部设定文档与真实署名，只保留运行所需的东西。
  fs.rmSync(path.join(STAGE, 'resources', 'docs'), { recursive: true, force: true });
  fs.rmSync(path.join(STAGE, 'README.md'), { force: true });
  const profilePath = path.join(STAGE, 'resources', 'knowledge', 'style-profile.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (profile.author) {
    profile.author.realName = 'Liven 的创作者';
    delete profile.author.born;
  }
  // 示例句来自原作，分享版不带走；文风规则与角色圣经保留。
  delete profile.samples;
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  console.log('lite: removed corpus/docs/README, sanitized author');
}

const icon = path.join(ROOT, 'assets', 'ui', 'icon.ico');
console.log('compile uninstaller ...');
compile(path.join(TOOLS, 'uninstaller.cs'), path.join(STAGE, 'Uninstall.exe'));
console.log('sign uninstaller ...');
signFiles([path.join(STAGE, 'Uninstall.exe')]);

audit(STAGE);

const payloadZip = path.join(BUILD, `payload-${VERSION}${LABEL}.zip`);
console.log('zip payload ...');
zipDir(STAGE, payloadZip);
const payload = fs.readFileSync(payloadZip);
console.log('payload MB:', (payload.length / 1024 / 1024).toFixed(1));

console.log('compile installer ...');
const setupBase = path.join(BUILD, `EternityCoffee-Setup-${VERSION}${LABEL}.base.exe`);
compile(path.join(TOOLS, 'installer.cs'), setupBase);

const setupExe = path.join(DIST, `EternityCoffee-Setup-${VERSION}${LABEL}.exe`);
const base = fs.readFileSync(setupBase);
const footer = Buffer.alloc(56);
crypto.createHash('sha256').update(payload).digest().copy(footer, 0);
footer.writeBigInt64LE(BigInt(payload.length), 32);
footer.write(MAGIC, 40, 'ascii');
fs.writeFileSync(setupExe, Buffer.concat([base, payload, footer]));

console.log('sign installer ...');
signFiles([setupExe]);

const sha = crypto.createHash('sha256').update(fs.readFileSync(setupExe)).digest('hex');
console.log(JSON.stringify({
  installer: setupExe,
  size: fs.statSync(setupExe).size,
  sha256: sha,
  lite: LITE,
  version: VERSION
}, null, 2));
