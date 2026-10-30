# ChatGPT-Plugin (Chaite 2.0 极轻量客户端)

> 为 Yunzai-Bot 量身打造的全新 Chaite 2.0 AI Agent 客户端。  
> 支持 **「远程 HTTP 桥接」** 与 **「本地内嵌依赖」** 双模自适应接入！

---

## ✨ v4.0 重大革新

- **🚀 双模自适应架构**：既支持连接独立部署的 Chaite 2.0 服务端（Yunzai 端零编译、零内存负担），也支持通过 GitHub / npm 别名将 Chaite 作为本地依赖同进程内嵌运行；
- **🧠 移交上下文构建权**：群聊流水自动无缝喂入 Chaite 2.0 双水位线缓冲池，原生支持 `<chat_environment>`、`<chat_members>` 花名册与 `[#1]` 流动短序号引用，彻底吃满 Prefix Caching；
- **🤖 Agent 工具与记忆自主感知**：对话记忆彻底依托 SQLite 干净沉淀，由大模型自发使用 `remember` 工具，无需老版本低效的正则抽取；
- **🌐 统一可视化控制台**：所有预设、渠道、MCP 工具、插件均在全新的 Chaite 2.0 Web SPA 中统一管理与热加载。

---

## 📦 安装插件

在 Yunzai 根目录下的 `plugins` 文件夹中执行：
```bash
git clone -b v4 https://github.com/syfantasy/chatgpt-plugin.git ./plugins/chatgpt-plugin
```

---

## 🔌 两种接入方式（二选一）

插件默认配置为 `mode: 'auto'`，会自动探测本地是否安装了 `chaite` 依赖包，未安装则自动走 HTTP 桥接。

### 方式一：远程服务桥接模式（推荐 ⭐，零编译、最稳）

将 Chaite 2.0 独立部署运行（本机或局域网/云服务器均可），Yunzai 插件仅作为轻量传话筒，彻底告别 `sqlite3` 等 C++ 原生编译报错：

1. **安装轻量通信依赖**：
   ```bash
   pnpm install axios js-yaml -w
   ```
2. **配置连接信息**：
   编辑 `plugins/chatgpt-plugin/config/config.yaml`（或直接在**锅巴面板**配置）：
   ```yaml
   chaite:
     mode: 'http'
     url: 'http://127.0.0.1:48370'  # Chaite 2.0 服务端地址
     token: '你的管理密码'          # Chaite Web 控制台的管理密码
   ```

---

### 方式二：本地依赖内嵌模式（单进程运行）

如果你希望像旧版一样，在 Yunzai 同一个进程内直接作为库加载运行 `node-chaite`：

1. **通过 npm 别名直接从 GitHub 安装 `@syfantasy/chaite`**：
   在 Yunzai 根目录下执行：
   ```bash
   # 利用别名机制将 node-chaite 安装为 chaite 依赖
   pnpm add chaite@github:syfantasy/node-chaite -w
   ```
   *(若本地已有克隆好的 `node-chaite` 目录，也可直接软链：`pnpm add chaite@file:/path/to/node-chaite -w`)*

2. **配置内嵌模式**：
   在 `plugins/chatgpt-plugin/config/config.yaml` 中设置：
   ```yaml
   chaite:
     mode: 'embedded'  # 或保持 'auto' 自动探测
   ```

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
