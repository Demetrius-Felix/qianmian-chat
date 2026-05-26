"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { RoleCard, RoomTemplateId } from "@qianmian/shared";
import { fetchHistory, fetchRoles, type HistoryRoom } from "@/lib/api";
import { getSocket } from "@/lib/socket";

const TEMPLATE_LABEL: Record<RoomTemplateId, string> = {
  emotional: "情感陪伴",
  group: "群聊模拟",
  task: "现实任务",
};

const TEMPLATE_ICON: Record<RoomTemplateId, string> = {
  emotional: "💖",
  group: "👥",
  task: "🛠️",
};

const TEMPLATE_CONSTRAINTS: Record<RoomTemplateId, { min: number; max: number; label: string }> = {
  emotional: { min: 1, max: 2, label: "1-2 个角色" },
  group: { min: 2, max: 10, label: "2-10 个角色" },
  task: { min: 1, max: 1, label: "1 个角色" },
};

type CreateRoomAck =
  | { ok: true; room: { id: string } }
  | { ok: false; error?: unknown };

export default function HomePage() {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<RoomTemplateId>("group");
  const [roomName, setRoomName] = useState("千面聊天室");
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [history, setHistory] = useState<HistoryRoom[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const selectedRoleIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  function loadHistory() {
    setHistoryLoading(true);
    fetchHistory()
      .then(setHistory)
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }

  function loadRoles() {
    let cancelled = false;
    setError(null);
    setRolesLoading(true);
    fetchRoles(templateId)
      .then((list) => {
        if (cancelled) return;
        setRoles(list);
        const next: Record<string, boolean> = {};
        // 自动选中前 3 个
        for (const r of list.slice(0, 3)) next[r.id] = true;
        setSelected(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "获取角色失败";
        setError(`${msg} (请确认后端服务在 8787 端口运行)`);
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    loadHistory();
    return loadRoles();
  }, [templateId]);

  // 当模板切换时，如果当前选择不符合新模板约束，清空选择
  useEffect(() => {
    const constraint = TEMPLATE_CONSTRAINTS[templateId];
    if (selectedRoleIds.length > constraint.max) {
      setSelected({});
    }
  }, [templateId]);

  async function onCreateRoom() {
    setError(null);
    if (!roomName.trim()) return setError("房间名不能为空");
    
    const constraint = TEMPLATE_CONSTRAINTS[templateId];
    if (selectedRoleIds.length < constraint.min || selectedRoleIds.length > constraint.max) {
      return setError(`当前模式请选择 ${constraint.label}`);
    }

    setLoading(true);
    try {
      const socket = getSocket();
      const res = await new Promise<CreateRoomAck>((resolve) => {
        socket.emit(
          "room.create",
          { name: roomName.trim(), templateId, selectedRoleIds },
          (ack: unknown) => resolve((ack ?? { ok: false }) as CreateRoomAck),
        );
      });
      if (!res?.ok) {
        const msg =
          typeof (res as { error?: unknown }).error === "string"
            ? String((res as { error?: unknown }).error)
            : "创建房间失败";
        throw new Error(msg);
      }
      const roomId = res.room.id;
      router.push(`/room/${encodeURIComponent(roomId)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "创建房间失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">千面聊天</h1>
          <p className="mt-2 text-sm text-zinc-600">
            选择房间类型与角色，让他们用中文自动对话；你可以随时插话。
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 左侧：历史对话入口 */}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">历史对话</h2>
              <button onClick={loadHistory} className="text-xs text-zinc-500 hover:text-zinc-900">刷新</button>
            </div>
            <div className="mt-4 space-y-3">
              {historyLoading ? (
                <div className="py-10 text-center text-sm text-zinc-400">加载中...</div>
              ) : history.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-400 italic">暂无历史记录</div>
              ) : (
                history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => router.push(`/room/${encodeURIComponent(h.id)}`)}
                    className="group w-full rounded-xl border border-zinc-100 p-3 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs">{TEMPLATE_ICON[h.templateId]}</span>
                        <div className="truncate text-sm font-medium">{h.name}</div>
                      </div>
                      <span className="shrink-0 text-[10px] text-zinc-400 group-hover:text-zinc-600">
                        {new Date(h.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-zinc-500">{h.lastMessage}</div>
                  </button>
                ))
              )}
            </div>
          </section>

          {/* 中间：创建房间 */}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-200">
            <h2 className="text-lg font-semibold">创建房间</h2>
            <div className="mt-4 space-y-4">
              <label className="block">
                <div className="text-sm font-medium text-zinc-700">房间名（中文）</div>
                <input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
                  placeholder="请输入房间名"
                />
              </label>

              <label className="block">
                <div className="text-sm font-medium text-zinc-700">房间类型</div>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value as RoomTemplateId)}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
                >
                  {Object.entries(TEMPLATE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={onCreateRoom}
                disabled={loading}
                className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {loading ? "创建中..." : "创建并进入房间"}
              </button>

              {error ? <div className="text-sm text-red-600">{error}</div> : null}
            </div>
          </section>

          {/* 右侧：选择角色 */}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">选择角色（{TEMPLATE_CONSTRAINTS[templateId].label}）</h2>
              <button
                onClick={() => loadRoles()}
                className="text-xs text-zinc-500 hover:text-zinc-900"
              >
                刷新
              </button>
            </div>
            <p className="mt-1 text-xs text-zinc-600">当前已选：{selectedRoleIds.length} 个</p>
            <div className="mt-4 grid gap-3">
              {rolesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex animate-pulse items-start gap-3 rounded-xl border border-zinc-100 p-3">
                    <div className="h-5 w-5 rounded bg-zinc-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/2 rounded bg-zinc-100" />
                      <div className="h-3 w-full rounded bg-zinc-100" />
                    </div>
                  </div>
                ))
              ) : roles.length === 0 ? (
                <div className="py-10 text-center text-sm text-zinc-500">
                  {error ? `加载失败: ${error}` : "未找到角色，请检查服务器是否已启动。"}
                </div>
              ) : (
                roles.map((r) => (
                  <label
                    key={r.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${
                      selected[r.id]
                        ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                        : "border-zinc-200 bg-white hover:border-zinc-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[r.id]}
                      onChange={(e) =>
                        setSelected((s: Record<string, boolean>) => ({ ...s, [r.id]: e.target.checked }))
                      }
                      className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{r.avatar || "👤"}</span>
                        <div className="truncate text-sm font-semibold">{r.name}</div>
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs text-zinc-600">{r.identity}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </section>
        </div>

        <footer className="mt-10 text-xs text-zinc-500">
          提示：默认先用“模拟流式”跑通体验；设置模型环境变量后会自动切换为真实大模型流式输出。
        </footer>
      </div>
    </div>
  );
}
