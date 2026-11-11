using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// Per-user, offline installation. Payloads never include personal state or model weights.
public class Installer : Form {
    Label status;
    Button install;
    CheckBox prepareWorkBuddy;
    bool completed;
    static string PackageVersion() {
        using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("version.txt"))
        using(var reader=new StreamReader(stream)){
            string value=reader.ReadToEnd().Trim();
            if(!System.Text.RegularExpressions.Regex.IsMatch(value,@"^\d+\.\d+\.\d+$"))
                throw new Exception("安装包版本无效");
            return value;
        }
    }
    public Installer() {
        Text="安装 SCUT 学习助手";ClientSize=new Size(510,300);StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(250,251,248);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;
        var title=new Label {Text="SCUT 学习助手",Font=new Font("Microsoft YaHei UI",21),AutoSize=true,Location=new Point(32,28)};
        status=new Label {Text="安装后，从桌面或开始菜单打开。\n运行环境已包含；无需安装 Python。\n不会设置开机自启。",Font=new Font("Microsoft YaHei UI",11),Location=new Point(34,88),Size=new Size(440,90)};
        prepareWorkBuddy=new CheckBox {Text="检查并准备已安装的 WorkBuddy",Checked=true,AutoSize=true,Location=new Point(34,197)};
        install=new Button {Text="安装并打开",Font=new Font("Microsoft YaHei UI",11),Location=new Point(300,242),Size=new Size(165,40)};
        install.Click+=async(s,e)=>await Install();Controls.AddRange(new Control[]{title,status,prepareWorkBuddy,install});
    }
    async Task Install() {
        if(completed){Close();return;}
        install.Enabled=false;prepareWorkBuddy.Enabled=false;status.Text="正在安装到当前用户目录…";
        try {
            string parent=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","SCUTStudy");
            string target=Path.Combine(parent,"app-"+PackageVersion());
            bool prepare=prepareWorkBuddy.Checked;
            string buddy=await Task.Run(()=>{
                Directory.CreateDirectory(parent);
                if(!File.Exists(Path.Combine(target,"SCUT学习助手.exe"))) {
                    string stage=Path.Combine(parent,"install-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
                    using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
                    using(var zip=new ZipArchive(stream,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
                        string path=Path.GetFullPath(Path.Combine(stage,entry.FullName));
                        if(!path.StartsWith(stage+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("安装包路径无效");
                        if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(path);continue;}
                        Directory.CreateDirectory(Path.GetDirectoryName(path));entry.ExtractToFile(path);
                    }
                    if(Directory.Exists(target))throw new Exception("发现未完成的安装目录，请先将该目录改名后重试："+target);
                    Directory.Move(stage,target);
                }
                var ps=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32","WindowsPowerShell","v1.0","powershell.exe");
                using(var p=Process.Start(new ProcessStartInfo(ps,"-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \""+Path.Combine(target,"install-desktop.ps1")+"\" -NoLaunch") {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=target})){
                    if(!p.WaitForExit(60000)||p.ExitCode!=0)throw new Exception("文件已安装，但桌面入口创建失败。请打开安装目录中的 SCUT学习助手.exe。");
                }
                return prepare ? PrepareWorkBuddy(target) : "可在首页接入 WorkBuddy。";
            });
            status.Text="安装完成。以后双击桌面的 SCUT 学习助手。\n"+buddy;
            Process.Start(Path.Combine(target,"SCUT学习助手.exe"));install.Text="完成";completed=true;install.Enabled=true;
        }catch(Exception ex){status.Text=ex.Message;install.Enabled=true;prepareWorkBuddy.Enabled=true;}
    }
    static string PrepareWorkBuddy(string target) {
        try {
            var psi=new ProcessStartInfo(Path.Combine(target,"runtime","python.exe"),
                "-X utf8 \""+Path.Combine(target,"scripts","prepare_workbuddy.py")+"\" --desktop install") {
                WorkingDirectory=target,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,StandardOutputEncoding=Encoding.UTF8};
            using(var p=Process.Start(psi)){
                if(!p.WaitForExit(30000)){p.Kill();return "WorkBuddy 检查超时。可在首页重试。";}
                string result=p.StandardOutput.ReadToEnd();
                if(result.Contains("\"installed\": false"))return "安装 WorkBuddy 后，可从首页接入。";
                if(p.ExitCode==0 && result.Contains("\"ok\": true"))return "本地连接器检查通过。首次启用按 WorkBuddy 提示操作。";
                if(result.Contains("\"state\": \"paths_changed\""))return "已有其他资料目录。可在首页切换连接。";
            }
        }catch(Exception){}
        return "请在首页检查 WorkBuddy 连接。";
    }
    [STAThread] public static void Main(){Application.EnableVisualStyles();Application.Run(new Installer());}
}
