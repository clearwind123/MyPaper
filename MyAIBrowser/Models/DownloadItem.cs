// 文件路径：MyAIBrowser/Models/DownloadItem.cs
// 功能：下载项模型，用于在底部状态栏显示下载进度。
using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.Web.WebView2.Core;

namespace MyAIBrowser.Models
{
    public class DownloadItem : INotifyPropertyChanged
    {
        private double _percent;

        /// <summary>下载任务（WebView2 下载句柄）。</summary>
        public CoreWebView2DownloadOperation Operation { get; set; } = null!;

        /// <summary>下载的文件名。</summary>
        public string FileName { get; set; } = "";

        /// <summary>进度百分比 0~100。</summary>
        public double Percent
        {
            get => _percent;
            private set
            {
                if (Math.Abs(_percent - value) < 0.1) return;
                _percent = value;
                OnPropertyChanged();
                OnPropertyChanged(nameof(PercentText));
            }
        }

        public string PercentText => $"{Percent:0}%";

        public void SetPercent(double p) => Percent = Math.Clamp(p, 0, 100);

        public event PropertyChangedEventHandler? PropertyChanged;

        private void OnPropertyChanged([CallerMemberName] string? name = null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
