import dotenv from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createServer } from "node:http";
import { Server as IOServer } from "socket.io";
import { OpenAI } from "openai";
import {
  CreateRoomInputSchema,
  type CreateRoomInput,
  type DirectorDecision,
  DirectorDecisionSchema,
  type EmotionVector,
  type InterruptType,
  type RoleCard,
  RoomConfigSchema,
  type RoomTemplateId,
  UserMessageInputSchema,
} from "@qianmian/shared";
import { getRolesByTemplate, ROOM_TEMPLATES, PRESET_ROLES } from "./presets.js";
import { evolveRelationship, evolveCrossMemory, buildCrossMemoryContext } from "./relationship.js";
import { saveRoom, loadAllRooms } from "./storage.js";

type SpeakerType = "user" | "role" | "host" | "narrator" | "system";

function debugLog(params: { runId: string; hypothesisId: string; location: string; message: string; data?: Record<string, unknown> }) {
  // #region agent log
  fetch("http://127.0.0.1:7823/ingest/49c72feb-4c55-44d8-b76a-4a7307e66036", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f9fbb0" },
    body: JSON.stringify({
      sessionId: "f9fbb0",
      runId: params.runId,
      hypothesisId: params.hypothesisId,
      location: params.location,
      message: params.message,
      data: params.data ?? {},
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

type ChatMessage = {
  id: string;
  roomId: string;
  speakerType: SpeakerType;
  speakerId?: string;
  speakerName: string;
  content: string;
  createdAt: number;
  meta?: Record<string, unknown>;
};

type InterruptItem = {
  id: string;
  type: InterruptType;
  content: string;
  createdAt: number;
};

export type RoomRuntime = {
  id: string;
  config: {
    name: string;
    templateId: RoomTemplateId;
    selectedRoleIds: string[];
    activeRoleIds: string[];
    maxTurns: number;
    windowSize: number;
  };
  messages: ChatMessage[];
  summary: string;
  relationships: Record<string, {
    intimacy: number; // 亲密度 0-100
    dynamicTrait: string; // 动态演化的性格标签
    memo: string; // 关键记忆点
  }>;
  crossMemory: Record<string, Record<string, { content: string; createdAt: number }[]>>;
  roleEmotionTuning: Record<string, EmotionVector>;
  interruptQueue: InterruptItem[];
  running: boolean;
  mutedRoleIds: string[];
  mentionRoleIds: string[];
  turnIndex: number;
  lastSpeakerRoleId?: string;
  loopToken?: string;
  streamAbort?: AbortController;
};

dotenv.config({ override: true });

const env = {
  PORT: Number(process.env.QIANMIAN_PORT ?? 8787),
  CORS_ORIGIN: process.env.QIANMIAN_CORS_ORIGIN ?? "http://localhost:3000",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? "",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  DIRECTOR_MODEL: process.env.DIRECTOR_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};

const openai =
  env.OPENAI_API_KEY && env.OPENAI_BASE_URL
    ? new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL })
    : env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
      : null;

if (openai) {
  // eslint-disable-next-line no-console
  console.log(`[OpenAI] Initialized with Model: ${env.OPENAI_MODEL}, BaseURL: ${env.OPENAI_BASE_URL}`);
} else {
  // eslint-disable-next-line no-console
  console.warn("[OpenAI] API Key missing, running in MOCK mode.");
}

function nowId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const DEFAULT_EMOTION_VECTOR: EmotionVector = {
  empathy: 68,
  calmness: 62,
  positivity: 58,
  rationality: 56,
  energy: 50,
};

const EMOTION_AXES: Array<keyof EmotionVector> = ["empathy", "calmness", "positivity", "rationality", "energy"];

type SensitiveCategory = "violence" | "self_harm" | "depression";

type SensitiveDetectionResult = {
  riskLevel: "none" | "mild" | "high";
  score: number;
  categories: SensitiveCategory[];
  matchedWords: string[];
};

const SENSITIVE_RULES: Array<{ pattern: RegExp; category: SensitiveCategory; score: number; cue: string }> = [
  { pattern: /(残杀|虐杀|屠杀|砍死|弄死|灭口|血洗)/i, category: "violence", score: 4, cue: "暴力伤害" },
  { pattern: /(自杀|轻生|不想活|结束生命|了结自己|割腕|跳楼)/i, category: "self_harm", score: 6, cue: "自伤倾向" },
  { pattern: /(抑郁|绝望|活着没意义|撑不住|好累不想活|情绪崩溃)/i, category: "depression", score: 3, cue: "重度消极" },
  { pattern: /(想消失|很痛苦|崩溃了|没希望了|一无是处)/i, category: "depression", score: 2, cue: "低落信号" },
];

function clampEmotionValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mergeEmotionVector(base: EmotionVector, patch: Partial<EmotionVector>): EmotionVector {
  const next: EmotionVector = { ...base };
  for (const axis of EMOTION_AXES) {
    const v = patch[axis];
    if (typeof v === "number" && Number.isFinite(v)) {
      next[axis] = clampEmotionValue(v);
    }
  }
  return next;
}

function initRoleEmotionTuning(roleIds: string[], existing?: Record<string, EmotionVector>): Record<string, EmotionVector> {
  const next: Record<string, EmotionVector> = { ...(existing ?? {}) };
  for (const roleId of roleIds) {
    next[roleId] = mergeEmotionVector(DEFAULT_EMOTION_VECTOR, next[roleId] ?? {});
  }
  return next;
}

function getRoleEmotionVector(room: RoomRuntime, roleId: string): EmotionVector {
  if (!room.roleEmotionTuning[roleId]) {
    room.roleEmotionTuning[roleId] = { ...DEFAULT_EMOTION_VECTOR };
  }
  return room.roleEmotionTuning[roleId]!;
}

function buildEmotionBehaviorHint(vector: EmotionVector): string {
  const hints: string[] = [];
  hints.push(vector.empathy >= 70 ? "优先共情用户感受" : "先简短确认情绪，再进入观点");
  hints.push(vector.calmness >= 70 ? "语速慢、措辞稳" : "允许适度情绪张力但不失控");
  hints.push(vector.positivity >= 70 ? "多给希望导向" : "真实承认困难，避免空泛鸡汤");
  hints.push(vector.rationality >= 70 ? "提供结构化分析和步骤" : "多用陪伴式表达");
  hints.push(vector.energy >= 65 ? "语气更主动" : "保持温柔克制");
  return hints.join("；");
}

function detectSensitiveEmotion(content: string): SensitiveDetectionResult {
  const matchedWords: string[] = [];
  const categories = new Set<SensitiveCategory>();
  let score = 0;

  for (const rule of SENSITIVE_RULES) {
    if (rule.pattern.test(content)) {
      categories.add(rule.category);
      score += rule.score;
      matchedWords.push(rule.cue);
    }
  }

  const riskLevel: SensitiveDetectionResult["riskLevel"] =
    score >= 6 || categories.has("self_harm") ? "high" : score > 0 ? "mild" : "none";

  return {
    riskLevel,
    score,
    categories: Array.from(categories),
    matchedWords,
  };
}

function buildCounselingMessage(result: SensitiveDetectionResult): string {
  if (result.riskLevel === "high") {
    return "我注意到你现在很痛苦，这很重要。先把自己放在安全位置，做三次慢呼吸；如果你有伤害自己或他人的冲动，请立刻联系当地紧急援助电话或可信任的人，我们可以继续一步步聊。";
  }
  return "我感受到你现在的压力和低落了，这并不丢人。我们可以先把最难受的那一件事说清，再一起拆成一个今天能做到的小步骤。";
}

function pickActiveRoles(room: RoomRuntime): RoleCard[] {
  const map = new Map(PRESET_ROLES.map((r) => [r.id, r]));
  return room.config.activeRoleIds.map((id) => map.get(id)).filter(Boolean) as RoleCard[];
}

function getRoomWindow(room: RoomRuntime): ChatMessage[] {
  const win = room.messages.slice(-room.config.windowSize);
  return win;
}

function makeRoomSystemRule(room: RoomRuntime): string {
  const t = ROOM_TEMPLATES[room.config.templateId];
  const rules = [
    `你正在一个中文聊天室「${room.config.name}」，类型是「${t.name}」。`,
    "【重要规则】",
    "1. 说话要极度口语化，像真人在微信或群聊里聊天一样。",
    "2. 严禁输出长篇大论。单次发言控制在 1-2 句话，总字数不超过 30 字。",
    "3. 不要每次都自我介绍，不要说“你好”、“我觉得”等废话，直接进入正题。",
    "4. 语气要自然，多用语气词（如：啊、吧、哈、呢、呃...）。",
    "5. 所有的回复必须是中文。",
  ];

  if (room.config.templateId === "group") {
    rules.push("6. 【群聊记忆】在发言时，要敏锐捕捉其他角色的观点。如果其他角色的发言很有趣或有争议，请直接回应、评价或调侃他们，而不是只顾着自己说话。");
  }

  return rules.join("\n");
}

function buildRolePrompt(room: RoomRuntime, role: RoleCard, instruction: string): string {
  const lines: string[] = [];
  lines.push(makeRoomSystemRule(room));
  lines.push("");
  lines.push(`【你的身份】${role.name}`);
  lines.push(role.identity);

  // 注入关系记忆
  const relation = room.relationships[role.id];
  if (relation) {
    lines.push(`【当前关系】亲密度:${relation.intimacy}/100，当前性格特质:${relation.dynamicTrait}`);
    if (relation.memo) lines.push(`【长期记忆】${relation.memo}`);
  }

  const emotionVector = getRoleEmotionVector(room, role.id);
  lines.push(`【情感调节】共情:${emotionVector.empathy}/100，冷静:${emotionVector.calmness}/100，积极:${emotionVector.positivity}/100，理性:${emotionVector.rationality}/100，能量:${emotionVector.energy}/100`);
  lines.push(`【表达倾向】${buildEmotionBehaviorHint(emotionVector)}`);

  if (role.voice?.tags?.length) lines.push(`【口吻标签】${role.voice.tags.join("、")}`);
  if (role.format) lines.push(`【输出格式】${role.format}`);
  if (role.dos?.length) lines.push(`【必须】${role.dos.join("；")}`);
  if (role.donts?.length) lines.push(`【禁止】${role.donts.join("；")}`);
  lines.push("");
  if (room.summary.trim()) {
    lines.push("【房间摘要】");
    lines.push(room.summary.trim());
    lines.push("");
  }
  // 注入群聊跨角色记忆
  if (room.config.templateId === "group") {
    const crossContext = buildCrossMemoryContext(room, role.id);
    if (crossContext) {
      lines.push("");
      lines.push(crossContext);
      lines.push("");
    }
  }

  lines.push("【最近对话】");
  for (const m of getRoomWindow(room)) {
    lines.push(`${m.speakerName}：${m.content}`);
  }
  lines.push("");
  lines.push("【你的任务】");
  lines.push(instruction);
  lines.push("");
  lines.push("请直接输出你的发言内容，不要加前缀（例如“某某：”）。");
  return lines.join("\n");
}

function mockReply(role: RoleCard, room: RoomRuntime, instruction: string): string {
  const mood = role.voice?.tags?.[0] ?? "自然";
  const tailQuestions = ["你觉得呢？", "要不要试试换个角度？", "你更在意哪一点？", "要不要我展开说说？"];
  const q = tailQuestions[(room.turnIndex + role.id.length) % tailQuestions.length];
  const base = `${instruction}\n（${mood}）我先接着说：`;
  const body = [
    "我理解你的意思。",
    "我补充一个点：别让话题停在结论上，最好抛个可继续聊的钩子。",
    q,
  ];
  return `${base}${body.join("")}`;
}

async function streamTextAsDeltas(text: string, emitDelta: (chunk: string) => void) {
  // 简单模拟流式：按字符切片，避免一次性刷屏
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    emitDelta(chars[i] ?? "");
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 12));
  }
}

