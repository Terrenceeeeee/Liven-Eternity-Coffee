# 发布到 GitHub

这份指南按“先私有、再决定是否公开”的顺序写。项目里有你的 40 篇旧作、内部设定文档和角色原图，公开前要想清楚。

## 0. 先安装 Git

这台机器目前没有 `git`，也没有 `winget`。任选一种：

- 下载 Git for Windows：<https://git-scm.com/download/win>，安装时保持默认即可。
- 或者安装 GitHub Desktop：<https://desktop.github.com/>，用图形界面完成下面的操作。

安装后重新打开 PowerShell，确认：

```powershell
git --version
```

第一次使用先设置提交身份（把邮箱换成你的 GitHub 邮箱）：

```powershell
git config --global user.name "Terrence"
git config --global user.email "you@example.com"
```

## 1. 选仓库类型

### A. 私有仓库（推荐先这样做）

完整保留项目：语料、文档、角色图都在。只有你和你邀请的人能看。

编辑 `.gitignore`，删掉这四行：

```
knowledge/corpus/
作品/
docs/
assets/character/source/
```

其余忽略项（`dist/`、`node_modules/`、本机 settings 等）保留。

### B. 公开仓库（只公开程序）

`.gitignore` 保持默认即可，会排除：

- `knowledge/corpus/`（40 篇旧作）
- `作品/`（生成的作品）
- `docs/`（内部角色/文风/发布文档，含真实姓名与创作史）
- `assets/character/source/`（角色原图参考）
- `dist/`、`build/`、`app/node_modules/`、`app/shots/`

公开前建议再做两件事：

1. 把 `knowledge/style-profile.json` 里的 `author.realName` 改成 `Liven 的创作者`，删掉 `born`。
2. 在根目录加一个 `LICENSE`（代码可用 MIT），再加一个 `NOTICE` 说明：
   “故事、角色、立绘与设定文档不包含在代码许可证内，版权归作者所有。”

## 2. 本地初始化并检查

在项目根目录执行：

```powershell
cd "E:\我也是创作上了\虚拟Liven"
git init
git add .
git status
```

**不要直接 commit**，先看 `git status` 里有没有：

- `settings.json`、`chat.json`、`library.json`、`reading.json`、`serials.json`
- 任何 `sk-...` 开头的 API Key
- `dist/`、`build/`、`node_modules/`

确认干净后再提交：

```powershell
git commit -m "Eternity coffee 1.3.2: Liven desktop pet, writing studio and local shelf"
```

## 3. 在 GitHub 建空仓库

网页端 New repository：

- 名称建议：`eternity-coffee` 或 `liven-desktop-pet`
- 不要勾选 “Add a README / .gitignore / license”，本地已经有了
- 选 Public 或 Private

然后按页面提示关联远程仓库：

```powershell
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

第一次 push 会弹浏览器登录 GitHub；按提示授权即可。开了两步验证时，用 Personal Access Token 代替密码。

## 4. 安装包不要进 Git

`dist\EternityCoffee-Setup-1.3.2.exe` 约 183 MB，超过 GitHub 单文件 100 MB 限制，**不能 commit**。

正确做法是发 Release：

1. 仓库页面 → Releases → Draft a new release
2. Tag：`v1.3.2`
3. 标题：`Eternity coffee 1.3.2`
4. 上传附件：
   - `dist\EternityCoffee-Setup-1.3.2.exe`
   - 可再附一个 `SHA256.txt`
5. 不要上传带语料的完整绿色包 `EternityCoffee-1.3.2-win-x64.zip`，那是你个人用的。

发布说明里写清楚：

- 这是分享版，**不含** 40 篇旧作语料，所以「我的故事」是空的；
- 自签名证书 `CN=Terrence` 不被别人电脑默认信任，Windows 可能提示“未知发布者”；
- 数据只存在本机，安装包不含聊天/Key。

## 5. README 里补下载入口

在 README 顶部加：

```markdown
> 下载：见 [Releases](https://github.com/<用户名>/<仓库名>/releases)
```

## 6. 以后更新

改完代码后：

```powershell
git status
git add .
git commit -m "说明这次改了什么"
git push
```

发新版本时同时改 `app/package.json` 的 `version`，重新跑：

```powershell
node "工具\build-installer.js" --lite
```

再把新安装包作为新 Release 附件上传。

## 7. 公开前最后检查

- [ ] `.gitignore` 已生效，`git status` 中没有 `dist/`、`node_modules/`
- [ ] 没有 `settings.json`、API Key、聊天记录
- [ ] `knowledge/corpus/`、`作品/`、`docs/` 未进入公开仓库
- [ ] `style-profile.json` 已去掉真实姓名和出生年
- [ ] README 写清楚分享版不含旧作语料
- [ ] 安装包走 Releases，不进 Git
- [ ] 代码许可证与内容版权声明分开
