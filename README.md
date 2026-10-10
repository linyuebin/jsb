# 记事簿 · 私有化部署的团队记事本

一个面向**私有化部署**的 Web 记事本：企业人员用来记录私人账密、私密信息与日常笔记，
数据全部保存在自己的服务器上，支持图文混排、全文搜索、笔记分享（公开 / 密码保护）。

> 产品定位：只做私有化部署，不做公有云版本。交付方式为部署服务，数据与运行环境完全归客户所有。

## 功能特性

| 模块 | 说明 |
| --- | --- |
| 多账号 | 管理员创建成员账号（用户名/姓名/初始密码），支持停用、重置密码、删除 |
| 笔记 | 富文本图文混排：标题、加粗斜体、列表、引用、代码块、链接、分割线、图片 |
| 图片 | 支持点击插入、**直接粘贴截图**、拖拽上传；服务端做格式魔数校验 |
| 自动保存 | 编辑过程自动落库（防抖 800ms），显示保存状态 |
| 搜索 | 标题 + 正文全文搜索 |
| 自定义分组 | 每人可自建分组（账号密码 / 工作台账…），笔记一键移动；删除分组不删笔记 |
| 置顶 / 回收站 | 常用笔记置顶；删除进回收站，可还原或彻底删除 |
| 分享 | 每篇笔记可生成分享链接：**互联网公开**或**密码保护**两种模式；重新生成后旧链接立即失效 |
| 隐私 | 笔记仅本人可见，**管理员也无法查看成员笔记内容**，只管理账号 |
| 响应式 | 桌面双栏、移动端单栏切换，手机浏览器可用 |
| 双主题 | 亮色 / 暗色自动跟随系统，登录页、应用、分享页、官网均有手动切换入口（偏好本地记忆） |

## 安全设计

- 口令采用 **scrypt** 加盐哈希存储，登录校验使用常数时间比较
- 笔记 HTML 保存前经**服务端白名单净化**：仅保留受信标签/属性，剥离 script / iframe / 内联样式 / 事件属性，链接仅允许 http(s)/mailto，图片仅允许本站媒体
- 全站 **CSP**（`script-src 'self'`，无任何内联脚本）、`X-Frame-Options: DENY`、`nosniff`
- **登录爆破限流**（同用户名+IP 连续失败锁定 10 分钟）、**分享密码限流**
- 分享页图片防盗链：媒体文件必须持有效会话或分享访问凭据（`st`/`k`），密码保护的分享其图片同样需要解锁凭据，凭据 30 分钟滑动过期
- 上传文件做**魔数校验**（伪装成图片的 HTML/脚本会被拒绝），仅允许 png/jpg/gif/webp/bmp，单张默认上限 10MB
- 会话 Cookie：`HttpOnly` + `SameSite=Lax`，7 天滑动续期

## 环境要求

- Node.js ≥ 10（推荐 16 及以上），无需任何 npm 依赖、无需联网安装
- 磁盘空间按图片量估算即可，数据均为普通文件

## 快速开始

```bash
cd jsb
node server.js
# 打开 http://localhost:5320/ ，首次访问会引导创建管理员账号
```

## 配置

优先级：环境变量 > `config.json` > 默认值。可将 `config.example.json` 复制为 `config.json` 修改：

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `port` | `PORT` | `5320` | 监听端口 |
| `host` | `HOST` | `0.0.0.0` | 监听地址 |
| `dataDir` | `DATA_DIR` | `./data` | 数据目录（建议绝对路径） |
| `maxUploadMB` | - | `10` | 单张图片上限（MB） |
| `siteName` | - | `记事簿` | 站点名称（登录页与浏览器标题） |

## 部署

### 方式一：systemd（推荐）

```bash
# 1. 上传项目到 /opt/jsb
sudo cp -r jsb /opt/jsb
# 2. 安装服务单元
sudo cp deploy/jsb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jsb
sudo systemctl status jsb
```

### 方式二：pm2

```bash
npm i -g pm2   # 需要联网，或离线拷贝
pm2 start server.js --name jsb
pm2 save && pm2 startup
```

### 方式三：Docker

```bash
docker build -t jsb .
docker run -d --name jsb -p 5320:5320 -v /opt/jsb-data:/app/data --restart always jsb
```

### Nginx + HTTPS 反向代理（强烈建议）

记事本常用于记录账密，请务必启用 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name notes.example.com;

    ssl_certificate     /etc/nginx/cert.pem;
    ssl_certificate_key /etc/nginx/cert.key;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:5320;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 数据与备份

所有数据都在 `dataDir`（默认 `data/`）下，**备份该目录即备份全部数据**：

```
data/
├── users.json    # 账号（口令为 scrypt 哈希）
├── notes.json    # 笔记内容（净化后的 HTML，含分组归属）
├── groups.json   # 自定义分组
├── media.json    # 图片索引
└── media/        # 图片文件
```

- JSON 落盘为「临时文件 + 原子改名」，异常断电不会写坏半截文件；万一损坏会自动留档为 `*.corrupt-*` 并重建
- 迁移服务器：停服务 → 拷贝整个 `data/` 目录 → 新服务器启动即可
- 会话保存在内存中，服务重启后需要重新登录（安全优先）

## 目录结构

```
jsb/
├── server.js          # 服务入口：配置、路由分发、静态资源
├── lib/
│   ├── api.js         # 业务接口（账号/笔记/分组/分享/媒体）
│   ├── auth.js        # scrypt 口令与会话
│   ├── sanitize.js    # HTML 白名单净化器
│   ├── store.js       # JSON 原子持久化
│   └── util.js        # 工具函数
├── public/            # 前端（无构建、无 CDN 依赖，纯静态文件）
│   ├── index.html     # 主应用（初始化/登录/列表/编辑/管理）
│   ├── app.js         # 主逻辑
│   ├── editor.js      # 自研 contenteditable 富文本编辑器
│   ├── share.html     # 公开分享页
│   ├── share.js       # 分享页逻辑
│   └── style.css      # 样式（亮/暗、响应式）
├── website/           # 推广官网（单文件，可独立部署到任意静态空间）
│   └── index.html     # 也可由本服务直接访问：http://<host>:5320/site
├── deploy/jsb.service # systemd 单元
├── Dockerfile
└── config.example.json
```

## 常见问题

**Q：忘记管理员密码？**
在服务器上删除 `data/users.json` 中对应条目会使该账号消失（不推荐）；正规做法是：用另一管理员账号重置，或停服后手工清空 `users.json` 重新初始化（笔记数据不受影响，但需重新建立账号）。

**Q：分享链接打不开 / 显示"分享不存在"？**
分享被关闭、重新生成（旧链接失效）或笔记进了回收站都会返回不存在。重新打开分享即可。

**Q：能存多少数据？**
个人与团队规模（数万篇笔记、上万张图）没有压力；数据量大或多人并发极高时建议做 SQLite 化改造。

**Q：支持端口/路径调整吗？**
支持，见「配置」一节；路径前缀暂不支持，建议用子域名部署。

## 路线图（可选增强）

- 笔记端到端加密（浏览器本地加密后再存储，密钥不落服务端）
- 笔记历史版本与回滚
- 附件（非图片文件）支持
- 导出 Markdown / 打包备份

## 授权与交付

本产品仅以私有化部署服务方式交付，每次部署包含安装、配置与基础维护指导；不提供公有云版本。
