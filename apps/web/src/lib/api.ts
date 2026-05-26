import type { RoleCard, RoomTemplateId } from "@qianmian/shared";
import { SERVER_URL } from "./config";

export async function fetchRoles(templateId?: RoomTemplateId): Promise<RoleCard[]> {
  const url = templateId
    ? `${SERVER_URL}/roles?templateId=${encodeURIComponent(templateId)}`
    : `${SERVER_URL}/roles`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`获取角色失败：${res.status}`);
  return (await res.json()) as RoleCard[];
}

export type HistoryRoom = {
  id: string;
  name: string;
  templateId: RoomTemplateId;
  lastMessage: string;
  messageCount: number;
  createdAt: number;
};

export async function fetchHistory(): Promise<HistoryRoom[]> {
  const res = await fetch(`${SERVER_URL}/rooms/history`, { cache: "no-store" });
  if (!res.ok) throw new Error("获取历史对话失败");
  return res.json();
}

