using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

class EternityLauncher
{
    [STAThread]
    static void Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(dir, "EternityCoffee-runtime.exe");
        if (!File.Exists(runtime))
        {
            MessageBox.Show("找不到 EternityCoffee-runtime.exe，请重新解压完整的绿色版。",
                "Eternity coffee", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var sb = new StringBuilder();
        foreach (string a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append('"').Append(a.Replace("\"", "\\\"")).Append('"');
        }

        var psi = new ProcessStartInfo(runtime)
        {
            WorkingDirectory = dir,
            UseShellExecute = true,
            Arguments = sb.ToString()
        };
        // 某些开发环境会全局设置 ELECTRON_RUN_AS_NODE，导致 Electron 以纯 Node 启动
        Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null);
        try { Process.Start(psi); }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败：" + ex.Message, "Eternity coffee",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
