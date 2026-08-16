// 文件路径：MyAIBrowser/Services/ProxySettings.cs
// 功能：网络代理设置。WebView2 默认跟随系统代理，但存在"系统代理不生效"的已知问题
//       （https://github.com/MicrosoftEdge/WebView2Feedback/issues/912），
//       因此本类支持三种模式，并把生效的代理以 --proxy-server 参数传给 WebView2。
//  - System：读取 Windows 系统代理（注册表），显式传给 WebView2
//  - Manual：用户手动填写代理地址
//  - None  ：禁用代理（--no-proxy-server）
using System;
using System.IO;
using System.Text.Json;
using Microsoft.Win32;

namespace MyAIBrowser.Services
{
    public enum ProxyMode
    {
        System = 0,   // 跟随系统代理（显式传参，解决不生效问题）
        Manual = 1,   // 手动代理
        None = 2      // 禁用代理
    }

    public class ProxySettings
    {
        public ProxyMode Mode { get; set; } = ProxyMode.System;

        /// <summary>手动代理地址，格式 host:port，如 127.0.0.1:7890。</summary>
        public string ManualProxy { get; set; } = "127.0.0.1:7890";

        private static readonly string FilePath =
            Path.Combine(AppPaths.DataFolder, "settings.json");

        public static ProxySettings Load()
        {
            try
            {
                var json = DpapiJson.Load(FilePath);
                if (!string.IsNullOrEmpty(json))
                {
                    var s = JsonSerializer.Deserialize<ProxySettings>(json);
                    if (s != null) return s;
                }
            }
            catch (Exception)
            {
                // 配置损坏时回退默认
            }
            return new ProxySettings();
        }

        public void Save()
        {
            DpapiJson.Save(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }

        /// <summary>
        /// 生成传给 WebView2 的代理相关浏览器参数。
        /// 返回的字符串可直接拼进 AdditionalBrowserArguments。
        /// </summary>
        public string BuildBrowserArguments()
        {
            switch (Mode)
            {
                case ProxyMode.Manual:
                    return string.IsNullOrWhiteSpace(ManualProxy)
                        ? ""
                        : $"--proxy-server={Normalize(ManualProxy)}";

                case ProxyMode.None:
                    return "--no-proxy-server";

                case ProxyMode.System:
                default:
                    var sys = DetectSystemProxy();
                    return string.IsNullOrWhiteSpace(sys)
                        ? ""
                        : $"--proxy-server={Normalize(sys)}";
            }
        }

        /// <summary>把 host:port 归一化为 Chromium 可识别的代理地址（http:// 前缀可省略，保留原样更稳）。</summary>
        private static string Normalize(string proxy)
        {
            proxy = proxy.Trim();
            // 形如 "http=127.0.0.1:7890;https=127.0.0.1:7890" 的多协议格式原样透传
            if (proxy.Contains('=') || proxy.Contains(';')) return proxy;
            return proxy;
        }

        /// <summary>从注册表读取 Windows 系统代理（WinINET 设置）。</summary>
        public static string DetectSystemProxy()
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
                if (key == null) return "";
                if (key.GetValue("ProxyEnable") is int enabled && enabled == 1)
                {
                    return key.GetValue("ProxyServer") as string ?? "";
                }
                return "";
            }
            catch (Exception)
            {
                return "";
            }
        }
    }
}
