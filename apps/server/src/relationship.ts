/**
 * 角色与用户的关系/性格演化模块
 *
 * 原理：
 * - 每次角色发言后，根据其发言内容分析对话的情绪/亲密度影响
 * - 更新 intimacy（亲密度 0-100）
 * - 动态演化 dynamicTrait（性格标签）
 * - 记录关键 memo（长期记忆点）
 */

import type { RoomRuntime } from "./index.js";

// 简单关键词评分（无 LLM 时的 fallback 实现）
function analyzeIntimacyDelta(content: string): number {
  const positiveWords = [
    "喜欢", "感谢", "真好", "太棒了", "开心", "同意", "没错",
    "好主意", "佩服", "厉害", "支持", "理解", "谢谢", "爱",
    "温暖", "感动", "信任", "放心", "安心", "赞", "棒",
  ];
  const negativeWords = [
    "不行", "反对", "讨厌", "生气", "无聊", "差劲", "不行",
    "错误", "有病", "糟糕", "烦", "差", "烂", "恶心",
    "失望", "伤心", "难过", "痛苦",
  ];
  let score = 0;
  for (const w of positiveWords) {
    if (content.includes(w)) score += 1.5;
  }
  for (const w of negativeWords) {
    if (content.includes(w)) score -= 2;
  }
  // 限制范围
  return Math.max(-5, Math.min(5, score));
}

// fallback 性格演化
function evolveTrait(currentTrait: string, delta: number): string {
  if (delta > 2) return "热情开朗";
  if (delta < -2) return "冷淡疏离";
  return currentTrait;
}

// fallback 提取记忆
function extractMemo(content: string): string {
  const sentences = content.split(/[。！？\n]/).filter(Boolean);
  // 取前两句
  return sentences.slice(0, 2).join("；").trim();
}

/**
 * 当角色说完一句话后，更新角色与用户之间的关系
 */
export function evolveRelationship(room: RoomRuntime, roleId: string, content: string): void {
  if (!content.trim()) return;

  // 初始化该角色的关系记录
  if (!room.relationships[roleId]) {
    room.relationships[roleId] = {
      intimacy: 50,
      dynamicTrait: "中立友好",
      memo: "",
    };
  }

  const record = room.relationships[roleId]!;

  // 1. 分析亲密度变化
  const delta = analyzeIntimacyDelta(content);
  record.intimacy = Math.max(0, Math.min(100, record.intimacy + delta));

  // 2. 演化性格标签
  record.dynamicTrait = evolveTrait(record.dynamicTrait, delta);

  // 3. 提取记忆点（仅在内容有意义时更新）
  if (content.length > 5) {
    const newMemo = extractMemo(content);
    if (newMemo) {
      // 简单的记忆合并：如果 memo 已经包含新内容，则跳过
      if (!record.memo.includes(newMemo)) {
        // 只保留最近 3 条记忆
        const memos = record.memo ? record.memo.split(" | ") : [];
        memos.push(newMemo);
        if (memos.length > 3) memos.shift();
        record.memo = memos.join(" | ");
      }
    }
  }
}

/**
 * 群聊模式下：当角色 A 发言后，更新角色 A 对其他角色的记忆
 */
export function evolveCrossMemory(
  room: RoomRuntime,
  speakerRoleId: string,
  allRoles: { id: string; name: string }[],
  recentMessages: { speakerId?: string; speakerName: string; content: string }[],
): void {
  if (room.config.templateId !== "group") return;

  // 初始化 speaker 的跨角色记忆
  if (!room.crossMemory[speakerRoleId]) {
    room.crossMemory[speakerRoleId] = {};
  }

  // 从最近的消息中提取其他角色的关键信息
  for (const msg of recentMessages) {
    if (!msg.speakerId) continue;
    if (msg.speakerId === speakerRoleId) continue;

    // 检查发言中是否提到了另一个角色（用名字匹配）
    const otherRole = allRoles.find(
      (r) => r.id === msg.speakerId || msg.content.includes(r.name),
    );
    if (!otherRole) continue;

    // 为当前角色记录关于另一个角色的记忆
    if (!room.crossMemory[speakerRoleId]![otherRole.id]) {
      room.crossMemory[speakerRoleId]![otherRole.id] = [];
    }

    const memoryList = room.crossMemory[speakerRoleId]![otherRole.id]!;

    // 提取此消息中的关键信息作为记忆
    const entry = {
      content: `关于 ${otherRole.name}：${msg.speakerName} 说过 "${msg.content}"`,
      createdAt: Date.now(),
    };

    // 防止重复记忆
    const isDuplicate = memoryList.some(
      (e) => e.content === entry.content,
    );
    if (!isDuplicate) {
      memoryList.push(entry);
      // 只保留最近 5 条记忆
      if (memoryList.length > 5) {
        memoryList.splice(0, memoryList.length - 5);
      }
    }
  }
}

/**
 * 构建跨角色记忆的提示词上下文
 */
export function buildCrossMemoryContext(
  room: RoomRuntime,
  roleId: string,
): string {
  if (room.config.templateId !== "group") return "";

  const myMemory = room.crossMemory[roleId];
  if (!myMemory) return "";

  const lines: string[] = [];
  for (const [targetId, entries] of Object.entries(myMemory)) {
    if (entries.length === 0) continue;
    lines.push(`— 关于${entries[0]!.content.split("关于")[1]?.split("：")[0] ?? "其他角色"}的记忆：`);
    for (const e of entries.slice(-3)) {
      lines.push(`  ${e.content}`);
    }
  }

  if (lines.length === 0) return "";

  lines.unshift("【跨角色记忆】");
  lines.push("在回答时，如果能自然引用对这些角色的记忆，会让对话更真实。");
  return lines.join("\n");
}