async function generateRoleMessage(params: {
  room: RoomRuntime;
  role: RoleCard;
  instruction: string;
  onDelta: (chunk: string) => void;
  logger?: any;
}): Promise<{ content: string; meta?: Record<string, unknown> }> {
  const { room, role, instruction, onDelta, logger } = params;

  if (!openai) {
    const text = mockReply(role, room, instruction);
    await streamTextAsDeltas(text, onDelta);
    return { content: text, meta: { mode: "mock" } };
  }

  const prompt = buildRolePrompt(room, role, instruction);
  const startedAt = Date.now();
  
  // 确保旧的 AbortController 被清理，并创建新的
  if (room.streamAbort) {
    room.streamAbort.abort();
  }
  room.streamAbort = new AbortController();

  try {
    const stream = await openai.chat.completions.create(
      {
        model: env.OPENAI_MODEL,
        messages: [
          { 
            role: "system", 
            content: "你是一个中文聊天室中的角色扮演者。输出必须极度口语化，严禁长篇大论，单次发言不超过30字。" 
          },
          { role: "user", content: prompt },
        ],
        temperature: role.parameters?.temperature ?? 0.8,
        top_p: role.parameters?.top_p ?? 1,
        max_tokens: role.parameters?.max_tokens ?? 150, // 降低 max_tokens 强制短输出
        stream: true,
      },
      { signal: room.streamAbort.signal },
    );

    let full = "";
    for await (const event of stream) {
      if (!room.running) break;
      const delta = event.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }

    return {
      content: full.trim(),
      meta: { mode: "llm", model: env.OPENAI_MODEL, latencyMs: Date.now() - startedAt },
    };
  } catch (err: any) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      throw err; // 向上传递中断错误
    }
    if (logger) {
      logger.error(err, "LLM Generation Error");
    } else {
      console.error("LLM Generation Error:", err);
    }
    return { content: " (信号不好，先不说了) ", meta: { error: true } };
  }
}

