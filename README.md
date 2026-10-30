# ChatGPT-Plugin (Chaite 2.0 极轻量客户端)

> 为 Yunzai-Bot 量身打造的全新 Chaite 2.0 AI Agent 客户端。  
> 告别繁琐的 `sqlite3`、`pg`、`vectra` 本地原生编译陷阱，纯 JavaScript 极速启动，体积骤降 98%，内存零占用！

---

## ✨ v4.0 重大革新

- **🚀 零死重依赖**：拔除原版近 3MB 的前端构建包与本地嵌入数据库，免去一切 C++ 编译报错；
- **🧠 移交上下文构建权**：群聊流水自动无缝喂入 Chaite 2.0 双水位线缓冲池，原生支持 `<chat_environment>`、`<chat_members>` 花名册与 `[#1]` 流动短序号引用，彻底吃满 Prefix Caching；
- **🤖 Agent 工具与记忆自主感知**：对话记忆彻底依托 SQLite 干净沉淀，由大模型自发使用 `remember` 工具，无需老版本低效的正则抽取；
- **🌐 独立部署与统一控制台**：所有预设、渠道、MCP 工具、插件均在全新的 Chaite 2.0 Web SPA 中统一可视化配置与热加载。

---

## 📦 安装与配置

### 1. 克隆插件
在 Yunzai 根目录下的 `plugins` 文件夹中执行：
```bash
git clone -b v4 https://github.com/syfantasy/chatgpt-plugin.git ./plugins/chatgpt-plugin
```

### 2. 安装依赖
```bash
# 仅需两个纯 JS 轻量依赖，毫秒级安装完成
pnpm install axios js-yaml
```

### 3. 配置连接
首次启动后会在 `plugins/chatgpt-plugin/config/config.yaml` 生成配置：
```yaml
chaite:
  url: 'http://127.0.0.1:48370'  # 你的 Chaite 2.0 服务端地址
  token: '你的管理密码'          # 首次在控制台设置的管理密码
```
也可以直接在 **锅巴面板 (Guoba)** 中图形化配置！

---

## 💬 常用指令

| 指令 | 权限 | 说明 |
|---|---|---|
| `@Bot <提问>` 或 `#chat <提问>` | 所有人 | 发起智能对话（支持附带图片） |
| `#结束对话` / `#重置对话` | 所有人 | 清空当前对话上下文与群流水 |
| `#chatgpt管理面板` | 管理员 | 私聊下发免密进入 Chaite 2.0 Web 控制台链接 |
| `#chatgpt状态` | 管理员 | 查看与 Chaite 后端的连接状态 |
| `#chatgpt切换模式 at/prefix/both` | 管理员 | 切换对话触发方式 |
| `#chatgpt更新` | 管理员 | 检查并拉取最新版本 |
