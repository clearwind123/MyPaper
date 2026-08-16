// 文件路径：MyAIBrowser/Services/DpapiJson.cs
// 功能：用 Windows DPAPI（当前用户级）加密存储 JSON 文件。
//       - 写入：加密后落盘，其他用户/程序无法直接读取明文
//       - 读取：自动识别旧版明文文件（升级兼容），下次保存时自动转为加密
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace MyAIBrowser.Services
{
    public static class DpapiJson
    {
        /// <summary>读取 JSON 文件内容（自动解密）。文件不存在返回 false、json=null。
        /// 返回值表示"是否为加密格式"；false 表示旧明文文件（调用方应重新保存以迁移为加密）。</summary>
        public static bool TryLoad(string path, out string? json)
        {
            if (!File.Exists(path))
            {
                json = null;
                return false;
            }

            var bytes = File.ReadAllBytes(path);
            try
            {
                json = Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
                return true;   // 已加密
            }
            catch (CryptographicException)
            {
                // 旧版明文文件或损坏：尝试按明文读取（调用方负责迁移为加密）
                try { json = File.ReadAllText(path); return false; }
                catch { json = null; return false; }
            }
        }

        /// <summary>读取 JSON 文件内容（自动解密；兼容旧明文格式）。文件不存在返回 null。</summary>
        public static string? Load(string path)
            => TryLoad(path, out var json) ? json : json;

        /// <summary>把 JSON 内容加密写入文件。</summary>
        public static void Save(string path, string json)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
            var bytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(path, bytes);
        }
    }
}
