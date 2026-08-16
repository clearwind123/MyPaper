// 文件路径：MyAIBrowser/Models/Site.cs
// 功能：定义网站数据模型，包含名称、URL 等属性
namespace MyAIBrowser.Models
{
    public class Site
    {
        public string Name { get; set; } = "";
        public string Url { get; set; } = "";
        // 预留：未来可为每个网站分配独立的 WebView2 profile
        public string ProfileId { get; set; } = "";
    }
}