function interruptPriority(type: InterruptType): number {
  if (type === "stop") return 100;
  if (type === "change_goal") return 90;
  if (type === "correct") return 80;
  if (type === "add_constraint") return 60;
  if (type === "add_setting") return 50;
  return 10; // ask
}

function enqueueInterrupt(room: RoomRuntime, item: InterruptItem) {
  // 合并策略：同类高优先级插话只保留最新一条，避免队列堆积
  const dedupeTypes: InterruptType[] = ["stop", "change_goal", "correct", "add_constraint", "add_setting"];
  if (dedupeTypes.includes(item.type)) {
    room.interruptQueue = room.interruptQueue.filter((x) => x.type !== item.type);
  }

  // 按优先级插入（高在前）；同优先级按时间先后
  const p = interruptPriority(item.type);
  let inserted = false;
  for (let i = 0; i < room.interruptQueue.length; i++) {
    const cur = room.interruptQueue[i]!;
    if (interruptPriority(cur.type) < p) {
      room.interruptQueue.splice(i, 0, item);
      inserted = true;
      break;
    }
  }
  if (!inserted) room.interruptQueue.push(item);
}

function shouldHostIntervene(room: RoomRuntime): boolean {
  // 仅在房间没有任何对话（包括用户插话）且回合数为 0 时，由旁白开场
  return room.turnIndex === 0 && room.messages.length === 0;
}

