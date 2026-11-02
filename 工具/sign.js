const path = require('path');
const { spawnSync } = require('child_process');

/**
 * 用当前用户的 Code Signing 证书（CN=Terrence）给文件签名。
 * 证书缺失时会自动创建一张自签名根证书 + 一张代码签名证书，
 * 并把根证书放进当前用户的 Root 存储，所以本机看到的签名是有效的。
 *
 * 注意：这是自签名证书。别人机器没有信任这张根证书时，
 * Windows 仍会显示“未知发布者”；要彻底消除需要 CA 签发的正式证书。
 */
function signFiles(files) {
  if (!files.length) return;
  if (String(process.env.SKIP_SIGN || '') === '1') {
    console.log('sign: skipped (SKIP_SIGN=1)');
    return;
  }
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(__dirname, 'sign.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...files];
  const r = spawnSync(powershell, args, { stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('code signing failed');
}

module.exports = { signFiles };
