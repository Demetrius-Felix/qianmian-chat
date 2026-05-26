# 千面聊天

一个中文的多人设自动对话聊天室（Web）。房间名与对话语言均为中文，支持自动对话与用户随时插话，支持流式输出。

## 运行（本地）

1. 复制环境变量示例

- `apps/server/.env.example` → `apps/server/.env`（不填模型也能跑：会走模拟流式）


2. 安装依赖

```bash
npm install
```

3. 构建
```bash
npm run build
```

4. 启动

```bash
npm run dev
```

## 默认地址

- Web: `http://localhost:3000`
- Server: `http://localhost:8787/health`