function computeInstruction(room: RoomRuntime, role: RoleCard): string {
  const t = room.config.templateId;
  // 过期插话清理（默认 2 分钟）
  const ttlMs = 2 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  room.interruptQueue = room.interruptQueue.filter((x) => x.createdAt >= cutoff);

  const interrupt = room.interruptQueue.shift();
  if (interrupt) {
    const base = `用户在对话中插入了以下内容：\n「${interrupt.content}」\n\n`;
    
    if (interrupt.type === "stop") return `${base}用户要求停止。请用你的身份（${role.name}）给出一个符合人设的友好收尾。`;
    if (interrupt.type === "correct") return `${base}用户纠错/反驳了之前的观点。请先以你的专业背景（${role.identity}）对该反馈做出评估，然后给出更准确的解释。`;
    if (interrupt.type === "change_goal") return `${base}用户修改了对话目标。请评估新目标的可行性，并提出下一步的具体建议。`;
    if (interrupt.type === "add_constraint") return `${base}用户新增了约束条件。请分析该约束对当前任务的影响，并调整你的后续计划。`;
    if (interrupt.type === "add_setting") return `${base}用户新增了背景设定。请在回复中融入这个新设定，并表现出相应的反应。`;
    
    return `${base}请结合上下文回应此插话，并尝试引导对话继续。`;
  }

  // 常规推进逻辑
  if (t === "task") {
    return "请根据当前场景，用专业口吻给出一个具体的、可操作的推进点，并抛出一个澄清问题。";
  }
  if (t === "group") {
    return "请针对当前任务进度，给出一个实质性的建议或指出一个潜在风险，并询问其他角色的看法。";
  }
  return "请接住上一条对话的梗或话题点，用你的独特口吻发表见解，并抛出一个开放性问题。";
}

function pickNextRole(room: RoomRuntime): RoleCard {
  const active = pickActiveRoles(room);
  const last = room.lastSpeakerRoleId;
  const nextInterrupt = room.interruptQueue[0];

  // 1. 如果有被 @ 的角色，无视禁言优先从中选择
  if (room.mentionRoleIds.length > 0) {
    const mentioned = active.filter(r => room.mentionRoleIds.includes(r.id));
    if (mentioned.length > 0) {
      return mentioned[Math.floor(Math.random() * mentioned.length)];
    }
  }

  // 2. 过滤掉被禁言的角色
  const nonMuted = active.filter(r => !room.mutedRoleIds.includes(r.id));
  
  // 如果所有人都被禁言了，且没有 @，则没有下一个发言者
  if (nonMuted.length === 0) return null as any; 

  function roleScore(r: RoleCard): number {
    let s = Math.random() * 2.0; // 基础随机性

    // 严厉惩罚连续同一人发言
    if (r.id === last) s -= 15.0;

    // 模板内轻微轮转偏置
    s += 0.5 * (room.turnIndex % active.length);

    // 根据插话类型匹配角色技能/口吻 (核心优化)
    if (nextInterrupt) {
      const skills = (r.skills ?? []).join(" ").toLowerCase();
      const tags = (r.voice?.tags ?? []).join(" ").toLowerCase();
      const identity = r.identity.toLowerCase();
      const text = `${skills} ${tags} ${identity}`;

      switch (nextInterrupt.type) {
        case "correct":
          if (text.includes("理性") || text.includes("合规") || text.includes("逻辑") || text.includes("测试")) s += 8.0;
          if (text.includes("犀利") || text.includes("反例")) s += 4.0;
          break;
        case "change_goal":
          if (text.includes("优先级") || text.includes("落地") || text.includes("产品") || text.includes("架构")) s += 8.0;
          break;
        case "add_constraint":
          if (text.includes("边界") || text.includes("风险") || text.includes("权衡") || text.includes("谨慎")) s += 7.0;
          break;
        case "add_setting":
          if (text.includes("叙事") || text.includes("创意") || text.includes("幽默") || text.includes("文案")) s += 7.0;
          break;
        case "ask":
          if (text.includes("追问") || text.includes("启发") || text.includes("耐心") || text.includes("老师")) s += 6.0;
          break;
      }
    }

    // 距离上次发言越久，得分越高 (简单历史补偿)
    // 注意：这里仅作示意，实际可记录每个角色的 lastSpeakTurn
    return s;
  }

  const scored = active
    .map((r) => ({ r, s: roleScore(r) }))
    .sort((a, b) => b.s - a.s);

  // 取得分最高的，若得分太近则随机采样
  const top = scored[0]!.r;
  const second = scored[1]?.r;
  
  if (second && (scored[0]!.s - scored[1]!.s < 1.0)) {
    return Math.random() < 0.3 ? second : top;
  }
  
  return top;
}

