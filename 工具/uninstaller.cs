using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Eternity coffee Uninstall")]
[assembly: AssemblyProduct("Eternity coffee")]
[assembly: AssemblyCompany("Eternity coffee")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace EternityUninstall
{
    internal static class Paths
    {
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\EternityCoffee";
        public static string DataDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "liven-pet"); }
        }
        public static string WorksDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Eternity coffee", "作品"); }
        }
        public static string StartMenuDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Eternity coffee"); }
        }
    }

    internal static class Cleanup
    {
        public static void Shortcuts()
        {
            try { if (Directory.Exists(Paths.StartMenuDir)) Directory.Delete(Paths.StartMenuDir, true); } catch { }
            string desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Eternity coffee.lnk");
            try { if (File.Exists(desk)) File.Delete(desk); } catch { }
        }

        public static void RemoveRegistry()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(Paths.UninstallKey, false); } catch { }
            // 卸载后不应该再随开机启动：运行项也要一起清掉。
            try
            {
                using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (run != null) run.DeleteValue("com.eternitycoffee.liven", false);
                }
            }
            catch { }
        }

        public static bool IsRunning(string dir)
        {
            try
            {
                foreach (Process p in Process.GetProcessesByName("EternityCoffee-runtime"))
                {
                    try
                    {
                        string file = p.MainModule.FileName;
                        if (file.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) return true;
                    }
                    catch { return true; }
                }
            }
            catch { }
            return false;
        }

        public static void DeleteDir(string dir, int tries)
        {
            for (int i = 0; i < tries; i++)
            {
                try { if (Directory.Exists(dir)) Directory.Delete(dir, true); return; }
                catch { Thread.Sleep(350); }
            }
        }

        public static void RemoveAll(string dir, bool data, bool works)
        {
            Shortcuts();
            RemoveRegistry();
            DeleteDir(dir, 20);
            if (data) DeleteDir(Paths.DataDir, 5);
            if (works) DeleteDir(Paths.WorksDir, 5);
        }

        public static void SelfDelete()
        {
            string me = Application.ExecutablePath;
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c ping 127.0.0.1 -n 3 >nul & del \"" + me + "\"",
                    CreateNoWindow = true,
                    UseShellExecute = false
                });
            }
            catch { }
        }
    }

    internal class UninstallForm : Form
    {
        private readonly CheckBox data;
        private readonly CheckBox works;
        private readonly string dir;

        public UninstallForm(string dir)
        {
            this.dir = dir;
            Text = "卸载 Eternity coffee";
            ClientSize = new Size(520, 372);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(246, 241, 230);

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 78;
            header.BackColor = Color.FromArgb(51, 69, 61);
            Controls.Add(header);

            Label title = new Label();
            title.Text = "要让她离开这台电脑吗？";
            title.ForeColor = Color.FromArgb(247, 241, 228);
            title.Font = new Font("Microsoft YaHei UI", 15F);
            title.AutoSize = true;
            title.Location = new Point(26, 24);
            header.Controls.Add(title);

            Label body = new Label();
            body.AutoSize = false;
            body.Location = new Point(26, 104);
            body.Size = new Size(466, 120);
            body.ForeColor = Color.FromArgb(96, 89, 76);
            body.Text = "会删除程序文件和开始菜单/桌面快捷方式。\n\n" +
                "下面两项默认不勾选：聊天、API Key、书架和作品都是你的东西，是否一起删除由你决定。";
            Controls.Add(body);

            data = new CheckBox();
            data.Text = "同时删除本机数据（聊天、API Key、书架、阅读、连载）";
            data.AutoSize = true;
            data.Location = new Point(28, 228);
            Controls.Add(data);

            works = new CheckBox();
            works.Text = "同时删除作品（文档\\Eternity coffee\\作品）";
            works.AutoSize = true;
            works.Location = new Point(28, 258);
            Controls.Add(works);

            Button cancel = new Button();
            cancel.Text = "取消";
            cancel.Size = new Size(100, 34);
            cancel.Location = new Point(286, 314);
            cancel.FlatStyle = FlatStyle.Flat;
            cancel.BackColor = Color.FromArgb(255, 253, 247);
            cancel.FlatAppearance.BorderColor = Color.FromArgb(217, 205, 184);
            cancel.Click += (s, e) => Close();
            Controls.Add(cancel);

            Button remove = new Button();
            remove.Text = "卸载";
            remove.Size = new Size(100, 34);
            remove.Location = new Point(396, 314);
            remove.FlatStyle = FlatStyle.Flat;
            remove.BackColor = Color.FromArgb(51, 69, 61);
            remove.ForeColor = Color.FromArgb(247, 241, 228);
            remove.FlatAppearance.BorderColor = Color.FromArgb(51, 69, 61);
            remove.Click += (s, e) => Remove();
            Controls.Add(remove);
        }

        private void Remove()
        {
            if (Cleanup.IsRunning(dir))
            {
                MessageBox.Show("Eternity coffee 还在运行。先右键托盘图标退出，再卸载。", "Eternity coffee", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            bool delData = data.Checked;
            bool delWorks = works.Checked;
            try
            {
                string temp = Path.Combine(Path.GetTempPath(), "EternityCoffee-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                File.Copy(Application.ExecutablePath, temp, true);
                string args = "--run \"" + dir + "\"" + (delData ? " --data" : "") + (delWorks ? " --works" : "");
                Process.Start(new ProcessStartInfo(temp, args) { UseShellExecute = true });
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动卸载失败：\n" + ex.Message, "Eternity coffee", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            bool run = args.Any(a => a.Equals("--run", StringComparison.OrdinalIgnoreCase));
            bool silent = args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase));
            bool data = args.Any(a => a.Equals("--data", StringComparison.OrdinalIgnoreCase));
            bool works = args.Any(a => a.Equals("--works", StringComparison.OrdinalIgnoreCase));
            foreach (string arg in args)
            {
                if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                    dir = arg.Substring(5).Trim('"');
            }
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i].Equals("--run", StringComparison.OrdinalIgnoreCase))
                    dir = args[i + 1].Trim('"');
            }

            if (run)
            {
                Cleanup.RemoveAll(dir, data, works);
                Cleanup.SelfDelete();
                Environment.Exit(0);
            }

            if (silent)
            {
                try
                {
                    string temp = Path.Combine(Path.GetTempPath(), "EternityCoffee-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
                    File.Copy(Application.ExecutablePath, temp, true);
                    string runArgs = "--run \"" + dir + "\"" + (data ? " --data" : "") + (works ? " --works" : "");
                    Process.Start(new ProcessStartInfo(temp, runArgs) { UseShellExecute = true });
                    Environment.Exit(0);
                }
                catch (Exception ex)
                {
                    File.WriteAllText(Path.Combine(Path.GetTempPath(), "eternity-uninstall-error.txt"), ex.ToString(), Encoding.UTF8);
                    Environment.Exit(1);
                }
            }

            Application.Run(new UninstallForm(dir));
        }
    }
}
