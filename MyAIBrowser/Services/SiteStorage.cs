// 文件路径：MyAIBrowser/Services/SiteStorage.cs
// 功能：管理网站列表的加载和保存（DPAPI 加密的 JSON 文件存储）
using System.Collections.Generic;
using System.IO;
using System;
using System.Text.Json;
using MyAIBrowser.Models;

namespace MyAIBrowser.Services
{
    public static class SiteStorage
    {
        private static readonly string DataFolder = AppPaths.DataFolder;
        private static readonly string DataFile = AppPaths.SitesFile;

        public static List<Site> LoadSites()
        {
            if (!File.Exists(DataFile))
            {
                // 首次运行时返回默认站点列表
                var defaultSites = new List<Site>
                {
                    new Site { Name = "ChatGPT", Url = "https://chatgpt.com", ProfileId = "chatgpt" },
                    new Site { Name = "DeepSeek", Url = "https://chat.deepseek.com", ProfileId = "deepseek" },
                    new Site { Name = "豆包", Url = "https://www.doubao.com", ProfileId = "doubao" },
                    new Site { Name = "Gemini", Url = "https://gemini.google.com", ProfileId = "gemini" }
                };
                SaveSites(defaultSites);
                return defaultSites;
            }

            string? json;
            var isEncrypted = DpapiJson.TryLoad(DataFile, out json);
            if (string.IsNullOrEmpty(json)) return new List<Site>();
            var sites = JsonSerializer.Deserialize<List<Site>>(json) ?? new List<Site>();
            if (!isEncrypted)
                SaveSites(sites);   // 旧明文文件：立即迁移为 DPAPI 加密
            return sites;
        }

        public static void SaveSites(List<Site> sites)
        {
            string json = JsonSerializer.Serialize(sites, new JsonSerializerOptions { WriteIndented = true });
            DpapiJson.Save(DataFile, json);
        }
    }
}