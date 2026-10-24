# fullstack-pipeline-mcp（v1.2.0 零依赖版）

`springboot-vue3-fullstack-dev` 技能的配套 MCP 服务器。**零第三方依赖**：不需要 `npm install`，任何 Node ≥ 18 环境 `node index.mjs` 直接运行。

## 工具列表

| 工具 | 作用 |
|---|---|
| `init_pipeline` | 在项目根创建 `.fullstack/status.json`（已存在则返回现状，不覆盖） |
| `get_status` | 读取流水线状态 + 各阶段门禁说明 |
| `gate_report` | 六阶段总览：完成情况、门禁、产物文件存在性 |
| `check_api_coverage` | 功能点 F-xx 覆盖率核对（docs/01 ↔ docs/02）；通过才置 `coverage_check_passed=true` |
| `validate_api_doc` | 接口文档模板体检：逐接口四段检查 + 全局项（baseUrl、/api、错误码、映射表） |
| `complete_stage` | 带三重门禁的阶段完成标记：顺序（禁跳步）+ 产物存在 + stage_2 覆盖核对 |

## 导入配置

### 通用 JSON（Claude Code / cc-switch / Claude Desktop 粘贴用）

把 `<MCP_DIR>` 替换为解压后 `mcp` 目录的**绝对路径**（建议用正斜杠 `/`，如 `C:/tools/springboot-vue3-fullstack-dev/mcp/index.mjs`）：

```json
{
  "mcpServers": {
    "fullstack-pipeline": {
      "command": "node",
      "args": ["<MCP_DIR>/index.mjs"]
    }
  }
}
```

### Claude Code 命令行

```bash
claude mcp add fullstack-pipeline -- node C:/tools/springboot-vue3-fullstack-dev/mcp/index.mjs
```

## 导入失败排查（按命中率排序）

| 症状 | 原因与解法 |
|---|---|
| 连接后立刻断开 / 状态 failed | `node` 不在 PATH。改用绝对路径：`"command": "C:/Program Files/nodejs/node.exe"` |
| Windows 客户端（Claude Desktop 等）启动失败 | 需要经过 cmd 包装：`"command": "cmd"`，`"args": ["/c", "node", "<MCP_DIR>/index.mjs"]` |
| 报 Cannot find package / Module not found | 用的是旧版（v1.1 需 npm install）。v1.2 已零依赖，确认导入的是新版 `index.mjs`（文件头注释标注 v1.2.0） |
| 路径里有反斜杠报错 | JSON 里 `\` 必须写成 `\\` 或改用 `/` |
| 导入 zip 没反应 | 不能把 zip 作为 MCP 导入：先解压，再按上面 JSON 指向解压后的 `index.mjs` |
| 连上但看不到工具 | 重启客户端；仍不行则终端手动运行 `node <MCP_DIR>/index.mjs`，确认无报错后按 Ctrl+C |

## 与技能的配合方式

1. 第 1 步开始前：`init_pipeline`；
2. 接口文档完成后：`validate_api_doc` 体检 → `check_api_coverage` 核对（通过自动置位）；
3. 每完成一个阶段：`complete_stage`（跳步/缺产物/覆盖未过会被直接拒绝并返回门禁原因）；
4. 随时 `gate_report` 查看总览。

MCP 未安装时技能仍可独立运行（退回文件级自查），二者不强绑定。
