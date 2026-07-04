# ============================================================
#  VREEN Git 一键配置脚本
#  在 PowerShell 中执行:  .\setup-git.ps1
#  期间会提示你输入 GitHub 邮箱
# ============================================================

$ErrorActionPreference = 'Stop'
$repoPath = 'f:\开发\开源\GitHub\vreen\vreen'
Set-Location $repoPath

Write-Host ''
Write-Host '=== 1/6 设置全局 user.name ===' -ForegroundColor Cyan
git config --global user.name 'toujianjian'
Write-Host "user.name = $(git config --global user.name)" -ForegroundColor Green

Write-Host ''
Write-Host '=== 2/6 输入 GitHub 邮箱 ===' -ForegroundColor Cyan
Write-Host '  (推荐用 GitHub 注册邮箱,或者 GitHub 隐私邮箱)' -ForegroundColor Yellow
$email = Read-Host '  请输入你的 GitHub 邮箱'
if ([string]::IsNullOrWhiteSpace($email)) {
    Write-Host '  未输入邮箱,使用 GitHub 通用 noreply 占位,提交后会失败!' -ForegroundColor Red
    $email = 'toujianjian@users.noreply.github.com'
}
git config --global user.email $email
Write-Host "user.email = $(git config --global user.email)" -ForegroundColor Green

Write-Host ''
Write-Host '=== 3/6 优化中文路径下的 Git ===' -ForegroundColor Cyan
git config --global core.quotepath false        | Out-Null
git config --global core.autocrlf input          | Out-Null
git config --global init.defaultBranch main      | Out-Null
git config --global http.postBuffer 524288000    | Out-Null
Write-Host '  OK (core.quotepath / autocrlf / postBuffer)' -ForegroundColor Green

Write-Host ''
Write-Host '=== 4/6 关联远程 origin ===' -ForegroundColor Cyan
$existing = git remote get-url origin 2>$null
if ($existing) {
    Write-Host "  origin 已存在: $existing" -ForegroundColor Yellow
} else {
    git remote add origin https://github.com/toujianjian/vreen.git
    Write-Host '  origin = https://github.com/toujianjian/vreen.git' -ForegroundColor Green
}

Write-Host ''
Write-Host '=== 5/6 创建初始提交 ===' -ForegroundColor Cyan
# 确保忽略 tsbuildinfo 等缓存
git rm --cached tsconfig.app.tsbuildinfo tsconfig.node.tsbuildinfo 2>$null | Out-Null
# 添加 .gitignore 的修改
git add .gitignore
git commit -m 'chore: initial commit — VREEN 3D display system

- React 18 + TypeScript 5 + Vite 5 + Three.js stack
- Multi-format 3D model loader (GLB/GLTF/OBJ/FBX/STL/PLY)
- 9-camera POV system with tunable FOV / distance / damping
- Material lab, post-fx, environment controls
- Cyberpunk HUD theme with TailwindCSS'

if ($LASTEXITCODE -ne 0) {
    Write-Host '  提交失败,通常是邮箱未生效,请检查 user.email' -ForegroundColor Red
    exit 1
}
Write-Host '  OK' -ForegroundColor Green

Write-Host ''
Write-Host '=== 6/6 推送到 GitHub ===' -ForegroundColor Cyan
Write-Host '  如果你的 GitHub 仓库还没建,先打开这个链接创建:' -ForegroundColor Yellow
Write-Host '  https://github.com/new  (Repository name: vreen)' -ForegroundColor Yellow
$go = Read-Host '  仓库已建好? 输入 y 继续推送, n 跳过'
if ($go -eq 'y' -or $go -eq 'Y') {
    git push -u origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  推送失败。常见原因: (1) GitHub 仓库未建; (2) 网络问题; (3) 需要 Personal Access Token' -ForegroundColor Red
        Write-Host '  如果是 Token 鉴权,先去 https://github.com/settings/tokens 生成一个' -ForegroundColor Yellow
    } else {
        Write-Host '  推送成功! 仓库地址: https://github.com/toujianjian/vreen' -ForegroundColor Green
    }
} else {
    Write-Host '  跳过推送,之后手动执行: git push -u origin main' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 全部完成 ===' -ForegroundColor Cyan
Write-Host '之后每次修改,标准流程:' -ForegroundColor White
Write-Host '  git add .' -ForegroundColor Gray
Write-Host '  git commit -m "描述"' -ForegroundColor Gray
Write-Host '  git push' -ForegroundColor Gray
