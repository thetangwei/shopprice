# 店价宝 ShopPrice — 部署指南

店价宝是纯静态站点，不需要数据库、Node 服务或构建命令。把整个目录上传到任意静态托管即可。

> **关键提醒：`localStorage` 按“协议 + 域名 + 端口”隔离。**
> `file://`、`http://localhost:8123`、`https://shop.example.com` 是三个不同的数据空间。
> 换地址或换设备前，请先在“数据管理”下载完整 JSON 备份，在新地址恢复。

---

## 1. 本地使用

### 1.1 直接打开（最简单）

双击 `index.html`，或用浏览器打开文件。

- 适合：录入商品、查询、CSV 导入导出、备份恢复。
- 不适合：摄像头扫码。浏览器通常禁止 `file://` 页面访问摄像头。

### 1.2 本地 HTTP 服务（推荐调试）

在项目根目录执行：

```bash
# Python 3
python -m http.server 8123

# Node.js
npx serve .
```

访问 <http://localhost:8123/>。`localhost` 是安全上下文，可以使用摄像头。

指定其他端口：

```bash
python -m http.server 8080 --bind 127.0.0.1
```

### 1.3 手机在同一局域网访问

```bash
python -m http.server 8123 --bind 0.0.0.0
```

1. 查看电脑局域网 IP（Windows：`ipconfig`；macOS/Linux：`ifconfig` 或 `ip addr`）。
2. 手机访问 `http://电脑IP:8123/`。
3. 浏览器通常会把非 HTTPS 的局域网地址视为不安全，**摄像头可能无法启用**；商品查询和数据管理仍可用。需要手机扫码时请使用下面的 HTTPS 方案。

---

## 2. HTTPS（摄像头扫码的必要条件）

除了 `localhost`，浏览器只允许 HTTPS 页面调用摄像头。可选方案：

### 2.1 Caddy 本地/内网 HTTPS

```caddyfile
shop.local {
    root * /path/to/shopprice
    file_server
}
```

Caddy 会自动签发本地证书；手机需信任 Caddy 根证书。适合店内平板长期使用。

### 2.2 内网穿透 / 临时 HTTPS

可使用 Cloudflare Tunnel、ngrok 等工具把本地 8123 端口映射为 HTTPS 地址。注意：商品数据仍只存在访问该地址的浏览器里，隧道地址变化会影响数据归属。

### 2.3 正式静态托管

GitHub Pages、Netlify、Vercel、Cloudflare Pages 默认提供 HTTPS，是最省事的方式。

---

## 3. GitHub Pages

假设 `shopprice` 目录就是仓库根目录：

1. 推送代码到 GitHub。
2. 打开仓库 **Settings → Pages**。
3. **Build and deployment → Source** 选择 `Deploy from a branch`。
4. Branch 选择 `main`，目录选择 `/ (root)`，保存。
5. 等待 Actions 完成，访问 `https://用户名.github.io/仓库名/`。

如果 `shopprice` 是仓库中的子目录，请把 Pages 的目录设为 `/docs` 或将静态文件放到仓库根目录；GitHub Pages 不支持直接选择任意子目录作为站点根。

项目已包含 `.nojekyll`，避免以下划线开头的文件被 Jekyll 忽略。

### 更新版本

推送到同一分支即可。浏览器可能缓存 `styles.css` 和 JS；强制刷新（Ctrl/Cmd + Shift + R）后再确认。已保存的数据不会因更新丢失，除非清除了站点数据。

---

## 4. Netlify

### 拖拽部署

1. 打开 <https://app.netlify.com/drop>。
2. 把整个 `shopprice` 目录拖入页面。
3. 获得 `https://随机名.netlify.app` 地址。

### Git 部署

- Build command：留空
- Publish directory：`.`（如果仓库根就是项目根）
- 无需环境变量

---

## 5. Vercel

在项目根目录执行：

```bash
npx vercel --prod
```

- Framework Preset：Other
- Build Command：留空
- Output Directory：留空或 `.`

---

## 6. Cloudflare Pages

1. 连接 Git 仓库。
2. Build command：留空。
3. Build output directory：`/`（或项目根）。
4. 部署后使用分配的 `*.pages.dev` HTTPS 地址。

---

## 7. 自建 Nginx

