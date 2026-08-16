// 文件路径：MyAIBrowser/MainWindow.xaml.cs
// 功能：主窗口逻辑：窗口控制、多标签页管理、导航、站点栏、WebView2 环境与代理、下载。
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using MyAIBrowser.Models;
using MyAIBrowser.Services;

namespace MyAIBrowser
{
    public partial class MainWindow : Window
    {
        // ---------- 数据 ----------
        public ObservableCollection<BrowserTab> Tabs { get; } = new();
        public ObservableCollection<Site> Sites { get; } = new();
        public BrowserTab? ActiveTab { get; set; }
        public Site? SelectedSite { get; set; }

        private readonly Dictionary<string, CoreWebView2Environment> _envs = new();
        private const string DefaultProfileKey = "__default__";
        private ProxySettings _proxy = ProxySettings.Load();
        private string _downloadFolder = AppPaths.DefaultDownloadFolder;
        private bool _suppressTabSelection;   // 程序化切换标签时抑制 SelectionChanged

        public MainWindow()
        {
            InitializeComponent();
            DataContext = this;

            foreach (var s in SiteStorage.LoadSites())
                Sites.Add(s);

            DownloadItems.CollectionChanged += (_, _) => UpdateDownloadBarVisibility();
        }

        // ================================================================
        // 窗口控制
        // ================================================================
        private void TitleBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ButtonState != MouseButtonState.Pressed) return;

            // 点击的是窗口控制按钮（最小化/最大化/关闭）时不触发拖拽
            if (e.OriginalSource is DependencyObject src &&
                FindVisualParent<System.Windows.Controls.Primitives.ButtonBase>(src) != null)
                return;