async function directorStep(params: {
  room: RoomRuntime;
}): Promise<DirectorDecision> {
  const { room } = params;

  // 1. 特殊指令：停止
  if (room.turnIndex >= room.config.maxTurns) {
    return {
      nextSpeaker: { type: "narrator" },
      intent: "summarize",
      phase: "wrap",
      instruction: "到达轮数上限。用一句中文旁白做收束，并提示用户可以继续插话或创建新房间。",
      shouldStop: true,
      stopReason: "达到轮数上限",
    };
  }

  if (room.interruptQueue[0]?.type === "stop") {
    return {
      nextSpeaker: { type: "narrator" },
      intent: "summarize",
      phase: "wrap",
      instruction: "收到，我们先在这里做个小结。如果你想继续，可以再发一条插话或改目标。",
      shouldStop: true,
      stopReason: "用户停止",
    };
  }

  // 2. 特殊指令：禁言/解除禁言 (静默处理)
  const first = room.interruptQueue[0];
  if (first?.type === "mute_roles" as any) {
    room.interruptQueue.shift(); // 消费掉这个插话
    // 注意：具体逻辑在 pickNextRole 之前已经由 socket 处理或在这里同步
    // 我们返回一个空决策让循环继续
    return null as any;
  }

  const host = shouldHostIntervene(room);
  if (host) {
    return {
        nextSpeaker: { type: "narrator" },
        intent: "transition",
        phase: room.config.templateId === "task" ? "clarify" : "free",
        instruction: "大家好，欢迎来到这个聊天室。我们先围绕目标开始聊聊吧，谁先起个头？",
        shouldStop: false,
      };
  }

  const role = pickNextRole(room);
  return {
    nextSpeaker: { type: "role", id: role.id },
    intent: "respond",
    phase: "free",
    instruction: computeInstruction(room, role),
    shouldStop: false,
  };
}

// 在模块级保持 rooms 引用
const rooms = new Map<string, RoomRuntime>();

async function runRoomLoop(roomId: string, io: IOServer, logger?: any) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.running) return;
  room.running = true;
  room.loopToken = nowId("loop");
  const loopToken = room.loopToken;
  debugLog({ runId: "pre-fix", hypothesisId: "H1", location: "apps/server/src/index.ts:runRoomLoop", message: "loop.start", data: { roomId, loopToken } });

  io.to(roomId).emit("room.state", {
    roomId,
    running: true,
    mutedRoleIds: room.mutedRoleIds,
    turnIndex: room.turnIndex,
    name: room.config.name,
    templateId: room.config.templateId,
  });

  while (room.running) {
    if (room.loopToken !== loopToken) break;

    const lastSpeakerIdBeforeStep = room.lastSpeakerRoleId;
    const decision = await directorStep({ room });
    
    // 如果没有下一个发言者（例如所有人都被禁言了）
    if (!decision || !decision.nextSpeaker || (decision.nextSpeaker.type === 'role' && !decision.nextSpeaker.id)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    
    // 如果需要停止（如达到上限或用户强制停止）
    if (decision.shouldStop) {
      room.running = false;
      // ... 发送最后一条消息逻辑 ...
      break;
    }

    // --- 连发机制重构 ---
    // 决定当前角色要连发几条消息
    // 权重分配：2-4条 (约80%)，1或5条 (约20%)
    const getWeightedBurstCount = () => {
      const rand = Math.random();
      if (rand < 0.1) return 1; // 10% 概率发1条
      if (rand < 0.2) return 5; // 10% 概率发5条
      return Math.floor(Math.random() * 3) + 2; // 80% 概率发2-4条
    };
    
    let burstCount = getWeightedBurstCount();
    let totalCharsInBurst = 0;
    
    for (let i = 0; i < burstCount; i++) {
      if (!room.running || room.loopToken !== loopToken) break;

      if (decision.nextSpeaker.type === "narrator" || decision.nextSpeaker.type === "host") {
        // ... 主持人/旁白逻辑保持单条 ...
        const msgId = nowId("m");
        const speakerName = decision.nextSpeaker.type === "host" ? "主持人" : "旁白";
        const m: ChatMessage = {
          id: msgId,
          roomId,
          speakerType: decision.nextSpeaker.type,
          speakerName,
          content: "",
          createdAt: Date.now(),
          meta: { intent: decision.intent, phase: decision.phase },
        };
        room.messages.push(m);
        io.to(roomId).emit("message.start", m);
        await streamTextAsDeltas(decision.instruction, (chunk) => {
          if (!room.running) return;
          io.to(roomId).emit("message.delta", { roomId, messageId: msgId, delta: chunk });
        });
        m.content = decision.instruction;
        io.to(roomId).emit("message.done", m);
        break; // 旁白不连发
      } else {
        const roleId = decision.nextSpeaker.id!;
        const role = PRESET_ROLES.find((r) => r.id === roleId);
        if (!role) break;

        // 模拟“正在输入”
        let thinkingTime = 400 + Math.random() * 800;
        // 如果是群聊模块，调慢响应时间，模拟真人在群里看到消息后的反应
        if (room.config.templateId === "group") {
          thinkingTime += 1000 + Math.random() * 1500;
        }
        await new Promise((r) => setTimeout(r, thinkingTime));
        if (!room.running) break;

        const msgId = nowId("m");
        const m: ChatMessage = {
          id: msgId,
          roomId,
          speakerType: "role",
          speakerId: role.id,
          speakerName: role.name,
          content: "",
          createdAt: Date.now(),
          meta: { intent: decision.intent, phase: decision.phase, burstIndex: i },
        };
        room.messages.push(m);
        io.to(roomId).emit("message.start", m);

        // 如果是连发的第一条以外，增加“补充”指令
        const burstInstruction = i > 0 
          ? `${decision.instruction} (这是你的连发补充消息，请保持极短，一句话即可，不要重复之前的意思)`
          : decision.instruction;

        try {
          const { content, meta } = await generateRoleMessage({
            room,
            role,
            instruction: burstInstruction,
            onDelta: (chunk) => io.to(roomId).emit("message.delta", { roomId, messageId: msgId, delta: chunk }),
            logger,
          });

          m.content = content;
          m.meta = { ...(m.meta ?? {}), ...(meta ?? {}) };
          
          // 连发字数关联逻辑：
          // 如果单句话字数较多（超过 20 字），则减少后续连发概率
          // 如果当前累积字数已过多，提前结束连发
          totalCharsInBurst += content.length;
          if (content.length > 20 && i < burstCount - 1) {
            // 字数多，有 50% 概率削减剩下的连发
            if (Math.random() < 0.5) burstCount = i + 1;
          }
          if (totalCharsInBurst > 60) break; // 累积字数上限控制

          room.lastSpeakerRoleId = role.id;
          
          // 如果该角色是被 @ 的，从列表中移除
          room.mentionRoleIds = room.mentionRoleIds.filter(id => id !== role.id);
          
          io.to(roomId).emit("message.done", m);

          // ★ 关系演化：角色发言后更新与用户的关系
          evolveRelationship(room, role.id, content);

          // ★ 群聊跨角色记忆更新
          if (room.config.templateId === "group") {
            const recentWindow = getRoomWindow(room).slice(-6);
            const recentMsgs = recentWindow.map(msg => ({
              speakerId: msg.speakerId,
              speakerName: msg.speakerName,
              content: msg.content,
            }));
            evolveCrossMemory(room, role.id, pickActiveRoles(room), recentMsgs);
          }

          // 自动保存到磁盘（每隔 3 条消息保存一次，平衡 I/O）
          if (room.turnIndex % 3 === 0 && i === 0) {
            saveRoom(room).catch(err => console.error("[AutoSave] Failed:", err));
          }
        } catch (err: any) {
          if (err.name === 'AbortError') {
             // 正常中断，不报错
             console.log(`[Burst] Message ${msgId} aborted`);
             break;
          }
          throw err;
        }

        // 连发之间的微小停顿
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      }
    }

    room.turnIndex += 1;
    io.to(roomId).emit("room.state", {
      roomId,
      running: room.running,
      mutedRoleIds: room.mutedRoleIds,
      turnIndex: room.turnIndex,
      name: room.config.name,
      templateId: room.config.templateId,
    });

    if (!room.running) break;

    // 换人前的等待：模拟对方阅读和思考
    const lastMsgLen = room.messages[room.messages.length - 1]?.content.length ?? 0;
    let cooldown = Math.min(2500, 800 + lastMsgLen * 20); 

    // 角色切换检测：如果当前发言者与上一次不同，冷却时间加倍
    const currentSpeakerId = decision.nextSpeaker.type === "role" ? decision.nextSpeaker.id : undefined;
    if (currentSpeakerId && lastSpeakerIdBeforeStep && currentSpeakerId !== lastSpeakerIdBeforeStep) {
      cooldown *= 2;
    }

    // 如果是群聊模块，额外增加随机等待时间
    if (room.config.templateId === "group") {
      cooldown += 1500 + Math.random() * 1500;
    }
    await new Promise((r) => setTimeout(r, cooldown));
  }
}

