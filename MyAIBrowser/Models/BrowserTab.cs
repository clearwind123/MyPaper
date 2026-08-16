// 文件路径：MyAIBrowser/Models/BrowserTab.cs
// 功能：浏览器标签页数据模型。每个标签页持有一个独立的 WebView2 实例，
//       切换标签时隐藏/显示对应实例以保留页面状态。
//       实现 INotifyPropertyChanged 以便标签头部实时刷新标题。
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.Web.WebView2.Wpf;

namespace MyAIBrowser.Models
{
    public class BrowserTab : INotifyPropertyChanged
    {
        private string _title = "新标签页";
        private string _url = "";
        private bool _isLoading;

        /// <summary>标签标题（随站点名 / 页面标题更新）。</summary>
        public string Title
        {
            get => _title;
            set
            {
                if (_title == value) return;
                _title = value;
                OnPropertyChanged();
            }
        }

        /// <summary>当前地址。</summary>
        public string Url
        {
            get => _url;
            set
            {
                if (_url == value) return;
                _url = value;
                OnPropertyChanged();
            }
        }

        /// <summary>所属站点档案标识（空 = 默认档案；非空 = 该站点独立档案）。</summary>
        public string ProfileId { get; set; } = "";

        /// <summary>该标签页对应的 WebView2 控件（UI 线程创建）。</summary>
        public WebView2 WebView { get; set; } = null!;

        /// <summary>是否已初始化（EnsureCoreWebView2Async 完成）。</summary>
        public bool IsInitialized { get; set; }

        /// <summary>是否正在加载。</summary>
        public bool IsLoading
        {
            get => _isLoading;
            set
            {
                if (_isLoading == value) return;
                _isLoading = value;
                OnPropertyChanged();
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        private void OnPropertyChanged([CallerMemberName] string? name = null)
            => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