            DragMove();
        }

        private void Minimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void Maximize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        /// <summary>最大化/还原时同步切换按钮图标（E922 最大化 / E923 还原）。</summary>
        private void UpdateMaximizeIcon()
        {
            MaximizeBtn.Content = WindowState == WindowState.Maximized ? "\uE923" : "\uE922";
        }

        private void Close_Click(object sender, RoutedEventArgs e) => Close();

        // ---------- 无边框窗口阴影（DWM） ----------
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        /// <summary>
        /// 无边框窗口默认没有系统阴影；通过 DWM 开启非客户区渲染策略恢复阴影。
        /// 不能使用 AllowsTransparency（会导致 WebView2 渲染异常），因此用此方式。
        /// </summary>
        private void Window_SourceInitialized(object? sender, EventArgs e)
        {
            try
            {
                var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                int policy = 2; // DWMNCRP_ENABLED
                DwmSetWindowAttribute(hwnd, 2 /* DWMWA_NCRENDERING_POLICY */, ref policy, sizeof(int));
            }
            catch { /* 忽略：阴影失败不影响使用 */ }
        }

        /// <summary>无边框窗口最大化时避免盖住任务栏（WindowChrome 需手动限制最大高度）。</summary>
        private void Window_StateChanged(object? sender, EventArgs e)
        {
            MaxHeight = WindowState == WindowState.Maximized
                ? SystemParameters.MaximizedPrimaryScreenHeight
                : double.PositiveInfinity;
            UpdateMaximizeIcon();
        }

        /// <summary>全局快捷键：Ctrl+T 新建标签、Ctrl+W 关闭标签、Ctrl+L 定位地址栏、F5 刷新。</summary>
        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
            {
                switch (e.Key)
                {
                    case Key.T:
                        _ = CreateTabAsync(HomeUrl(), activate: true);
                        e.Handled = true;
                        break;
                    case Key.W:
                        if (ActiveTab != null) CloseTab(ActiveTab);
                        e.Handled = true;
                        break;
                    case Key.L:
                        AddressBar.Focus();
                        AddressBar.SelectAll();
                        e.Handled = true;
                        break;
                }
            }
            else if (e.Key == Key.F5)
            {
                Refresh_Click(this, new RoutedEventArgs());
                e.Handled = true;
            }
        }

        private async void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
        {
            // 释放所有 WebView2（环境对象由运行时管理，无需手动释放）
            foreach (var tab in Tabs.ToList())
                CloseTabInternal(tab);
            await Task.CompletedTask;
        }

        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            Log($"窗口加载，开始创建标签页，代理参数={_proxy.BuildBrowserArguments()}");
            try
            {
                await CreateTabAsync(HomeUrl(), activate: true);
                Log("首个标签页创建完成");
            }
            catch (Exception ex)
            {
                Log($"WebView2 初始化失败: {ex}");
                MessageBox.Show($"WebView2 初始化失败：{ex.Message}\n\n详情见 %LOCALAPPDATA%\\MyAIBrowser\\error.log",
                    "MyAI Browser", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        // ================================================================
        // WebView2 环境（代理参数在此生效；每个站点档案一个独立环境）
        // ================================================================
        /// <summary>
        /// 获取（或创建）某个档案的 WebView2 环境。
        /// profileId 为空 → 默认档案（共享登录态）；非空 → 该站点独立档案（独立 Cookie/登录态）。
        /// </summary>
        private async Task<CoreWebView2Environment> GetEnvironmentAsync(string? profileId)
        {
            var key = string.IsNullOrWhiteSpace(profileId) ? DefaultProfileKey : profileId!;
            if (_envs.TryGetValue(key, out var existing)) return existing;

            var folder = key == DefaultProfileKey
                ? AppPaths.WebView2UserDataFolder
                : Path.Combine(AppPaths.ProfilesFolder, SanitizeProfileId(key));

            var options = new CoreWebView2EnvironmentOptions();
            var args = _proxy.BuildBrowserArguments();

            // 禁用 GPU 加速：虚拟机/远程桌面环境下 GPU 初始化常导致
            // msedgewebview2.exe 断点崩溃（0x80000003），软件渲染更稳定。
            var extraArgs = new List<string> { "--disable-gpu" };
            if (!string.IsNullOrWhiteSpace(args))
                extraArgs.Add(args);
            options.AdditionalBrowserArguments = string.Join(" ", extraArgs);

            // 重载：CreateAsync(browserExecutableFolder, userDataFolder, options)
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, folder, options);
                _envs[key] = env;
                Log($"WebView2 环境创建成功 profile={key} 目录={folder}");
            }
            catch (Exception ex)
            {
                LogError($"WebView2 环境创建失败 profile={key}\n参数: {options.AdditionalBrowserArguments}\n{ex}");
                throw;
            }
            return _envs[key];
        }

        /// <summary>把档案标识清洗为合法目录名。</summary>
        private static string SanitizeProfileId(string id)
        {
            var invalid = System.IO.Path.GetInvalidFileNameChars();
            return new string(id.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        }

        /// <summary>把错误写入应用数据目录的 error.log，便于远程排查。</summary>
        internal static void LogError(string message) => Log(message);

        /// <summary>写入应用数据目录 error.log（生命周期与错误日志）。</summary>
        internal static void Log(string message)
        {
            try
            {
                var path = System.IO.Path.Combine(AppPaths.DataFolder, "error.log");
                System.IO.Directory.CreateDirectory(AppPaths.DataFolder);
                System.IO.File.AppendAllText(path,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}\r\n");
            }
            catch { /* 日志失败不影响主流程 */ }
        }

        // ================================================================
        // 标签页管理
        // ================================================================
        /// <summary>内置起始页标记（不指向任何真实网址）。</summary>
        private const string StartPageUrl = "myai://start";

        private string HomeUrl() => StartPageUrl;

        private async Task<BrowserTab> CreateTabAsync(string url, bool activate, string? profileId = null)
        {
            var tab = new BrowserTab { Url = url, ProfileId = profileId ?? "" };
            var wv = new WebView2
            {
                Visibility = Visibility.Collapsed,
                DefaultBackgroundColor = System.Drawing.Color.White
            };

            WebHostGrid.Children.Add(wv);
            tab.WebView = wv;
            Tabs.Add(tab);

            try
            {
                var env = await GetEnvironmentAsync(tab.ProfileId);
                Log($"环境就绪（profile={tab.ProfileId}），初始化 WebView2…");
                await wv.EnsureCoreWebView2Async(env);
                tab.IsInitialized = true;
                WireWebViewEvents(wv, tab);
                Log($"WebView2 初始化完成，导航到 {url}");
            }
            catch (Exception ex)
            {
                tab.Title = "加载失败";
                LogError($"标签页初始化失败: {url}\n{ex}");
                MessageBox.Show($"标签页初始化失败：{ex.Message}\n\n详情见 %LOCALAPPDATA%\\MyAIBrowser\\error.log",
                    "MyAI Browser", MessageBoxButton.OK, MessageBoxImage.Warning);
            }

            if (activate)
                ActivateTab(tab);

            if (tab.IsInitialized)
                NavigateTab(tab, url);

            return tab;
        }

        private void ActivateTab(BrowserTab tab)
        {
            if (!Tabs.Contains(tab)) return;

            _suppressTabSelection = true;
            ActiveTab = tab;
            TabListBox.SelectedItem = tab;
            _suppressTabSelection = false;

            foreach (var t in Tabs)
            {
                t.WebView.Visibility = ReferenceEquals(t, tab) ? Visibility.Visible : Visibility.Collapsed;
            }

            UpdateChromeForActiveTab();
        }

        private void UpdateChromeForActiveTab()
        {
            var cwv = ActiveTab?.WebView.CoreWebView2;
            BackBtn.IsEnabled = cwv?.CanGoBack == true;
            ForwardBtn.IsEnabled = cwv?.CanGoForward == true;
            RefreshBtn.IsEnabled = cwv != null;

            AddressBar.Text = ActiveTab?.WebView.Source?.ToString() ?? "";
            Title = $"MyAI Browser - {ActiveTab?.Title ?? "新标签页"}";
        }

        private void TabListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppressTabSelection) return;
            if (TabListBox.SelectedItem is BrowserTab tab && !ReferenceEquals(tab, ActiveTab))
                ActivateTab(tab);
        }

        private void TabClose_Click(object sender, RoutedEventArgs e)
        {
            if ((sender as FrameworkElement)?.Tag is BrowserTab tab)
                CloseTab(tab);
        }

        private void CloseTab(BrowserTab tab)
        {
            var index = Tabs.IndexOf(tab);
            CloseTabInternal(tab);

            // 激活相邻标签
            if (ReferenceEquals(tab, ActiveTab))
            {
                var next = Tabs.Count > 0 ? Tabs[Math.Min(index, Tabs.Count - 1)] : null;
                if (next != null)
                    ActivateTab(next);
                else
                    ActiveTab = null;
            }
        }

        private void CloseTabInternal(BrowserTab tab)
        {
            Tabs.Remove(tab);
            WebHostGrid.Children.Remove(tab.WebView);
            try { tab.WebView.Dispose(); } catch { /* 忽略 */ }
        }

        private async void NewTab_Click(object sender, RoutedEventArgs e)
        {
            await CreateTabAsync(HomeUrl(), activate: true);
        }

        // ================================================================
        // WebView2 事件接线
        // ================================================================
        private void WireWebViewEvents(WebView2 wv, BrowserTab tab)
        {
            var cwv = wv.CoreWebView2;
            if (cwv == null) return;

            // 页面缩放：启用 Ctrl+滚轮缩放与触控板捏合，默认缩小到 80%
            cwv.Settings.IsZoomControlEnabled = true;
            cwv.Settings.IsPinchZoomEnabled = true;
            wv.ZoomFactor = 0.8;

            cwv.SourceChanged += (_, _) =>
            {
                tab.Url = wv.Source?.ToString() ?? "";

                // 命中左侧站点列表时，标签直接显示站点名（如 DeepSeek / 豆包）
                var siteName = GetSiteNameForUrl(tab.Url);
                if (siteName != null)
                {
                    tab.Title = siteName;
                    if (ReferenceEquals(tab, ActiveTab))
                        Title = $"MyAI Browser - {tab.Title}";
                }

                if (ReferenceEquals(tab, ActiveTab))
                    AddressBar.Text = tab.Url;
            };

            cwv.DocumentTitleChanged += (_, _) =>
            {
                string title;
                if (tab.Url == StartPageUrl)
                {
                    title = "起始页";   // 起始页是 NavigateToString 内容，DocumentTitle 是 data: URI，直接覆盖
                }
                else
                {
                    // 优先使用左侧站点列表的名字，其次用页面标题
                    var siteName = GetSiteNameForUrl(tab.Url);
                    title = siteName
                            ?? (string.IsNullOrWhiteSpace(cwv.DocumentTitle)
                                ? (Uri.TryCreate(tab.Url, UriKind.Absolute, out var u) ? u.Host : "新标签页")
                                : cwv.DocumentTitle);
                }
                tab.Title = title;
                if (ReferenceEquals(tab, ActiveTab))
                    Title = $"MyAI Browser - {tab.Title}";
            };

            cwv.NavigationStarting += (_, e) =>
            {
                tab.IsLoading = true;
            };

            cwv.NavigationCompleted += (_, e) =>
            {
                tab.IsLoading = false;
                if (ReferenceEquals(tab, ActiveTab))
                    UpdateChromeForActiveTab();
            };

            // 页面内点击 target=_blank / window.open → 新标签页打开（沿用本标签的档案）
            cwv.NewWindowRequested += async (_, e) =>
            {
                e.Handled = true;
                await CreateTabAsync(e.Uri, activate: true, tab.ProfileId);
            };

            // 下载处理
            cwv.DownloadStarting += (_, e) => OnDownloadStarting(e);
        }

        // ================================================================
        // 导航
        // ================================================================
        private void NavigateTab(BrowserTab tab, string url)
        {
            if (!tab.IsInitialized || tab.WebView.CoreWebView2 == null) return;

            // 内置起始页：用本地静态 HTML
            if (url == StartPageUrl)
            {
                tab.Url = StartPageUrl;
                tab.WebView.CoreWebView2.NavigateToString(BuildStartPageHtml());
                return;
            }

            var normalized = NormalizeUrl(url);
            tab.Url = normalized;
            tab.WebView.CoreWebView2.Navigate(normalized);
        }

        /// <summary>根据 URL 匹配站点；未命中返回 null。</summary>
        private Site? GetSiteForUrl(string url)
        {
            if (string.IsNullOrWhiteSpace(url) || url == StartPageUrl) return null;
            foreach (var s in Sites)
            {
                if (string.IsNullOrEmpty(s.Url)) continue;
                if (url.StartsWith(s.Url, StringComparison.OrdinalIgnoreCase) ||
                    s.Url.StartsWith(url, StringComparison.OrdinalIgnoreCase))
                    return s;
            }
            return null;
        }

        /// <summary>根据 URL 在左侧站点列表中匹配站点名；未命中返回 null。</summary>
        private string? GetSiteNameForUrl(string url) => GetSiteForUrl(url)?.Name;

        /// <summary>生成内置起始页（静态 HTML：居中 Logo + 标题，无站点卡片）。</summary>
        private string BuildStartPageHtml()
        {
            var sb = new StringBuilder();
            sb.AppendLine("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><style>");
            sb.AppendLine("body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F5F6F8;font-family:'Segoe UI','Microsoft YaHei',sans-serif;color:#2C2C2C}");
            sb.AppendLine(".logo{width:64px;height:64px;border-radius:18px;background:#3F8F63;color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700;margin-bottom:18px;box-shadow:0 4px 14px rgba(63,143,99,.25)}");
            sb.AppendLine("h1{font-size:24px;margin:0 0 8px}");
            sb.AppendLine(".sub{color:#8A8A8A;font-size:14px}");
            sb.AppendLine("</style></head><body>");
            sb.AppendLine("<div class=\"logo\">AI</div>");
            sb.AppendLine("<h1>MyAI Browser</h1>");
            sb.AppendLine("<div class=\"sub\">在左侧选择站点，或在上方地址栏输入网址</div>");
            sb.AppendLine("</body></html>");
            return sb.ToString();
        }

        private static string NormalizeUrl(string input)
        {
            input = input.Trim();
            if (string.IsNullOrWhiteSpace(input)) return "about:blank";
            if (input.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                input.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                input.StartsWith("about:", StringComparison.OrdinalIgnoreCase) ||
                input.StartsWith("file:", StringComparison.OrdinalIgnoreCase) ||
                input.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                return input;
            return "https://" + input;
        }

        private void Back_Click(object sender, RoutedEventArgs e) => ActiveTab?.WebView.CoreWebView2?.GoBack();
        private void Forward_Click(object sender, RoutedEventArgs e) => ActiveTab?.WebView.CoreWebView2?.GoForward();
        private void Refresh_Click(object sender, RoutedEventArgs e) => ActiveTab?.WebView.CoreWebView2?.Reload();

        private void Home_Click(object sender, RoutedEventArgs e)
        {
            if (ActiveTab != null)
                NavigateTab(ActiveTab, HomeUrl());
        }

        private void AddressBar_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
                NavigateActiveTabToAddressBar();
        }

        private void AddressBar_Go(object sender, RoutedEventArgs e) => NavigateActiveTabToAddressBar();

        private void NavigateActiveTabToAddressBar()
        {
            if (ActiveTab != null)
                NavigateTab(ActiveTab, AddressBar.Text);
        }

        // ================================================================
        // 站点栏
        // ================================================================
        /// <summary>点击站点 → 在新标签页打开（若已存在同地址标签则激活它）。</summary>
        private void SiteListBox_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            var pos = e.GetPosition(SiteListBox);
            var hit = SiteListBox.InputHitTest(pos) as DependencyObject;
            var container = FindVisualParent<ListBoxItem>(hit);
            if (container?.DataContext is Site site)
            {
                _ = OpenSiteOrActivateAsync(site.Url);
                e.Handled = true;
            }
        }

        private async Task OpenSiteOrActivateAsync(string url)
        {
            var existing = Tabs.FirstOrDefault(t =>
                string.Equals(t.Url, url, StringComparison.OrdinalIgnoreCase));
            if (existing != null)
            {
                ActivateTab(existing);
                return;
            }

            // 站点级隔离：按站点档案打开，独立登录态
            var site = GetSiteForUrl(url);
            await CreateTabAsync(url, activate: true, site?.ProfileId);
        }

        private void SiteMenu_Open(object sender, RoutedEventArgs e)
        {
            if (GetContextSite(sender) is Site site && ActiveTab != null)
                NavigateTab(ActiveTab, site.Url);
        }

        private async void SiteMenu_OpenNewTab(object sender, RoutedEventArgs e)
        {
            if (GetContextSite(sender) is Site site)
                await CreateTabAsync(site.Url, activate: true, site.ProfileId);
        }

        private void SiteMenu_Edit(object sender, RoutedEventArgs e)
        {
            if (GetContextSite(sender) is Site site)
                EditSiteDialog(site);
        }

        private void SiteMenu_Delete(object sender, RoutedEventArgs e)
        {
            if (GetContextSite(sender) is not Site site) return;
            if (MessageBox.Show($"确定删除站点「{site.Name}」吗？", "删除站点",
                    MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
                return;
            Sites.Remove(site);
            SiteStorage.SaveSites(Sites.ToList());
        }

        private static Site? GetContextSite(object sender)
        {
            var menu = sender as MenuItem;
            var ctx = menu?.Parent as ContextMenu;
            return ctx?.DataContext as Site;
        }

        private void SiteListBox_ContextMenuOpening(object sender, ContextMenuEventArgs e)
        {
            // 把鼠标所在项设为菜单 DataContext，菜单项才能拿到"右键的是哪个站点"
            var pos = Mouse.GetPosition(SiteListBox);
            var hit = SiteListBox.InputHitTest(pos) as DependencyObject;
            var container = FindVisualParent<ListBoxItem>(hit);
            if (container?.DataContext is Site site)
            {
                SiteListBox.ContextMenu.DataContext = site;
            }
            else
            {
                e.Handled = true; // 空白处不弹菜单
            }
        }

        private static T? FindVisualParent<T>(DependencyObject? child) where T : DependencyObject
        {
            while (child != null && child is not T)
                child = System.Windows.Media.VisualTreeHelper.GetParent(child);
            return child as T;
        }

        private void AddSite_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new Dialogs.AddSiteDialog { Owner = this };
            if (dlg.ShowDialog() == true && dlg.Result != null)
            {
                Sites.Add(dlg.Result);
                SiteStorage.SaveSites(Sites.ToList());
                SelectedSite = dlg.Result;
            }
        }

        private void EditSiteDialog(Site site)
        {
            var dlg = new Dialogs.AddSiteDialog(site) { Owner = this };
            if (dlg.ShowDialog() == true && dlg.Result != null)
            {
                site.Name = dlg.Result.Name;
                site.Url = dlg.Result.Url;
                SiteStorage.SaveSites(Sites.ToList());
            }
        }

        // ================================================================
        // 设置（代理 / 下载目录 / 清除浏览数据）
        // ================================================================
        private async void Settings_Click(object sender, RoutedEventArgs e)
        {
            var dlg = new Dialogs.SettingsDialog(_proxy, _downloadFolder) { Owner = this };
            if (dlg.ShowDialog() != true) return;

            var proxyChanged = dlg.Proxy.Mode != _proxy.Mode
                               || dlg.Proxy.ManualProxy != _proxy.ManualProxy;
            var folderChanged = dlg.DownloadFolder != _downloadFolder;

            _proxy = dlg.Proxy;
            _proxy.Save();
            _downloadFolder = dlg.DownloadFolder;

            if (dlg.ClearBrowsingDataRequested)
                await ClearBrowsingDataAsync();

            if (!proxyChanged) return;

            // 代理参数在 WebView2 环境创建时生效，进程内重建环境容易与旧浏览器进程冲突，
            // 因此提示用户重启应用（自动重启并保留站点数据）。
            var r = MessageBox.Show(
                "代理设置已保存。更改代理需要重启应用才能生效，是否立即重启？",
                "设置", MessageBoxButton.YesNo, MessageBoxImage.Question);
            if (r == MessageBoxResult.Yes)
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = System.Diagnostics.Process.GetCurrentProcess().MainModule!.FileName,
                    UseShellExecute = true
                });
                Close();
            }
        }

        /// <summary>清除所有站点档案（含默认档案）的 Cookie、缓存与本地数据，并刷新标签页。</summary>
        private async Task ClearBrowsingDataAsync()
        {
            var kinds = CoreWebView2BrowsingDataKinds.Cookies
                | CoreWebView2BrowsingDataKinds.AllDomStorage
                | CoreWebView2BrowsingDataKinds.DiskCache
                | CoreWebView2BrowsingDataKinds.CacheStorage
                | CoreWebView2BrowsingDataKinds.BrowsingHistory
                | CoreWebView2BrowsingDataKinds.DownloadHistory
                | CoreWebView2BrowsingDataKinds.GeneralAutofill
                | CoreWebView2BrowsingDataKinds.PasswordAutosave;

            Log("开始清除浏览数据…");

            // 1) 有活动标签的档案
            var liveProfiles = Tabs.Select(t => t.WebView.CoreWebView2?.Profile)
                                   .Where(p => p != null).Distinct().ToList();
            foreach (var p in liveProfiles)
            {
                try { await p!.ClearBrowsingDataAsync(kinds); }
                catch (Exception ex) { Log($"清除浏览数据失败: {ex.Message}"); }
            }

            // 2) 已创建但当前没有标签的站点档案（临时开一个隐藏 WebView2 来清）
            foreach (var kv in _envs.ToList())
            {
                var key = kv.Key;
                var hasLiveTab = Tabs.Any(t =>
                    (key == DefaultProfileKey ? string.IsNullOrEmpty(t.ProfileId) : t.ProfileId == key));
                if (hasLiveTab) continue;

                var wv = new WebView2 { Visibility = Visibility.Collapsed };
                WebHostGrid.Children.Add(wv);
                try
                {
                    await wv.EnsureCoreWebView2Async(kv.Value);
                    await wv.CoreWebView2.Profile.ClearBrowsingDataAsync(kinds);
                    Log($"已清除档案 {key} 的浏览数据");
                }
                catch (Exception ex) { Log($"清除档案 {key} 失败: {ex.Message}"); }
                WebHostGrid.Children.Remove(wv);
                try { wv.Dispose(); } catch { /* 忽略 */ }
            }

            // 3) 刷新所有标签页（回到首页则重新加载起始页）
            foreach (var tab in Tabs.ToList())
                NavigateTab(tab, tab.Url == StartPageUrl ? StartPageUrl : tab.Url);

            Log("清除浏览数据完成");
            MessageBox.Show("浏览数据已清除，各站点已重新加载。", "清除浏览数据",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }
}
