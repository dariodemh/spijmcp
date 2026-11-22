using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace SpijMcpLauncher
{
    static class Program
    {
        private const string MutexName = "Local\\SPIJ-MCP-SingleInstance";

        [STAThread]
        static void Main(string[] args)
        {
            bool minimized = false;
            foreach (string a in args)
            {
                if (string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase))
                {
                    minimized = true;
                }
            }

            bool createdNew;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    if (!minimized)
                    {
                        string urlUi = ReadJsonField(GetUiStatePath(), "urlUi");
                        if (!string.IsNullOrEmpty(urlUi))
                        {
                            OpenAppWindow(urlUi);
                        }
                    }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(minimized));
            }
        }

        internal static string GetUiStatePath()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, ".spij-mcp", "ui-state.json");
        }

        internal static string ReadJsonField(string path, string field)
        {
            try
            {
                if (!File.Exists(path)) return "";
                string text = File.ReadAllText(path);
                Match m = Regex.Match(text, "\"" + Regex.Escape(field) + "\"\\s*:\\s*\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value.Replace("\\/", "/") : "";
            }
            catch
            {
                return "";
            }
        }

        internal static void OpenAppWindow(string url)
        {
            try
            {
                string[] candidates = new string[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
                };

                foreach (string browser in candidates)
                {
                    if (!string.IsNullOrEmpty(browser) && File.Exists(browser))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = browser,
                            Arguments = "--app=" + url + " --window-size=560,780",
                            UseShellExecute = false
                        });
                        return;
                    }
                }

                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            }
            catch
            {
                // Ignorar si no se pudo abrir el navegador.
            }
        }
    }

    sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon _trayIcon;
        private Process _nodeProcess;
        private bool _exiting;

        public TrayContext(bool minimized)
        {
            ContextMenuStrip menu = new ContextMenuStrip();

            ToolStripMenuItem openItem = new ToolStripMenuItem("Abrir panel de SPIJ MCP");
            openItem.Font = new Font(openItem.Font, FontStyle.Bold);
            openItem.Click += (s, e) => OpenPanel();

            ToolStripMenuItem copyItem = new ToolStripMenuItem("Copiar URL permanente");
            copyItem.Click += (s, e) => CopyUrl();

            ToolStripMenuItem downloadsItem = new ToolStripMenuItem("Abrir Descargas\\SPIJ");
            downloadsItem.Click += (s, e) => OpenDownloads();

            ToolStripMenuItem exitItem = new ToolStripMenuItem("Salir");
            exitItem.Click += (s, e) => ShutdownAndExit();

            menu.Items.Add(openItem);
            menu.Items.Add(copyItem);
            menu.Items.Add(downloadsItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            Icon icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            _trayIcon = new NotifyIcon
            {
                Icon = icon,
                Text = "SPIJ MCP — Activo en tu PC",
                ContextMenuStrip = menu,
                Visible = true
            };
            _trayIcon.DoubleClick += (s, e) => OpenPanel();

            StartNodeServer(minimized);
        }

        private void StartNodeServer(bool minimized)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
            string serverJs = Path.Combine(baseDir, "app", "src", "server.js");

            if (!File.Exists(nodeExe) || !File.Exists(serverJs))
            {
                MessageBox.Show(
                    "No se encontraron los archivos de SPIJ MCP. Vuelve a ejecutar el instalador.",
                    "SPIJ MCP",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                ExitThread();
                return;
            }

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + serverJs + "\" --ui" + (minimized ? " --minimized" : ""),
                WorkingDirectory = Path.Combine(baseDir, "app"),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            psi.EnvironmentVariables["SPIJ_MCP_EXE"] = Application.ExecutablePath;

            _nodeProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _nodeProcess.Exited += (s, e) =>
            {
                if (!_exiting)
                {
                    _exiting = true;
                    _trayIcon.Visible = false;
                    ExitThread();
                }
            };
            _nodeProcess.Start();
        }

        private void OpenPanel()
        {
            string urlUi = Program.ReadJsonField(Program.GetUiStatePath(), "urlUi");
            if (!string.IsNullOrEmpty(urlUi))
            {
                Program.OpenAppWindow(urlUi);
            }
        }

        private void CopyUrl()
        {
            string urlMcp = Program.ReadJsonField(Program.GetUiStatePath(), "urlMcp");
            if (!string.IsNullOrEmpty(urlMcp))
            {
                try
                {
                    Clipboard.SetText(urlMcp);
                    _trayIcon.ShowBalloonTip(
                        2000,
                        "SPIJ MCP",
                        "URL permanente copiada al portapapeles.",
                        ToolTipIcon.Info
                    );
                }
                catch { }
            }
        }

        private void OpenDownloads()
        {
            try
            {
                string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string dir = Path.Combine(home, "Downloads", "SPIJ");
                Directory.CreateDirectory(dir);
                Process.Start(new ProcessStartInfo { FileName = "explorer.exe", Arguments = "\"" + dir + "\"", UseShellExecute = true });
            }
            catch { }
        }

        private void ShutdownAndExit()
        {
            if (_exiting) return;
            _exiting = true;
            _trayIcon.Visible = false;

            try
            {
                if (_nodeProcess != null && !_nodeProcess.HasExited)
                {
                    _nodeProcess.Kill();
                }
            }
            catch { }

            try
            {
                string statePath = Program.GetUiStatePath();
                if (File.Exists(statePath)) File.Delete(statePath);
            }
            catch { }

            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
