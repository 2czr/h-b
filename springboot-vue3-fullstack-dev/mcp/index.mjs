#!/usr/bin/env node
/**
 * fullstack-pipeline-mcp v1.2.0（零依赖版）
 * springboot-vue3-fullstack-dev 技能配套 MCP 服务器（stdio）。
 *
 * 不依赖任何第三方包：手写 MCP stdio 协议（换行分隔的 JSON-RPC 2.0），
 * 任何 Node >= 18 环境 `node index.mjs` 即可运行，无需 npm install。
 *
 * 工具：
 *   init_pipeline      创建 .fullstack/status.json
 *   get_status         读取流水线状态
 *   gate_report        六阶段门禁总览（含产物存在性检查）
 *   check_api_coverage 功能点 F-xx 覆盖率核对（通过才放行 stage_2）
 *   validate_api_doc   接口文档强制模板体检（四段/全局项）
 *   complete_stage     带门禁的阶段完成标记（顺序/产物/覆盖核对三重校验）
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const SERVER_NAME = "fullstack-pipeline";
const SERVER_VERSION = "1.2.0";

const STAGE_IDS = ["stage_1", "stage_2", "stage_3", "stage_4", "stage_5", "stage_6"];

const STAGES = [
  {
    id: "stage_1", name: "业务边界文档",
    gate: "文档含全部必填章节；功能点编号 F-xx；模糊点裁定 E-xx",
    artifacts: ["docs/01-business-boundary.md"],
  },
  {
    id: "stage_2", name: "接口文档",
    gate: "每接口四段模板；功能点→接口映射表全覆盖（coverage_check_passed=true）；全局错误码表只列一次",
    artifacts: ["docs/02-api-spec.md"],
  },
  {
    id: "stage_3", name: "测试文档",
    gate: "每接口正常+异常+边界用例；TC-<模块>-<序号>；可直接执行；造数幂等",
    artifacts: ["docs/03-test-cases.md"],
  },
  {
    id: "stage_4", name: "后端接口实现",
    gate: "模块级 mvn -q compile；逐接口勾销；路径/参数/返回/错误码与接口文档逐字段一致；安全基线满足",
    artifacts: ["docs/04-dev-progress.md"],
  },
  {
    id: "stage_5", name: "整合封装完整系统",
    gate: "可运行工程 + sql/init.sql + 本地演示profile + README；前端 npm run build 验证",
    artifacts: ["README.md"],
  },
  {
    id: "stage_6", name: "接口测试与反馈",
    gate: "全用例执行；用例↔方法映射表；缺陷定性分类；环境偏差与切回步骤",
    artifacts: ["docs/05-test-report.md"],
  },
];

/* ---------------- 业务工具函数 ---------------- */

function today() {
  return new Date().toISOString().slice(0, 10);
}

function resolveIn(root, rel) {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) {
    throw new Error(`路径越界，拒绝访问: ${rel}`);
  }
  return p;
}

function statusFile(root) {
  return resolveIn(root, ".fullstack/status.json");
}

async function readStatus(root) {
  let raw;
  try {
    raw = await fs.readFile(statusFile(root), "utf8");
  } catch {
    throw new Error("未找到 .fullstack/status.json，请先调用 init_pipeline 初始化流水线");
  }
  const status = JSON.parse(raw);
  for (const id of STAGE_IDS) {
    if (!status.stages?.[id]) {
      throw new Error(`status.json 缺少阶段 ${id}，请重新 init_pipeline`);
    }
  }
  return status;
}

async function writeStatus(root, status) {
  status.updated_at = today();
  await fs.mkdir(path.dirname(statusFile(root)), { recursive: true });
  await fs.writeFile(statusFile(root), JSON.stringify(status, null, 2) + "\n", "utf8");
}

function template(name) {
  const stages = {};
  for (const s of STAGES) {
    stages[s.id] = { name: s.name, completed: false, artifacts: [] };
    if (s.id === "stage_2") stages[s.id].coverage_check_passed = false;
    if (s.id === "stage_4") stages[s.id].implemented_apis = [];
    if (s.id === "stage_6") stages[s.id].pass_rate = null;
  }
  return {
    project: name || "",
    created_at: today(),
    updated_at: today(),
    current_stage: "stage_1",
    stages,
  };
}

