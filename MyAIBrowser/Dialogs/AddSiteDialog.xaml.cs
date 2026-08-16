// 文件路径：MyAIBrowser/Dialogs/AddSiteDialog.xaml.cs
// 功能：添加 / 编辑站点对话框逻辑。
using System.Windows;
using MyAIBrowser.Models;

namespace MyAIBrowser.Dialogs
{
    public partial class AddSiteDialog : Window
    {
        /// <summary>确定后返回的新站点数据；取消为 null。</summary>
        public Site? Result { get; private set; }

        private readonly bool _isEdit;

        public AddSiteDialog(Site? editTarget = null)
        {
            InitializeComponent();

            _isEdit = editTarget != null;
            if (_isEdit)
            {
                Title = "编辑站点";
                NameBox.Text = editTarget!.Name;
                UrlBox.Text = editTarget.Url;
            }
        }

        private void Header_MouseLeftButtonDown(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (e.ButtonState == System.Windows.Input.MouseButtonState.Pressed)
                DragMove();
        }

        private void Ok_Click(object sender, RoutedEventArgs e)
        {
            var name = NameBox.Text.Trim();
            var url = UrlBox.Text.Trim();

            if (string.IsNullOrWhiteSpace(name))
            {
                MessageBox.Show("请输入站点名称。", "添加站点", MessageBoxButton.OK, MessageBoxImage.Warning);
                NameBox.Focus();
                return;
            }
            if (string.IsNullOrWhiteSpace(url))
            {
                MessageBox.Show("请输入网址。", "添加站点", MessageBoxButton.OK, MessageBoxImage.Warning);
                UrlBox.Focus();
                return;
            }

            // 简单校验/补全协议
            if (!url.StartsWith("http://") && !url.StartsWith("https://") &&
                !url.StartsWith("about:") && !url.StartsWith("file:"))
            {
                url = "https://" + url;
            }

            Result = new Site { Name = name, Url = url, ProfileId = _isEdit ? "" : name.ToLowerInvariant() };
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e) => DialogResult = false;
    }
}
