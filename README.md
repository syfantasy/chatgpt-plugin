# ChatGPT-Plugin (Chaite 2.0 极轻量客户端)

> 为 Yunzai-Bot 量身打造的全新 Chaite 2.0 AI Agent 客户端。  
> 告别繁琐的 `sqlite3`、`pg`、`vectra` 等本地原生编译陷阱，支持 **「远程 HTTP 桥接」** 与 **「同进程内嵌依赖」** 双模自适应接入！

---

## ✨ v4.0 重大革新

- **🚀 双模自适应架构**：既可作为纯传话筒连接独立常驻的 Chaite 2.0 服务端（零内存开销），也可通过别名机制将 Chaite 作为依赖在同进程直接内嵌运行；
- **🧠 移交上下文构建权**：群聊流水自动无缝喂入 Chaite 2.0 双水位线缓冲池，原生支持 `<chat_environment>`、`<chat_members>` 花名册与 `[#1]` 流动短序号引用，彻底吃满 Prefix Caching；
- **🤖 Agent 工具与记忆自主感知**：对话记忆彻底依托 SQLite 干净沉淀，由大模型自发使用 `remember` 工具，无需老版本低效的正则抽取；
- **🌐 统一可视化控制台**：所有预设、渠道、MCP 工具、插件均在全新的 Chaite 2.0 Web SPA 中统一可视化管理与热加载。

---

## 📦 安装流程

### 第一步：克隆插件
在 Yunzai 根目录下的 `plugins` 文件夹中执行：
```bash
git clone -b v4 https://github.com/syfantasy/chatgpt-plugin.git ./plugins/chatgpt-plugin
```

### 第二步：安装基础运行依赖（必选）
在 Yunzai 根目录下执行（均为纯 JavaScript 轻量依赖，毫秒级装完，零编译报错）：
```bash
pnpm install axios js-yaml -w
```

---

## 🔌 第三步：选择接入方式（二选一）

插件默认配置为 `mode: 'auto'`，**无需手动修改模式开关**，系统会自动根据环境智能适配！

### 方式 A：独立部署 / 远程 HTTP 模式（推荐 ⭐，极简免运维）
> **适用于**：Chaite 2.0 作为独立常驻服务运行（跑在本机独立进程、局域网或云服务器）。Yunzai 侧作为轻量客户端，零内存负担。

只需在 `plugins/chatgpt-plugin/config/config.yaml`（或直接在**锅巴面板**）中填入 Chaite 的连接地址与密码：
```yaml
chaite:
  url: 'http://127.0.0.1:48370'  # 你的 Chaite 服务端地址
  token: '你的管理密码'          # 首次在控制台设置的管理密码
```

---

### 方式 B：同进程内嵌依赖模式（单进程运行）
> **适用于**：希望像旧版一样，直接在 Yunzai 的同一个 Node 进程内加载运行 Chaite，不需要额外单独挂守护进程。

在 Yunzai 根目录下利用 npm 别名机制安装 GitHub 仓库依赖（无需注册 npm 账号）：
```bash
pnpm add chaite@github:syfantasy/node-chaite -w
```
> **提示**：安装后重启 Yunzai，插件会自动探测到本地依赖并以同进程内嵌模式启动，同时自动拉起本地 48370 端口的 Web 控制台！

---

## 💬 常用指令

| 指令 | 权限 | 说明 |
|---|---|---|
| `@Bot <提问>` 或 `#chat <提问>` | 所有人 | 发起智能对话（支持附带图片与引用） |
| `#结束对话` / `#重置对话` | 所有人 | 清空当前对话上下文与群流水 |
| `#chatgpt管理面板` | 管理员 | 私聊下发免密进入 Chaite 2.0 Web 控制台链接 |
| `#chatgpt状态` | 管理员 | 查看当前运行模式与 Chaite 后端连接状态 |
| `#chatgpt切换模式 at/prefix/both` | 管理员 | 切换对话触发方式 |
| `#chatgpt更新` | 管理员 | 检查并拉取最新版本 |
