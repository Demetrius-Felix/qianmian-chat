import { promises as fs } from "node:fs";
import path from "node:path";
import type { RoomRuntime } from "./index.js";

const DATA_DIR = path.resolve(import.meta.dirname ?? __dirname, "data", "rooms");

function safeRoomPath(roomId: string): string {
  // 防止路径遍历攻击
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function saveRoom(room: RoomRuntime): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const filePath = safeRoomPath(room.id);
    const data = serializeRoom(room);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`[Storage] Failed to save room ${room.id}:`, err);
  }
}

export async function loadAllRooms(): Promise<Map<string, RoomRuntime>> {
  const rooms = new Map<string, RoomRuntime>();
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const files = await fs.readdir(DATA_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const filePath = path.join(DATA_DIR, file);
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        const room = deserializeRoom(data);
        if (room) rooms.set(room.id, room);
      } catch (err) {
        console.error(`[Storage] Failed to load ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("[Storage] Failed to load rooms:", err);
  }
  return rooms;
}

export async function deleteRoomFile(roomId: string): Promise<void> {
  try {
    const filePath = safeRoomPath(roomId);
    await fs.unlink(filePath);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error(`[Storage] Failed to delete room file ${roomId}:`, err);
    }
  }
}

// ===== 序列化/反序列化（处理无法直接 JSON 序列化的字段）=====

type SerializableRoom = Omit<RoomRuntime, "streamAbort" | "loopToken">;

function serializeRoom(room: RoomRuntime): SerializableRoom {
  // 只保留可序列化的字段
  return {
    id: room.id,
    config: room.config,
    messages: room.messages,
    summary: room.summary,
    relationships: room.relationships,
    crossMemory: room.crossMemory,
    interruptQueue: room.interruptQueue,
    running: false, // 恢复后初始化为未运行
    mutedRoleIds: room.mutedRoleIds,
    mentionRoleIds: room.mentionRoleIds,
    turnIndex: room.turnIndex,
    lastSpeakerRoleId: room.lastSpeakerRoleId,
  } as SerializableRoom as RoomRuntime;
}

function deserializeRoom(data: any): RoomRuntime | null {
  if (!data || !data.id || !data.config) return null;
  return {
    id: data.id,
    config: data.config,
    messages: data.messages ?? [],
    summary: data.summary ?? "",
    relationships: data.relationships ?? {},
    crossMemory: data.crossMemory ?? {},
    roleEmotionTuning: data.roleEmotionTuning ?? {},
    interruptQueue: data.interruptQueue ?? [],
    running: false,
    mutedRoleIds: data.mutedRoleIds ?? [],
    mentionRoleIds: data.mentionRoleIds ?? [],
    turnIndex: data.turnIndex ?? 0,
    lastSpeakerRoleId: data.lastSpeakerRoleId,
    // 运行时字段，反序列化后重新初始化
    streamAbort: undefined,
    loopToken: undefined,
  } as RoomRuntime;
}