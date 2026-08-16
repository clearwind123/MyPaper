// 文件路径：MyAIBrowser/Services/AppPaths.cs
// 功能：集中管理应用数据目录。浏览器所有标签页共享同一个 WebView2 用户数据目录，
//       保证各标签页登录态一致，且与系统默认浏览器隔离。
using System;
using System.IO;

namespace MyAIBrowser.Services
{
    public static class AppPaths
    {
        private static readonly string Root =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MyAIBrowser");

        /// <summary>站点列表 JSON 文件所在目录。</summary>
        public static string DataFolder => Root;

        /// <summary>站点列表 JSON 文件路径。</summary>
        public static string SitesFile => Path.Combine(Root, "sites.json");

        /// <summary>WebView2 用户数据目录（默认档案：标签页共用，登录态共享）。</summary>
        public static string WebView2UserDataFolder => Path.Combine(Root, "WebView2");

        /// <summary>各站点独立档案目录（站点级登录隔离）。</summary>
        public static string ProfilesFolder => Path.Combine(Root, "Profiles");

        /// <summary>默认下载目录：用户"下载"文件夹。</summary>
        public static string DefaultDownloadFolder =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
    }
}
