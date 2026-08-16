// 文件路径：MyAIBrowser/MainWindow.Downloads.cs
// 功能：下载处理：接管 WebView2 下载、写入下载目录、底部状态栏展示进度与取消。
using System;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using MyAIBrowser.Models;

namespace MyAIBrowser
{
    public partial class MainWindow
    {
        /// <summary>当前下载任务列表（绑定到底部状态栏）。</summary>
        public System.Collections.ObjectModel.ObservableCollection<DownloadItem> DownloadItems { get; } = new();

        private void OnDownloadStarting(CoreWebView2DownloadStartingEventArgs e)
        {
            var operation = e.DownloadOperation;

            // 接管下载，指定保存路径（默认下载目录）
            // 注：本版本 API 无 SuggestedFileName，默认 ResultFilePath 已含建议文件名，先取出来
            e.Handled = true;
            try
            {
                var suggestedName = Path.GetFileName(e.ResultFilePath);
                if (string.IsNullOrWhiteSpace(suggestedName))
                    suggestedName = "download";
                Directory.CreateDirectory(_downloadFolder);
                e.ResultFilePath = Path.Combine(_downloadFolder, SanitizeFileName(suggestedName));
            }
            catch
            {
                // 目录不可写时交给 WebView2 默认行为
                e.Handled = false;
                return;
            }

            var item = new DownloadItem
            {
                Operation = operation,
                FileName = Path.GetFileName(e.ResultFilePath)
            };
            DownloadItems.Add(item);

            operation.BytesReceivedChanged += (_, _) =>
            {
                var total = operation.TotalBytesToReceive ?? 0;
                item.SetPercent(total > 0 ? operation.BytesReceived * 100.0 / total : 0);
            };

            operation.StateChanged += (_, _) =>
            {
                if (operation.State is CoreWebView2DownloadState.Completed or CoreWebView2DownloadState.Interrupted)
                {
                    // 结束后从状态栏移除（延迟以便用户看到 100%）
                    Dispatcher.BeginInvoke(new Action(() =>
                    {
                        DownloadItems.Remove(item);
                    }), DispatcherPriority.Background);
                }
            };
        }

        private void DownloadCancel_Click(object sender, RoutedEventArgs e)
        {
            if ((sender as FrameworkElement)?.Tag is DownloadItem item)
            {
                try { item.Operation.Cancel(); } catch { /* 忽略 */ }
                DownloadItems.Remove(item);
            }
        }

        private void UpdateDownloadBarVisibility()
        {
            DownloadBar.Visibility = DownloadItems.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>清洗文件名中的非法字符，防止路径注入。</summary>
        private static string SanitizeFileName(string name)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var cleaned = new string(name.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
            return string.IsNullOrWhiteSpace(cleaned) ? "download" : cleaned;
        }
    }
}
