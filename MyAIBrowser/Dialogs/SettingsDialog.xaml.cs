// 文件路径：MyAIBrowser/Dialogs/SettingsDialog.xaml.cs
// 功能：设置对话框逻辑：代理模式 + 手动代理地址 + 下载目录。
using System.Windows;
using Microsoft.Win32;
using MyAIBrowser.Services;

namespace MyAIBrowser.Dialogs
{
    public partial class SettingsDialog : Window
    {
        /// <summary>保存后的代理设置。</summary>
        public ProxySettings Proxy { get; private set; }

        /// <summary>保存后的下载目录。</summary>
        public string DownloadFolder { get; private set; }

        /// <summary>用户点击了"清除浏览数据"（确定后由主窗口执行）。</summary>
        public bool ClearBrowsingDataRequested { get; private set; }

        public SettingsDialog(ProxySettings current, string currentDownloadFolder)
        {
            InitializeComponent();

            Proxy = new ProxySettings
            {
                Mode = current.Mode,
                ManualProxy = current.ManualProxy
            };
            DownloadFolder = currentDownloadFolder;

            DownloadFolderBox.Text = DownloadFolder;
            ProxyBox.Text = Proxy.ManualProxy;

            switch (Proxy.Mode)
            {
                case ProxyMode.System: ProxySystemRb.IsChecked = true; break;
                case ProxyMode.Manual: ProxyManualRb.IsChecked = true; break;
                default: ProxyNoneRb.IsChecked = true; break;
            }
        }

        private void Header_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed)
                DragMove();
        }

        private void BrowseFolder_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new OpenFolderDialog
            {
                Title = "选择下载目录",
                InitialDirectory = DownloadFolderBox.Text
            };
            if (dlg.ShowDialog(this) == true)
                DownloadFolderBox.Text = dlg.FolderName;
        }

        private void ClearData_Click(object sender, RoutedEventArgs e)
        {
            var r = MessageBox.Show(
                "将清除所有站点的 Cookie、缓存和本地数据，各站登录状态会被清除（需重新登录）。确定继续吗？",
                "清除浏览数据", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (r == MessageBoxResult.Yes)
            {
                ClearBrowsingDataRequested = true;
                DialogResult = true;   // 关闭设置，由主窗口执行清理
            }
        }

        private void Ok_Click(object sender, RoutedEventArgs e)
        {
            Proxy.Mode = ProxySystemRb.IsChecked == true
                ? ProxyMode.System
                : ProxyManualRb.IsChecked == true ? ProxyMode.Manual : ProxyMode.None;
            Proxy.ManualProxy = ProxyBox.Text.Trim();

            var folder = DownloadFolderBox.Text.Trim();
            if (string.IsNullOrWhiteSpace(folder))
            {
                MessageBox.Show("请填写下载目录。", "设置", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            DownloadFolder = folder;
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
    }
}
