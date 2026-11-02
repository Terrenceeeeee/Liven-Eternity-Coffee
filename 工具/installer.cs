using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Eternity coffee Setup")]
[assembly: AssemblyDescription("Eternity coffee / Liven 桌宠与写作间")]
[assembly: AssemblyProduct("Eternity coffee")]
[assembly: AssemblyCompany("Eternity coffee")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace EternitySetup
{
    internal static class Constants
    {
        public const string AppVersion = "__VERSION__";
        public const string AppName = "Eternity coffee";
        public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\EternityCoffee";
        public const string PayloadMagic = "ETERNITYCOFFEE01";
        public const int FooterSize = 56;
    }

    internal static class Payload
    {
        public static byte[] Load()
        {
            string exe = Application.ExecutablePath;
            byte[] all = File.ReadAllBytes(exe);
            if (all.Length < Constants.FooterSize) throw new InvalidDataException("安装包不完整。");

            int footer = FindFooter(all, OverlayEnd(all));
            if (footer < 0) throw new InvalidDataException("安装包不完整。");
            byte[] hash = new byte[32];
            Array.Copy(all, footer, hash, 0, 32);
            long length = BitConverter.ToInt64(all, footer + 32);
            string magic = Encoding.ASCII.GetString(all, footer + 40, 16);
            if (magic != Constants.PayloadMagic) throw new InvalidDataException("安装包格式不正确。");
            if (length <= 0 || length > footer) throw new InvalidDataException("安装包大小不正确。");

            long offset = footer - length;
            byte[] payload = new byte[length];
            Array.Copy(all, offset, payload, 0, length);

            using (SHA256 sha = SHA256.Create())
            {
                byte[] actual = sha.ComputeHash(payload);
                for (int i = 0; i < 32; i++)
                {
                    if (actual[i] != hash[i]) throw new InvalidDataException("安装包校验失败，请重新下载。");
                }
            }
            return payload;
        }

        // 签名后的安装包会把 Authenticode 证书表追加到文件末尾；
        // payload + footer 在证书表之前，中间还可能有 0–7 字节对齐填充。
        private static int OverlayEnd(byte[] all)
        {
            try
            {
                int pe = BitConverter.ToInt32(all, 0x3C);
                if (pe <= 0 || pe + 24 > all.Length) return all.Length;
                ushort optSize = BitConverter.ToUInt16(all, pe + 20);
                int opt = pe + 24;
                if (opt + optSize > all.Length) return all.Length;
                ushort magic = BitConverter.ToUInt16(all, opt);
                int dirs = magic == 0x20B ? opt + 112 : opt + 96;
                int security = dirs + 4 * 8;
                if (security + 8 > all.Length) return all.Length;
                int certOffset = BitConverter.ToInt32(all, security);
                int certSize = BitConverter.ToInt32(all, security + 4);
                if (certOffset > 0 && certSize > 0 && (long)certOffset + certSize <= all.Length)
                    return certOffset;
            }
            catch { }
            return all.Length;
        }

        private static int FindFooter(byte[] all, int end)
        {
            int max = end - Constants.FooterSize;
            int min = Math.Max(0, max - 8);
            for (int f = max; f >= min; f--)
            {
                if (f + Constants.FooterSize > all.Length) continue;
                string magic = Encoding.ASCII.GetString(all, f + 40, 16);
                if (magic != Constants.PayloadMagic) continue;
                long length = BitConverter.ToInt64(all, f + 32);
                if (length > 0 && length <= f) return f;
            }
            return -1;
        }

        public static void ExtractTo(byte[] payload, string dir, Action<int> progress)
        {
            Directory.CreateDirectory(dir);
            using (MemoryStream ms = new MemoryStream(payload, false))
            using (ZipArchive zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                int total = zip.Entries.Count;
                int done = 0;
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string target = Path.GetFullPath(Path.Combine(dir, name));
                    string root = Path.GetFullPath(dir) + Path.DirectorySeparatorChar;
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("安装包包含非法路径。");

                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Directory.CreateDirectory(target);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                    done++;
                    if (progress != null && (done % 40 == 0 || done == total))
                        progress((int)(done * 100L / Math.Max(1, total)));
                }
            }
        }
    }

    internal static class Shell
    {
        public static void Shortcut(string path, string target, string args, string icon, string desc)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(type);
            object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
            Type lt = link.GetType();
            lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { target });
            lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { Path.GetDirectoryName(target) });
            lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { icon });
            lt.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { desc });
            if (!string.IsNullOrEmpty(args))
                lt.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { args });
            lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }
    }

    internal static class InstallCore
    {
        public static string DefaultDir()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(Constants.UninstallKey))
            {
                if (key != null)
                {
                    string existing = key.GetValue("InstallLocation") as string;
                    if (!string.IsNullOrEmpty(existing)) return existing;
                }
            }
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Eternity coffee");
        }

        public static void WriteShortcuts(string dir, bool desktop)
        {
            string exe = Path.Combine(dir, "Eternity coffee.exe");
            string icon = Path.Combine(dir, "Eternity coffee.ico");
            string start = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Eternity coffee");
            Shell.Shortcut(Path.Combine(start, "Eternity coffee.lnk"), exe, "", icon, "Eternity coffee");
            string uninstall = Path.Combine(dir, "Uninstall.exe");
            if (File.Exists(uninstall))
                Shell.Shortcut(Path.Combine(start, "卸载 Eternity coffee.lnk"), uninstall, "", icon, "卸载 Eternity coffee");
            if (desktop)
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                Shell.Shortcut(Path.Combine(desk, "Eternity coffee.lnk"), exe, "", icon, "Eternity coffee");
            }
        }

        public static void RemoveShortcuts()
        {
            string start = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Eternity coffee");
            try { if (Directory.Exists(start)) Directory.Delete(start, true); } catch { }
            string desk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Eternity coffee.lnk");
            try { if (File.Exists(desk)) File.Delete(desk); } catch { }
        }

        public static void WriteRegistry(string dir)
        {
            string exe = Path.Combine(dir, "Eternity coffee.exe");
            string uninstall = Path.Combine(dir, "Uninstall.exe");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Constants.UninstallKey))
            {
                key.SetValue("DisplayName", "Eternity coffee");
                key.SetValue("DisplayVersion", Constants.AppVersion);
                key.SetValue("Publisher", "Eternity coffee / Liven");
                key.SetValue("InstallLocation", dir);
                key.SetValue("DisplayIcon", exe + ",0");
                key.SetValue("UninstallString", "\"" + uninstall + "\"");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", DirectorySizeKb(dir), RegistryValueKind.DWord);
            }
        }

        public static void RemoveRegistry()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(Constants.UninstallKey, false); } catch { }
        }

        private static int DirectorySizeKb(string dir)
        {
            try
            {
                long bytes = Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
                return (int)Math.Min(int.MaxValue, bytes / 1024);
            }
            catch { return 0; }
        }

        public static void Launch(string dir)
        {
            string exe = Path.Combine(dir, "Eternity coffee.exe");
            ProcessStartInfo psi = new ProcessStartInfo(exe);
            psi.WorkingDirectory = dir;
            psi.UseShellExecute = true;
            try { Process.Start(psi); } catch { }
        }
    }

    internal class SetupForm : Form
    {
        private readonly Panel page1;
        private readonly Panel page2;
        private readonly Panel page3;
        private readonly Panel page4;
        private readonly TextBox pathBox;
        private readonly CheckBox agree;
        private readonly CheckBox desktop;
        private readonly CheckBox launch;
        private readonly ProgressBar bar;
        private readonly Label status;
        private readonly Button installBtn;
        private string installDir;

        public SetupForm()
        {
            Text = "Eternity coffee · 安装";
            ClientSize = new Size(660, 508);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            Font = new Font("Microsoft YaHei UI", 9F);
            BackColor = Color.FromArgb(244, 239, 228);

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 92;
            header.BackColor = Color.FromArgb(51, 69, 61);
            Controls.Add(header);

            Label brand = new Label();
            brand.Text = "Eternity coffee";
            brand.ForeColor = Color.FromArgb(247, 241, 228);
            brand.Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Regular);
            brand.AutoSize = true;
            brand.Location = new Point(30, 18);
            header.Controls.Add(brand);

            Label sub = new Label();
            sub.Text = "Liven · 桌宠与写作间";
            sub.ForeColor = Color.FromArgb(214, 199, 172);
            sub.Font = new Font("Microsoft YaHei UI", 9F);
            sub.AutoSize = true;
            sub.Location = new Point(33, 58);
            header.Controls.Add(sub);

            page1 = new Panel(); page2 = new Panel(); page3 = new Panel(); page4 = new Panel();
            foreach (Panel p in new[] { page1, page2, page3, page4 })
            {
                p.Dock = DockStyle.Fill;
                p.BackColor = Color.FromArgb(246, 241, 230);
                p.Padding = new Padding(34, 24, 34, 18);
                Controls.Add(p);
                p.BringToFront();
            }

            // ---- page 1 ----
            Label h1 = Title("先说明白：她住在这里");
            page1.Controls.Add(h1);
            Label p1 = Para("这是一个完全离线的桌面小店。安装包是干净的：不含你或任何人的聊天记录、API Key、书架和作品。\n\n" +
                "• 聊天与 API Key 存在这台电脑的 %APPDATA%\\liven-pet，只属于当前 Windows 用户。\n" +
                "• 她写的作品默认放在「文档\\Eternity coffee\\作品」，和程序分开，卸载也不会删。\n" +
                "• 分享软件时，只分享这个安装包，不要把数据目录压缩给别人。", 20, 66, 580, 220);
            page1.Controls.Add(p1);
            agree = new CheckBox();
            agree.Text = "我了解了，开始安装";
            agree.AutoSize = true;
            agree.Location = new Point(24, 292);
            page1.Controls.Add(agree);
            Button next1 = Button("下一步", true);
            next1.Click += (s, e) => { if (!agree.Checked) { MessageBox.Show("先勾选「我了解了」。", "Eternity coffee"); return; } ShowPage(1); };
            page1.Controls.Add(next1);
            next1.Location = new Point(514, 380);

            // ---- page 2 ----
            page2.Controls.Add(Title("装在哪里"));
            page2.Controls.Add(Para("建议保持默认位置。安装只写给当前用户，不需要管理员权限；升级会保留聊天、Key 和作品。", 20, 64, 580, 60));
            Label pl = new Label(); pl.Text = "安装目录"; pl.AutoSize = true; pl.Location = new Point(22, 136); page2.Controls.Add(pl);
            pathBox = new TextBox();
            pathBox.Location = new Point(24, 160);
            pathBox.Width = 470;
            pathBox.Text = InstallCore.DefaultDir();
            page2.Controls.Add(pathBox);
            Button browse = Button("浏览…", false);
            browse.Click += (s, e) => { FolderBrowserDialog d = new FolderBrowserDialog(); d.SelectedPath = pathBox.Text; if (d.ShowDialog(this) == DialogResult.OK) pathBox.Text = d.SelectedPath; };
            browse.Location = new Point(504, 158);
            browse.Width = 90;
            page2.Controls.Add(browse);
            desktop = new CheckBox(); desktop.Text = "创建桌面快捷方式"; desktop.AutoSize = true; desktop.Checked = true; desktop.Location = new Point(24, 210); page2.Controls.Add(desktop);
            launch = new CheckBox(); launch.Text = "安装完成后启动 Eternity coffee"; launch.AutoSize = true; launch.Checked = true; launch.Location = new Point(24, 238); page2.Controls.Add(launch);
            Label note = new Label();
            note.Text = "卸载：开始菜单 → Eternity coffee → 卸载；或在「设置 → 应用」里找到它。";
            note.AutoSize = false; note.Width = 580; note.Height = 40; note.ForeColor = Color.FromArgb(120, 112, 98);
            note.Location = new Point(22, 286);
            page2.Controls.Add(note);
            Button back2 = Button("上一步", false);
            back2.Click += (s, e) => ShowPage(0);
            back2.Location = new Point(24, 380);
            page2.Controls.Add(back2);
            installBtn = Button("开始安装", true);
            installBtn.Location = new Point(500, 380);
            installBtn.Click += (s, e) => StartInstall();
            page2.Controls.Add(installBtn);

            // ---- page 3 ----
            page3.Controls.Add(Title("正在开门"));
            Label p3 = Para("会把约 240 MB 的程序文件写到安装目录。第一次启动还需要一分钟左右。", 20, 64, 580, 70);
            page3.Controls.Add(p3);
            bar = new ProgressBar();
            bar.Location = new Point(24, 168);
            bar.Width = 580;
            bar.Height = 18;
            page3.Controls.Add(bar);
            status = new Label();
            status.Text = "准备中……";
            status.AutoSize = true;
            status.Location = new Point(24, 200);
            status.ForeColor = Color.FromArgb(110, 100, 86);
            page3.Controls.Add(status);

            // ---- page 4 ----
            page4.Controls.Add(Title("装好了"));
            Label p4 = Para("Eternity coffee 已经在这台电脑上。第一次启动会问她几个问题：数据放哪里、要不要接通语言模型、作品目录。", 20, 64, 580, 120);
            page4.Controls.Add(p4);
            Button openFolder = Button("打开安装目录", false);
            openFolder.Location = new Point(24, 300);
            openFolder.Click += (s, e) => { try { Process.Start("explorer.exe", installDir); } catch { } };
            page4.Controls.Add(openFolder);
            Button finish = Button("完成", true);
            finish.Location = new Point(500, 300);
            finish.Click += (s, e) => Close();
            page4.Controls.Add(finish);

            ShowPage(0);
        }

        private static Label Title(string text)
        {
            Label l = new Label();
            l.Text = text;
            l.Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Regular);
            l.ForeColor = Color.FromArgb(43, 47, 43);
            l.AutoSize = true;
            l.Location = new Point(20, 16);
            return l;
        }

        private static Label Para(string text, int x, int y, int w, int h)
        {
            Label l = new Label();
            l.Text = text;
            l.AutoSize = false;
            l.Location = new Point(x, y);
            l.Size = new Size(w, h);
            l.ForeColor = Color.FromArgb(96, 89, 76);
            l.Font = new Font("Microsoft YaHei UI", 9.5F);
            return l;
        }

        private static Button Button(string text, bool primary)
        {
            Button b = new Button();
            b.Text = text;
            b.Size = new Size(112, 34);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 1;
            b.Cursor = Cursors.Hand;
            if (primary)
            {
                b.BackColor = Color.FromArgb(51, 69, 61);
                b.ForeColor = Color.FromArgb(247, 241, 228);
                b.FlatAppearance.BorderColor = Color.FromArgb(51, 69, 61);
            }
            else
            {
                b.BackColor = Color.FromArgb(255, 253, 247);
                b.ForeColor = Color.FromArgb(80, 73, 62);
                b.FlatAppearance.BorderColor = Color.FromArgb(217, 205, 184);
            }
            return b;
        }

        private void ShowPage(int index)
        {
            page1.Visible = index == 0;
            page2.Visible = index == 1;
            page3.Visible = index == 2;
            page4.Visible = index == 3;
        }

        private void StartInstall()
        {
            installDir = pathBox.Text.Trim();
            if (installDir.Length == 0)
            {
                MessageBox.Show("安装目录不能为空。", "Eternity coffee");
                return;
            }
            try { installDir = Path.GetFullPath(installDir); }
            catch { MessageBox.Show("安装目录不正确。", "Eternity coffee"); return; }

            installBtn.Enabled = false;
            ShowPage(2);
            status.Text = "正在解压……";
            bar.Value = 0;

            BackgroundWorker worker = new BackgroundWorker();
            worker.WorkerReportsProgress = true;
            worker.DoWork += (s, e) =>
            {
                byte[] payload = Payload.Load();
                Payload.ExtractTo(payload, installDir, p => worker.ReportProgress(p));
            };
            worker.ProgressChanged += (s, e) => { bar.Value = Math.Max(0, Math.Min(100, e.ProgressPercentage)); status.Text = "正在解压…… " + e.ProgressPercentage + "%"; };
            worker.RunWorkerCompleted += (s, e) =>
            {
                if (e.Error != null)
                {
                    MessageBox.Show("安装失败：\n" + e.Error.Message, "Eternity coffee", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    installBtn.Enabled = true;
                    ShowPage(1);
                    return;
                }
                try
                {
                    InstallCore.WriteShortcuts(installDir, desktop.Checked);
                    InstallCore.WriteRegistry(installDir);
                    bar.Value = 100;
                    status.Text = "完成。";
                    ShowPage(3);
                    if (launch.Checked) InstallCore.Launch(installDir);
                }
                catch (Exception ex)
                {
                    MessageBox.Show("安装完成，但创建快捷方式失败：\n" + ex.Message, "Eternity coffee", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    ShowPage(3);
                }
            };
            worker.RunWorkerAsync();
        }
    }

    internal static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase) || a.Equals("/SILENT", StringComparison.OrdinalIgnoreCase));
            string dir = null;
            foreach (string arg in args)
            {
                if (arg.StartsWith("/DIR=", StringComparison.OrdinalIgnoreCase))
                    dir = arg.Substring(5).Trim('"');
            }

            if (silent)
            {
                try
                {
                    if (string.IsNullOrEmpty(dir)) dir = InstallCore.DefaultDir();
                    dir = Path.GetFullPath(dir);
                    byte[] payload = Payload.Load();
                    Payload.ExtractTo(payload, dir, null);
                    InstallCore.WriteShortcuts(dir, false);
                    InstallCore.WriteRegistry(dir);
                    Environment.Exit(0);
                }
                catch (Exception ex)
                {
                    File.WriteAllText(Path.Combine(Path.GetTempPath(), "eternity-install-error.txt"), ex.ToString(), Encoding.UTF8);
                    Environment.Exit(1);
                }
            }

            Application.Run(new SetupForm());
        }
    }
}