async function fileExists(root, rel) {
  try {
    await fs.access(resolveIn(root, rel));
    return true; // 文件或目录均算有效产物（如 backend/、frontend/）
  } catch {
    return false;
  }
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function blocked(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

function requireProject(args) {
  if (!args || typeof args.project !== "string" || !args.project.trim()) {
    throw new Error("缺少必填参数 project（项目根目录绝对路径）");
  }
  return path.resolve(args.project);
}

/* ---------------- 工具定义（name / 描述 / JSON Schema / handler） ---------------- */

const TOOLS = [
  {
    name: "init_pipeline",
    description: "初始化六步流水线：在项目根目录创建 .fullstack/status.json（已存在则返回当前状态，不覆盖）",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "项目根目录绝对路径" },
        name: { type: "string", description: "项目名称，写入 status.json" },
      },
      required: ["project"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      const stat = await fs.stat(root).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        return blocked(`项目目录不存在: ${root}`);
      }
      if (await fileExists(root, ".fullstack/status.json")) {
        return ok({ initialized: false, reason: "status.json 已存在，保持不变", current: await readStatus(root) });
      }
      const status = template(args.name || path.basename(root));
      await writeStatus(root, status);
      return ok({
        initialized: true,
        status_file: ".fullstack/status.json",
        current_stage: status.current_stage,
        next_action: "按 SKILL.md 第 1 步产出业务边界文档，完成后调用 complete_stage(stage_1)",
      });
    },
  },
  {
    name: "get_status",
    description: "读取流水线状态（.fullstack/status.json），附带各阶段门禁说明",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "项目根目录绝对路径" } },
      required: ["project"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      const status = await readStatus(root);
      const merged = { ...status, stages: { ...status.stages } };
      for (const s of STAGES) {
        merged.stages[s.id] = { ...merged.stages[s.id], gate: s.gate };
      }
      return ok(merged);
    },
  },
  {
    name: "gate_report",
    description: "六阶段门禁总览：各阶段完成情况、门禁描述、产物文件存在性检查",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "项目根目录绝对路径" } },
      required: ["project"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      const status = await readStatus(root);
      const rows = [];
      for (const s of STAGES) {
        const declared = status.stages[s.id].artifacts || [];
        const toCheck = [...new Set([...s.artifacts, ...declared])];
        const artifacts = [];
        for (const rel of toCheck) {
          artifacts.push({ path: rel, exists: await fileExists(root, rel) });
        }
        rows.push({
          stage: s.id,
          name: s.name,
          completed: status.stages[s.id].completed,
          gate: s.gate,
          artifacts,
          artifacts_ok: artifacts.length > 0 && artifacts.every((a) => a.exists),
        });
      }
      return ok({ current_stage: status.current_stage, stages: rows });
    },
  },
  {
    name: "check_api_coverage",
    description: "功能点覆盖率核对：解析 docs/01 的 F-xx 功能点清单与 docs/02 的映射/引用；全部覆盖时置 stage_2.coverage_check_passed=true（complete_stage(stage_2) 的前置门禁）",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "项目根目录绝对路径" } },
      required: ["project"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      let boundary, spec;
      try {
        boundary = await fs.readFile(resolveIn(root, "docs/01-business-boundary.md"), "utf8");
        spec = await fs.readFile(resolveIn(root, "docs/02-api-spec.md"), "utf8");
      } catch (e) {
        return blocked(`边界文档或接口文档不存在: ${e.message}`);
      }
      const required = [...new Set([...boundary.matchAll(/F-\d+/g)].map((m) => m[0]))].sort(
        (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
      );
      const inSpec = new Set([...spec.matchAll(/F-\d+/g)].map((m) => m[0]));
      const missing = required.filter((f) => !inSpec.has(f));
      const passed = required.length > 0 && missing.length === 0;
      const result = {
        boundary_features: required.length,
        covered: required.length - missing.length,
        missing,
        passed,
        coverage_check_passed_set: false,
      };
      if (passed) {
        try {
          const status = await readStatus(root);
          if (!status.stages.stage_2.coverage_check_passed) {
            status.stages.stage_2.coverage_check_passed = true;
            await writeStatus(root, status);
          }
          result.coverage_check_passed_set = true;
        } catch {
          result.note = "status.json 不存在，仅返回核对结果";
        }
      }
      return ok(result);
    },
  },
  {
    name: "validate_api_doc",
    description: "接口文档强制模板体检：逐接口检查四段（文档概述/请求信息/响应信息/错误码说明）与全局项（基础地址、/api 前缀、200/401/403/404/500 错误码、功能点→接口映射表）",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "项目根目录绝对路径" } },
      required: ["project"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      let text;
      try {
        text = await fs.readFile(resolveIn(root, "docs/02-api-spec.md"), "utf8");
      } catch (e) {
        return blocked(`接口文档不存在: ${e.message}`);
      }
      const chunks = text.split(/^## /m);
      const perInterface = [];
      for (const chunk of chunks) {
        const m = chunk.match(/^(\d+)\s*[.、]/);
        if (!m || Number(m[1]) < 1) continue; // 跳过 0.全局约定 / 附录
        const title = chunk.split("\n")[0].trim();
        const missing = [];
        if (!/概述/.test(chunk)) missing.push("文档概述");
        if (!/请求/.test(chunk)) missing.push("请求信息");
        if (!/响应/.test(chunk)) missing.push("响应信息");
        if (!/错误码/.test(chunk)) missing.push("错误码说明");
        perInterface.push({ title, ok: missing.length === 0, missing });
      }
      const global = {
        base_url: /baseUrl|基础地址/.test(text),
        api_prefix: /\/api/.test(text),
        error_codes: ["200", "401", "403", "404", "500"].every((c) =>
          new RegExp(`(^|[^\\d])${c}([^\\d]|$)`).test(text),
        ),
        coverage_mapping_table: /功能点[^|\n]{0,20}接口|接口映射/.test(text),
      };
      const globalOk = Object.values(global).every(Boolean);
      return ok({
        interfaces: perInterface.length,
        per_interface: perInterface,
        global,
        passed: globalOk && perInterface.length > 0 && perInterface.every((i) => i.ok),
      });
    },
  },
  {
    name: "complete_stage",
    description: "标记阶段完成（三重门禁：前置阶段全部完成且不得跳步；产物文件必须存在；stage_2 须先通过 check_api_coverage）。通过后推进 current_stage",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "项目根目录绝对路径" },
        stage: { type: "string", enum: STAGE_IDS, description: "要完成的阶段" },
        artifacts: { type: "array", items: { type: "string" }, description: "额外产物路径（相对项目根），与该阶段默认产物合并校验" },
        pass_rate: { type: "string", description: "stage_6 专用，如 '71/71 (100%)'" },
      },
      required: ["project", "stage"],
    },
    handler: async (args) => {
      const root = requireProject(args);
      const stage = args.stage;
      if (!STAGE_IDS.includes(stage)) {
        return blocked(`stage 仅支持: ${STAGE_IDS.join(", ")}`);
      }
      const status = await readStatus(root);
      const idx = STAGES.findIndex((s) => s.id === stage);

      if (status.stages[stage].completed) {
        return ok({ ok: true, note: `${stage} 已完成，无需重复标记`, current_stage: status.current_stage });
      }
      if (status.current_stage !== stage) {
        return blocked(
          `禁止跳步：current_stage=${status.current_stage}，不能直接标记 ${stage}（门禁：${STAGES.find((s) => s.id === status.current_stage)?.gate}）`,
        );
      }
      const prevIncomplete = STAGES.slice(0, idx).filter((s) => !status.stages[s.id].completed).map((s) => s.id);
      if (prevIncomplete.length) {
        return blocked(`前置阶段未完成: ${prevIncomplete.join(", ")}，禁止跳步`);
      }
      if (stage === "stage_2" && !status.stages.stage_2.coverage_check_passed) {
        return blocked("stage_2 门禁未过：接口文档功能点覆盖核对未通过，请先调用 check_api_coverage");
      }
      const merged = [...new Set([...STAGES[idx].artifacts, ...(args.artifacts || [])])];
      const missing = [];
      for (const rel of merged) {
        if (!(await fileExists(root, rel))) missing.push(rel);
      }
      if (missing.length) {
        return blocked(`产物缺失，不得标记完成: ${missing.join(", ")}`);
      }

      status.stages[stage].completed = true;
      status.stages[stage].artifacts = merged;
      if (stage === "stage_6" && args.pass_rate) status.stages.stage_6.pass_rate = args.pass_rate;
      status.current_stage = idx === STAGES.length - 1 ? "done" : STAGES[idx + 1].id;
      await writeStatus(root, status);
      return ok({ ok: true, stage, gate_passed: STAGES[idx].gate, next_stage: status.current_stage });
    },
  },
];

/* ---------------- MCP stdio 协议层（JSON-RPC 2.0，换行分隔） ---------------- */

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // 非 JSON 行直接忽略
  }
  const id = msg.id;
  try {
    if (msg.method === "initialize") {
      reply({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: msg.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
    } else if (msg.method === "notifications/initialized") {
      // 通知，无需响应
    } else if (msg.method === "ping") {
      reply({ jsonrpc: "2.0", id, result: {} });
    } else if (msg.method === "tools/list") {
      reply({
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
    } else if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        reply({ jsonrpc: "2.0", id, error: { code: -32602, message: `未知工具: ${name}` } });
        return;
      }
      Promise.resolve()
        .then(() => tool.handler(msg.params?.arguments || {}))
        .then((result) => reply({ jsonrpc: "2.0", id, result }))
        .catch((e) =>
          reply({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true },
          }),
        );
    } else if (id !== undefined) {
      reply({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  } catch (e) {
    if (id !== undefined) {
      reply({ jsonrpc: "2.0", id, error: { code: -32603, message: `Internal error: ${e.message}` } });
    }
  }
});

rl.on("close", () => process.exit(0));