async function main() {
  // ★ 启动时从磁盘加载之前保存的房间
  try {
    const loaded = await loadAllRooms();
    for (const [id, room] of loaded) {
      const roleIds = room.config.selectedRoleIds?.length ? room.config.selectedRoleIds : room.config.activeRoleIds;
      room.roleEmotionTuning = initRoleEmotionTuning(roleIds, room.roleEmotionTuning);
      rooms.set(id, room);
    }
    console.log(`[Startup] Loaded ${loaded.size} rooms from disk`);
  } catch (err) {
    console.error("[Startup] Failed to load rooms:", err);
  }

  const fastify = Fastify({ 
    logger: true,
    // 显式开启请求日志，帮助排查假死问题
    disableRequestLogging: false 
  });

  // 1. 立即注册路由，确保在任何异步插件挂起前路由已存在
  fastify.get("/health", async () => ({ ok: true, name: "qianmian-server", timestamp: Date.now() }));
  
  fastify.get("/rooms/history", async () => {
    // 简单实现：返回内存中所有已创建的房间概要
    return Array.from(rooms.values()).map(r => ({
      id: r.id,
      name: r.config.name,
      templateId: r.config.templateId,
      lastMessage: r.messages[r.messages.length - 1]?.content ?? "新房间",
      messageCount: r.messages.length,
      createdAt: r.messages[0]?.createdAt ?? Date.now()
    })).sort((a, b) => b.createdAt - a.createdAt);
  });
  
  fastify.get("/roles", {
    schema: {
      query: {
        type: "object",
        properties: {
          templateId: { type: "string" }
        }
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              avatar: { type: "string" },
              templateId: { type: "string" },
              identity: { type: "string" },
              skills: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    }
  }, async (req, reply) => {
    const { templateId } = req.query as { templateId?: RoomTemplateId };
    
    // 角色数据是静态的，设置 1 小时缓存
    reply.header("Cache-Control", "public, max-age=3600");

    try {
      let list = templateId ? getRolesByTemplate(templateId) : PRESET_ROLES;
      if (list.length === 0) list = PRESET_ROLES;

      // 仅返回列表渲染所需的精简字段
      return list.map(r => ({
        id: r.id,
        name: r.name,
        avatar: r.avatar,
        templateId: r.templateId,
        identity: r.identity,
        skills: r.skills
      }));
    } catch (err) {
      fastify.log.error(err, "API: Error fetching roles");
      return PRESET_ROLES;
    }
  });

  // 2. 注册 CORS 插件
  await fastify.register(cors, {
    origin: true, // 简化为 true 以解决所有跨域假死可能
    credentials: true,
  });

  // 3. 启动服务器并挂载 Socket.io
  // 使用 Fastify 官方推荐的 listen 方式，这会自动处理底层 httpServer 的创建
  try {
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    
    const io = new IOServer(fastify.server, {
      cors: { origin: "*", credentials: true }, // Socket.io 也使用宽松跨域
    });

    // 4. 挂载 Socket.io 事件处理
    io.on("connection", (socket) => {
      // ... socket 事件逻辑保持不变 ...
      debugLog({ runId: "pre-fix", hypothesisId: "H3", location: "apps/server/src/index.ts:io.connection", message: "socket.connected" });
      socket.emit("server.ready", { ok: true });

      socket.on("room.create", (input: CreateRoomInput, ack?: (res: unknown) => void) => {
        const parsed = CreateRoomInputSchema.safeParse(input);
        if (!parsed.success) {
          ack?.({ ok: false, error: parsed.error.flatten() });
          return;
        }
        const cfg = parsed.data;

        // 服务端校验角色数量约束
        const roleCount = cfg.selectedRoleIds.length;
        if (cfg.templateId === "emotional" && (roleCount < 1 || roleCount > 2)) {
          return ack?.({ ok: false, error: "情感陪伴模式请选择 1-2 个角色" });
        }
        if (cfg.templateId === "group" && (roleCount < 2 || roleCount > 10)) {
          return ack?.({ ok: false, error: "群聊模拟模式请选择 2-10 个角色" });
        }
        if (cfg.templateId === "task" && roleCount !== 1) {
          return ack?.({ ok: false, error: "现实任务模式请选择 1 个角色" });
        }

        const id = nowId("room");
        const runtime: RoomRuntime = {
          id,
          config: {
            name: cfg.name,
            templateId: cfg.templateId,
            selectedRoleIds: cfg.selectedRoleIds,
            activeRoleIds: cfg.selectedRoleIds.slice(0, Math.min(6, cfg.selectedRoleIds.length)),
            maxTurns: cfg.templateId === "emotional" ? 30 : cfg.templateId === "group" ? 24 : 18,
            windowSize: 20,
          },
          messages: [],
          summary: "",
          relationships: {},
          crossMemory: {},
          roleEmotionTuning: initRoleEmotionTuning(cfg.selectedRoleIds),
          interruptQueue: [],
          running: false,
          mutedRoleIds: [],
          mentionRoleIds: [],
          turnIndex: 0,
        };
        rooms.set(id, runtime);
        ack?.({ ok: true, room: runtime });

        // 新房间首次保存
        saveRoom(runtime).catch(err => console.error("[AutoSave] Failed to save new room:", err));
      });

      socket.on("room.join", (data: { roomId: string }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) {
          ack?.({ ok: false, error: "房间不存在" });
          return;
        }
        socket.join(room.id);
        
        // 获取当前房间的角色详情
        const roles = pickActiveRoles(room);
        room.roleEmotionTuning = initRoleEmotionTuning(room.config.selectedRoleIds, room.roleEmotionTuning);

        // 优化：在 join 响应中不返回完整的 messages 列表，messages 会通过 room.messages 事件单独同步
        const { messages: _, ...roomWithoutMessages } = room;
        ack?.({ ok: true, room: { ...roomWithoutMessages, roles } });
        socket.emit("room.state", {
          roomId: room.id,
          running: room.running,
          mutedRoleIds: room.mutedRoleIds,
          turnIndex: room.turnIndex,
          name: room.config.name,
          templateId: room.config.templateId,
        });
        socket.emit("room.emotion.state", { roomId: room.id, roleEmotionTuning: room.roleEmotionTuning });
        socket.emit("room.messages", { roomId: room.id, messages: room.messages });
      });

      socket.on("room.start", (data: { roomId: string }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) {
          ack?.({ ok: false, error: "房间不存在" });
          return;
        }
        if (room.running) {
          ack?.({ ok: true, alreadyRunning: true });
          return;
        }
        ack?.({ ok: true });
        void runRoomLoop(room.id, io, fastify.log);
      });

      socket.on("room.stop", (data: { roomId: string }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) return ack?.({ ok: false, error: "房间不存在" });
        room.running = false;
        room.streamAbort?.abort();
        room.loopToken = nowId("loop");
        // 保存房间当前状态
        saveRoom(room).catch(err => console.error("[AutoSave] Failed on stop:", err));
        ack?.({ ok: true });
      });

      socket.on("room.mute", (data: { roomId: string; roleIds: string[]; muted: boolean }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) return ack?.({ ok: false, error: "房间不存在" });
        
        if (data.muted) {
          // 禁言：加入列表
          room.mutedRoleIds = [...new Set([...room.mutedRoleIds, ...data.roleIds])];
        } else {
          // 解除禁言：从列表移除
          room.mutedRoleIds = room.mutedRoleIds.filter(id => !data.roleIds.includes(id));
        }

        ack?.({ ok: true });
        io.to(room.id).emit("room.state", {
          roomId: room.id,
          running: room.running,
          mutedRoleIds: room.mutedRoleIds,
          turnIndex: room.turnIndex,
          name: room.config.name,
          templateId: room.config.templateId,
        });
      });

      socket.on("room.emotion.update", (data: { roomId: string; roleId: string; patch: Partial<EmotionVector> }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) return ack?.({ ok: false, error: "房间不存在" });
        if (!data.roleId) return ack?.({ ok: false, error: "roleId 不能为空" });

        room.roleEmotionTuning = initRoleEmotionTuning(room.config.selectedRoleIds, room.roleEmotionTuning);
        const base = getRoleEmotionVector(room, data.roleId);
        room.roleEmotionTuning[data.roleId] = mergeEmotionVector(base, data.patch ?? {});

        io.to(room.id).emit("room.emotion.state", { roomId: room.id, roleEmotionTuning: room.roleEmotionTuning });
        saveRoom(room).catch((err) => console.error("[AutoSave] Failed on emotion update:", err));

        ack?.({ ok: true, vector: room.roleEmotionTuning[data.roleId] });
      });

      socket.on("user.message", (input, ack?: (res: unknown) => void) => {
        const parsed = UserMessageInputSchema.safeParse(input);
        if (!parsed.success) {
          ack?.({ ok: false, error: parsed.error.flatten() });
          return;
        }
        const data = parsed.data;
        const room = rooms.get(data.roomId);
        if (!room) return ack?.({ ok: false, error: "房间不存在" });

        const sensitive = detectSensitiveEmotion(data.content);

        const msgId = nowId("m");
        const m: ChatMessage = {
          id: msgId,
          roomId: data.roomId,
          speakerType: "user",
          speakerName: "用户",
          content: data.content,
          createdAt: Date.now(),
          meta: {
            interruptType: data.interruptType,
            sensitive: sensitive.riskLevel,
            sensitiveCategories: sensitive.categories,
            sensitiveMatchedWords: sensitive.matchedWords,
          },
        };
        room.messages.push(m);
        
        // 关键修复：前端 Store 需要先收到 start 才能在 finalize 时正确显示
        io.to(room.id).emit("message.start", m);
        io.to(room.id).emit("message.done", m);

        if (sensitive.riskLevel !== "none") {
          const support: ChatMessage = {
            id: nowId("m"),
            roomId: data.roomId,
            speakerType: "system",
            speakerName: "情感守护",
            content: buildCounselingMessage(sensitive),
            createdAt: Date.now(),
            meta: {
              sensitive: sensitive.riskLevel,
              sensitiveCategories: sensitive.categories,
              sensitiveMatchedWords: sensitive.matchedWords,
            },
          };
          room.messages.push(support);
          io.to(room.id).emit("message.start", support);
          io.to(room.id).emit("message.done", support);
        }
        
        // 记录日志排查
        // eslint-disable-next-line no-console
        console.log(`[Message] User sent message to room ${data.roomId}: ${data.content}`);

        const guidance =
          sensitive.riskLevel === "high"
            ? "【情感干预优先】用户出现明显伤害/重度消极信号。请先稳定情绪、确认安全，再给一个非常小的可执行步骤，避免刺激性措辞。"
            : sensitive.riskLevel === "mild"
              ? "【情感关怀】用户存在低落信号。请先共情，再给温和、可执行的引导。"
              : "";

        const item: InterruptItem = {
          id: nowId("i"),
          type: data.interruptType,
          content: guidance ? `${guidance}\n用户原话：${data.content}` : data.content,
          createdAt: Date.now(),
        };
        enqueueInterrupt(room, item);
        
        // 处理 @ 提到的人
        if (data.mentionRoleIds && data.mentionRoleIds.length > 0) {
          room.mentionRoleIds = [...new Set([...room.mentionRoleIds, ...data.mentionRoleIds])];
        }

        // 如果用户发了消息，强制中断当前 LLM 流（如果正在运行）
        if (room.running && room.streamAbort) {
          room.streamAbort.abort();
          // eslint-disable-next-line no-console
          console.log(`[Interrupt] Aborting current stream due to user message`);
        }

        ack?.({ ok: true });
      });

      socket.on("room.updateConfig", (data: { roomId: string; patch: Partial<RoomRuntime["config"]> }, ack?: (res: unknown) => void) => {
        const room = rooms.get(data.roomId);
        if (!room) return ack?.({ ok: false, error: "房间不存在" });
        const merged = { ...room.config, ...data.patch };
        const check = RoomConfigSchema.safeParse(merged);
        if (!check.success) return ack?.({ ok: false, error: check.error.flatten() });
        room.config = merged;
        ack?.({ ok: true, room });
        io.to(room.id).emit("room.state", { 
          roomId: room.id, 
          running: room.running, 
          mutedRoleIds: room.mutedRoleIds,
          turnIndex: room.turnIndex, 
          name: room.config.name, 
          templateId: room.config.templateId 
        });
      });
    });

    fastify.log.info(`Server successfully started on port ${env.PORT}`);
  } catch (err) {
    fastify.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