```nginx
server {
    listen 80;
    server_name shop.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name shop.example.com;

    ssl_certificate     /etc/letsencrypt/live/shop.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;

    root /var/www/shopprice;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(css|js|png|svg)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }
}
```

- 必须启用 HTTPS，否则手机无法扫码。
- 静态资源可缓存；`index.html` 建议不长期缓存，便于升级。
- 站点根目录必须包含 `index.html` 和 `assets/`。

Apache 只需把目录设为 `DocumentRoot` 并启用 `mod_ssl`，无需重写规则（应用使用 hash 路由）。

---

## 8. 店内平板 / 专用设备

### 添加到主屏幕

- iPad Safari：分享 → 添加到主屏幕。
- Android Chrome：菜单 → 添加到主屏幕 / 安装应用。
- 桌面 Chrome/Edge：菜单 → 应用 → 安装此站点（或“创建快捷方式”，勾选“在窗口中打开”）。

### 浏览器全屏/应用模式

```bash
# Windows Chrome
chrome.exe --app=https://shop.example.com/

# 全屏 kiosk（不显示地址栏）
chrome.exe --kiosk https://shop.example.com/
```

建议：

- 给设备设置锁屏密码。
- 关闭浏览器“退出时清除数据”。
- 固定使用同一个浏览器和同一个域名。
- 每周下载一次完整 JSON 备份，另存到电脑或网盘。

---

## 9. 数据迁移与升级

### 从旧地址迁到新地址

1. 在旧地址打开“数据管理”。
2. 点击“下载完整备份”，得到 `shopprice-backup-YYYYMMDD.json`。
3. 在新地址打开店价宝。
4. “数据管理 → 恢复完整备份”，选择文件。
5. 默认“合并恢复”；若新地址是空数据，合并即可。
6. 抽查商品数、价格历史数和若干商品详情。

### 从旧版 Mini POS Market 升级

直接在同一域名/浏览器打开新版即可。首次启动会检测旧版 `products` 数据并迁移到新键，同时保留旧键。迁移只执行一次；迁移提示会显示在“数据管理”页。

### 版本更新

- 覆盖静态文件即可，`localStorage` 数据保留。
- 如果数据结构升级，应用会按 `schemaVersion` 校验备份；来自更高版本的备份会被拒绝，请先升级应用。
- 更新前仍建议下载备份。

---

## 10. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打开后没有数据 | 是否换了域名/端口/浏览器？`localStorage` 不跨源。用备份恢复。 |
| 扫码按钮提示不安全工作 | 使用 `https://` 或 `localhost`，不要用 `file://` 或普通局域网 HTTP。 |
| 摄像头黑屏/无法启动 | 检查系统与浏览器权限；关闭占用摄像头的其他应用；换 Chrome/Edge 重试；仍失败则手动输入条码。 |
| 手机能打开但不能扫码 | iOS/Android 浏览器要求 HTTPS；请部署到静态托管或配置内网证书。 |
| 保存失败/提示存储不可用 | 可能是无痕模式、浏览器禁用存储或配额已满。先导出备份，清理空间或换普通窗口。 |
| 刷新后修改丢失 | 检查是否在自动保存完成前强制关闭页面；编辑页停止输入约 0.6 秒后再离开。若持续出现，检查存储权限。 |
| 更新后仍是旧界面 | 强制刷新或清除静态资源缓存；数据不受影响。 |
| CSV 中文乱码 | 使用应用导出的 CSV 作为模板；导入文件建议 UTF-8（带不带 BOM 均可）。 |
| 恢复提示“不是店价宝备份” | 只能恢复应用生成的完整 JSON 备份；CSV 请走“导入商品 CSV”。 |

---

## 11. 部署检查清单

- [ ] 通过 HTTPS 或 localhost 访问
- [ ] `index.html`、`assets/css`、`assets/js`、`assets/vendor` 均已上传
- [ ] 页面标题为“店价宝 ShopPrice”，首页正常渲染
- [ ] 新增商品、刷新后数据仍在
- [ ] 摄像头权限可申请，扫码或手动输入可用
- [ ] CSV 导出/导入可用
- [ ] 完整备份可下载，并能在空环境恢复
- [ ] 已告知使用者：数据只在本机，需定期备份
