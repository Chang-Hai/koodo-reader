# 自托管 Web 部署

这个分支按“只部署 Web 端”的目标配置。Docker 镜像只用 Caddy 托管
React 构建产物，不再启动旧的 HTTP server、OPDS server、KOReader sync
server、Electron app 或 Android app。

## 构建和启动

```bash
npm run build
docker compose up -d --build
```

默认会把 Web 服务映射到宿主机 `80` 端口。

如果要改端口：

```bash
KOODO_WEB_PORT=8080 docker compose up -d --build
```

## 移动端 PWA / 离线优先

这个 Web 构建已经启用 PWA：

- 手机浏览器第一次完整打开后，会注册 Service Worker 并缓存应用壳、阅读器运行库和首屏静态资源。
- 后续从手机主屏幕图标或浏览器书签打开时，会优先从本机缓存启动；服务器临时不可达时，已经缓存过的应用仍可打开。
- 导入的书籍文件、书库元数据、封面、阅读进度、笔记等仍使用浏览器本地存储，主要是 IndexedDB/localForage 和 localStorage。
- 自托管 PWA 默认启用离线优先，不会在启动时请求 Koodo 官方 userInfo，也不会自动读取 `self-hosted-storage.json` 配置或自动同步 WebDAV。

手机使用建议：

1. 先通过 Tailscale 打开 Koodo Reader。
2. 等第一次页面完整加载完成。
3. 用浏览器的“添加到主屏幕”安装为 PWA。
4. 后续直接从主屏幕图标进入；已导入到该手机的数据会留在手机本地。

注意：不同浏览器 profile / 不同安装入口的本地数据彼此隔离。卸载 PWA、清理站点数据或更换浏览器可能会删除手机本地书库。

## AI 全文翻译

自托管 Web 构建会解锁 Web 端的 Pro 功能门槛，方便私有测试。AI 全文翻译
不再调用 Koodo Reader 官方会员翻译接口，而是调用你在页面里配置的自定义
AI 模型。

在 Web 页面里配置：

```text
设置 -> AI 服务 -> AI translation model
```

选中的模型必须配置 endpoint、API key 和 model ID。

## 注意事项

- 书库数据和 AI 服务配置仍沿用原 Web 端存储层，主要保存在浏览器 profile 里。
- `self-hosted-storage.json` 服务器存储引导默认关闭。如果以后要恢复 WebDAV 自动配置，需要把 `public/index.html` 中的 `koodo-self-hosted-server-storage` meta 改为 `true`，并重新构建。
- `Dockerfile` 依赖已经存在的 `build/` 目录，所以先执行 `npm run build`，
  再执行 `docker compose up -d --build`。
- 这个配置用于个人私有自托管测试，不建议直接作为公开多用户服务上线。
