# build-release.ps1 — MyAI Browser 一键发布脚本
# 用法（需要已安装 .NET 8 SDK，且能联网以下载运行时包）：
#   PowerShell 运行：  .\build-release.ps1                 # 框架依赖版（目标机需装 .NET 8）
#   PowerShell 运行：  .\build-release.ps1 -SelfContained  # 自包含单文件版（目标机无需 .NET）
param(
    [switch]$SelfContained
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($SelfContained) {
    Write-Host "==> 构建自包含单文件版（约 150MB，目标机无需安装 .NET）..."
    dotnet publish MyAIBrowser.csproj -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -o "dist\self-contained" -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "publish 失败" }

    Compress-Archive -Path "dist\self-contained\*", "README.md" `
        -DestinationPath "MyAI Browser-自包含版.zip" -Force
    Write-Host "完成：MyAI Browser-自包含版.zip"
}
else {
    Write-Host "==> 构建框架依赖版（目标机需安装 .NET 8 桌面运行时）..."
    dotnet publish MyAIBrowser.csproj -c Release `
        -o "dist\framework-dependent" -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw "publish 失败" }

    Compress-Archive -Path "dist\framework-dependent\*", "README.md" `
        -DestinationPath "MyAI Browser-发布包.zip" -Force
    Write-Host "完成：MyAI Browser-发布包.zip"
}
