"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { InterruptType, RoleCard, RoomTemplateId } from "@qianmian/shared";
import { getSocket } from "@/lib/socket";
import { useRoomStore, type ChatMessage } from "@/lib/store";

const INTERRUPT_LABEL: Record<InterruptType, string> = {
  ask: "普通插话",
  correct: "纠错/反驳",
  add_constraint: "新增约束",
  add_setting: "新增设定",
  change_goal: "改目标",
  mute_roles: "禁言/解除",
  stop: "停止",
};

type InteractionCategory = "chat" | "modify" | "mute" | "stop";

const CATEGORY_LABELS: Record<InteractionCategory, { label: string; icon: string }> = {
  chat: { label: "插话", icon: "💬" },
  modify: { label: "对话修改", icon: "🛠️" },
  mute: { label: "禁言", icon: "🙊" },
  stop: { label: "停止", icon: "🛑" },
};

const MODIFY_SUB_TYPES: Array<{ label: string; type: InterruptType; icon: string }> = [
  { label: "提问", type: "ask", icon: "🙋" },
  { label: "纠错", type: "correct", icon: "❌" },
  { label: "改目标", type: "change_goal", icon: "🎯" },
  { label: "加设定", type: "add_setting", icon: "🎭" },
];

const DEFAULT_EMOTION_VECTOR: EmotionVector = {
  empathy: 68,
  calmness: 62,
  positivity: 58,
  rationality: 56,
  energy: 50,
};

const EMOTION_AXES: Array<{ key: keyof EmotionVector; label: string; hint: string }> = [
  { key: "empathy", label: "共情", hint: "先接住感受" },
  { key: "calmness", label: "冷静", hint: "情绪稳定度" },
  { key: "positivity", label: "积极", hint: "希望导向" },
  { key: "rationality", label: "理性", hint: "结构化分析" },
  { key: "energy", label: "能量", hint: "表达主动度" },
];

type RoomStateEvent = {
  roomId: string;
  running: boolean;
  mutedRoleIds?: string[];
  turnIndex: number;
  name?: string;
  templateId?: RoomTemplateId;
};

type RoomMessagesEvent = {
  roomId: string;
  messages: ChatMessage[];
};

type GenericAck = { ok: true } | { ok: false; error?: unknown };
type JoinRoomAck =
  | { 
      ok: true; 
      room: { 
        config?: { name?: string; templateId?: RoomTemplateId }; 
        running?: boolean; 
        mutedRoleIds?: string[];
        turnIndex?: number; 
        messages?: ChatMessage[];
        roles?: RoleCard[];
        roleEmotionTuning?: Record<string, EmotionVector>;
      } 
    }
  | { ok: false; error?: unknown };

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = decodeURIComponent(params.roomId);

  const { roomName, running, turnIndex, messages, pendingById, setRoom, setRunning, setMessages, startMessage, appendDelta, finalizeMessage } =
    useRoomStore();

  const [content, setContent] = useState("");
  const [activeCategory, setActiveCategory] = useState<InteractionCategory>("chat");
  const [interruptType, setInterruptType] = useState<InterruptType>("ask");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [mutedRoleIds, setMutedRoleIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [selectedRoleIdsForAction, setSelectedRoleIdsForAction] = useState<string[]>([]);
  const [showMentionPanel, setShowMentionPanel] = useState(false);
  const [templateId, setTemplateId] = useState<RoomTemplateId>("group");
  const [roleEmotionTuning, setRoleEmotionTuning] = useState<Record<string, EmotionVector>>({});
  const [activeEmotionRoleId, setActiveEmotionRoleId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const socket = useMemo(() => getSocket(), []);

  useEffect(() => {
    // 监听分类变化，自动设置默认子类型
    if (activeCategory === "chat") setInterruptType("ask");
    else if (activeCategory === "mute") setInterruptType("mute_roles");
    else if (activeCategory === "stop") setInterruptType("stop");
    else if (activeCategory === "modify") {
      // 保持之前的子类型，或者默认设为 ask (提问)
      if (!MODIFY_SUB_TYPES.some(t => t.type === interruptType)) {
        setInterruptType("ask");
      }
    }
  }, [activeCategory]);

  useEffect(() => {
    setError(null);

    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
    }

    function onRoomState(s: unknown) {
      const e = s as Partial<RoomStateEvent> | null;
      if (!e?.roomId || e.roomId !== roomId) return;
      setRoom({ roomId, roomName: e.name ?? roomName ?? "" });
      setRunning(!!e.running, e.turnIndex);
      if (e.mutedRoleIds !== undefined) setMutedRoleIds(e.mutedRoleIds);
      if (e.templateId) setTemplateId(e.templateId);
    }

    function onRoomMessages(payload: unknown) {
      const e = payload as Partial<RoomMessagesEvent> | null;
      if (e?.roomId !== roomId) return;
      setMessages((e.messages ?? []) as ChatMessage[]);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }

    function onRoomEmotionState(payload: unknown) {
      const e = payload as Partial<RoomEmotionStateEvent> | null;
      if (e?.roomId !== roomId || !e.roleEmotionTuning) return;
      setRoleEmotionTuning(e.roleEmotionTuning);
    }

    function onMessageStart(m: ChatMessage) {
      if (m.roomId !== roomId) return;
      startMessage(m);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }

    function onMessageDelta(p: unknown) {
      const e = p as Partial<{ roomId: string; messageId: string; delta: string }> | null;
      if (e?.roomId !== roomId) return;
      if (!e.messageId) return;
      appendDelta(e.messageId, e.delta ?? "");
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }

    function onMessageDone(m: ChatMessage) {
      if (m.roomId !== roomId) return;
      finalizeMessage(m);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }

    function onError(p: unknown) {
      const e = p as Partial<{ roomId: string; message: string }> | null;
      if (e?.roomId && e.roomId !== roomId) return;
      setError(e?.message ?? "发生错误");
    }

    socket.on("room.state", onRoomState);
    socket.on("room.messages", onRoomMessages);
    socket.on("room.emotion.state", onRoomEmotionState);
    socket.on("message.start", onMessageStart);
    socket.on("message.delta", onMessageDelta);
    socket.on("message.done", onMessageDone);
    socket.on("error", onError);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.emit("room.join", { roomId }, (ack: unknown) => {
      const res = (ack ?? { ok: false }) as JoinRoomAck;
      if (!res?.ok) setError(typeof res.error === "string" ? res.error : "加入房间失败");
      else {
        setRoom({ roomId, roomName: res.room?.config?.name ?? "" });
        setRunning(!!res.room?.running, res.room?.turnIndex ?? 0);
        setMessages((res.room?.messages ?? []) as ChatMessage[]);
        if (res.room?.mutedRoleIds !== undefined) setMutedRoleIds(res.room.mutedRoleIds);
        if (res.room?.config?.templateId) setTemplateId(res.room.config.templateId);
        if (res.room?.roles) {
          setRoles(res.room.roles);
          if (!activeEmotionRoleId) setActiveEmotionRoleId(res.room.roles[0]?.id ?? null);
        }
        if (res.room?.roleEmotionTuning) setRoleEmotionTuning(res.room.roleEmotionTuning);
        queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
      }
    });

    return () => {
      socket.off("room.state", onRoomState);
      socket.off("room.messages", onRoomMessages);
      socket.off("room.emotion.state", onRoomEmotionState);
      socket.off("message.start", onMessageStart);
      socket.off("message.delta", onMessageDelta);
      socket.off("message.done", onMessageDone);
      socket.off("error", onError);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, socket]);

  useEffect(() => {
    if (!roles.length) return;
    if (!activeEmotionRoleId || !roles.some((r) => r.id === activeEmotionRoleId)) {
      setActiveEmotionRoleId(roles[0]!.id);
    }
  }, [roles, activeEmotionRoleId]);

  async function sendUserMessage() {
    setError(null);
    const text = content.trim();
    if (!text) return;

    if (interruptType === "mute_roles") {
      if (selectedRoleIdsForAction.length === 0) return setError("请先选择要禁言/解除的角色");
      // 逻辑：如果选中的人都在禁言列表里，则解除；否则全部禁言
      const allMuted = selectedRoleIdsForAction.every(id => mutedRoleIds.includes(id));
      socket.emit("room.mute", { roomId, roleIds: selectedRoleIdsForAction, muted: !allMuted });
      setSelectedRoleIdsForAction([]);
      setContent("");
      return;
    }

    setContent("");
    const mentionRoleIds = selectedRoleIdsForAction;
    setSelectedRoleIdsForAction([]); 
    setShowMentionPanel(false);

    socket.emit("user.message", { roomId, content: text, interruptType, mentionRoleIds }, (ack: unknown) => {
      const res = (ack ?? { ok: false }) as GenericAck;
      if (!res?.ok) setError(typeof res.error === "string" ? res.error : "发送失败");
    });

    if (interruptType === "stop") {
      socket.emit("room.stop", { roomId });
    }
  }

  async function sendAndStart() {
    await sendUserMessage();
    if (interruptType !== "stop" && interruptType !== "mute_roles" && !running) startAuto();
  }

  function startAuto() {
    setError(null);
    socket.emit("room.start", { roomId }, (ack: unknown) => {
      const res = (ack ?? { ok: false }) as GenericAck;
      if (!res?.ok) setError(typeof res.error === "string" ? res.error : "启动失败");
    });
  }

  function stopAuto() {
    setError(null);
    socket.emit("room.stop", { roomId }, (ack: unknown) => {
      const res = (ack ?? { ok: false }) as GenericAck;
      if (!res?.ok) setError(typeof res.error === "string" ? res.error : "停止失败");
    });
  }

  function toggleRoleSelection(roleId: string) {
    setSelectedRoleIdsForAction((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  }

  function onTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setContent(val);
    
    // 检查最后输入的字符是否为 @
    const lastChar = val.slice(-1);
    if (lastChar === "@") {
      setShowMentionPanel(true);
    } else if (showMentionPanel && !val.includes("@")) {
      setShowMentionPanel(false);
    }
  }

  const activeEmotionRole = roles.find((r) => r.id === activeEmotionRoleId) ?? roles[0] ?? null;
  const activeEmotionVector = activeEmotionRole
    ? (roleEmotionTuning[activeEmotionRole.id] ?? DEFAULT_EMOTION_VECTOR)
    : DEFAULT_EMOTION_VECTOR;

  const radarPoints = EMOTION_AXES.map((axis, idx) => {
    const angle = (-Math.PI / 2) + (idx * 2 * Math.PI) / EMOTION_AXES.length;
    const ratio = (activeEmotionVector[axis.key] ?? 0) / 100;
    const radius = 70 * ratio;
    const x = 85 + Math.cos(angle) * radius;
    const y = 85 + Math.sin(angle) * radius;
    return `${x},${y}`;
  }).join(" ");

  function updateEmotionAxis(axis: keyof EmotionVector, value: number) {
    if (!activeEmotionRole) return;
    const safe = Math.max(0, Math.min(100, Math.round(value)));
    const patch: Partial<EmotionVector> = { [axis]: safe };

    setRoleEmotionTuning((prev) => ({
      ...prev,
      [activeEmotionRole.id]: {
        ...(prev[activeEmotionRole.id] ?? DEFAULT_EMOTION_VECTOR),
        [axis]: safe,
      },
    }));

    socket.emit("room.emotion.update", { roomId, roleId: activeEmotionRole.id, patch });
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={() => router.push("/")}
              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
            >
              ← 返回
            </button>
            <h1 className="mt-1 truncate text-xl font-semibold">{roomName || "房间"}</h1>
            <div className="mt-1 text-xs text-zinc-600">
              状态：{running ? "自动对话中" : "已暂停"} · 回合：{turnIndex} · 连接：
              <span className={connected ? "text-emerald-700" : "text-red-700"}>{connected ? "已连接" : "已断开"}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={startAuto}
              disabled={running}
              className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              开始
            </button>
            <button
              onClick={stopAuto}
              disabled={!running}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-50"
            >
              暂停
            </button>
          </div>
        </header>

        {roles.length > 0 ? (
          <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-800">情感调节面板</h2>
                <p className="text-xs text-zinc-500">可视化调节角色共情/冷静/积极等状态（实时生效）</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setActiveEmotionRoleId(role.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      activeEmotionRole?.id === role.id
                        ? "bg-zinc-900 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {role.avatar} {role.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <div className="space-y-3">
                {EMOTION_AXES.map((axis) => {
                  const value = activeEmotionVector[axis.key] ?? 0;
                  return (
                    <div key={axis.key}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-zinc-700">{axis.label}</span>
                        <span className="text-zinc-500">{value} · {axis.hint}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={value}
                        onChange={(e) => updateEmotionAxis(axis.key, Number(e.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-center">
                <svg width="170" height="170" viewBox="0 0 170 170" className="overflow-visible">
                  {[1, 2, 3, 4].map((layer) => {
                    const r = (70 * layer) / 4;
                    const points = EMOTION_AXES.map((_, idx) => {
                      const angle = (-Math.PI / 2) + (idx * 2 * Math.PI) / EMOTION_AXES.length;
                      const x = 85 + Math.cos(angle) * r;
                      const y = 85 + Math.sin(angle) * r;
                      return `${x},${y}`;
                    }).join(" ");
                    return <polygon key={layer} points={points} fill="none" stroke="#e4e4e7" strokeWidth="1" />;
                  })}

                  {EMOTION_AXES.map((axis, idx) => {
                    const angle = (-Math.PI / 2) + (idx * 2 * Math.PI) / EMOTION_AXES.length;
                    const x = 85 + Math.cos(angle) * 76;
                    const y = 85 + Math.sin(angle) * 76;
                    return (
                      <g key={axis.key}>
                        <line x1="85" y1="85" x2={x} y2={y} stroke="#d4d4d8" strokeWidth="1" />
                        <text x={85 + Math.cos(angle) * 88} y={85 + Math.sin(angle) * 88} textAnchor="middle" className="fill-zinc-500 text-[10px]">
                          {axis.label}
                        </text>
                      </g>
                    );
                  })}

                  <polygon points={radarPoints} fill="rgba(24,24,27,0.18)" stroke="#18181b" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        ) : null}

        <div
          ref={listRef}
          className="flex-1 overflow-auto rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200"
        >
          {messages.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-500">
              还没有消息。点击右上角“开始”，或先在下方插话。
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-3 ${m.speakerType === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`mt-0.5 h-8 w-8 shrink-0 rounded-full text-center text-xs leading-8 shadow-sm ${
                    m.speakerType === "user" 
                      ? "bg-zinc-900 text-white" 
                      : m.speakerType === "narrator" || m.speakerType === "host"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-zinc-100 text-zinc-700"
                  }`}>
                    {m.speakerName.slice(0, 1)}
                  </div>
                  <div className={`min-w-0 flex-1 ${m.speakerType === "user" ? "text-right" : ""}`}>
                    <div className={`flex items-center gap-2 ${m.speakerType === "user" ? "flex-row-reverse" : ""}`}>
                      <div className="text-sm font-semibold">{m.speakerName}</div>
                      <div className="text-[11px] text-zinc-500">
                        {new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      {pendingById[m.id] ? (
                        <div className="animate-pulse text-[11px] font-medium text-amber-600">思考中…</div>
                      ) : null}
                    </div>
                    <div className={`mt-1 inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm leading-6 shadow-sm ${
                      m.speakerType === "user"
                        ? "bg-zinc-900 text-white rounded-tr-none"
                        : m.speakerType === "narrator" || m.speakerType === "host"
                          ? "bg-amber-50 text-amber-900 ring-1 ring-amber-100 rounded-tl-none italic"
                          : "bg-zinc-100 text-zinc-900 rounded-tl-none"
                    }`}>
                      {m.content}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200">
          <div className="mb-4 space-y-3">
            {/* 顶级分类选择 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-3">
              {(Object.entries(CATEGORY_LABELS) as [InteractionCategory, { label: string; icon: string }][]).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => {
                    setActiveCategory(key);
                    setSelectedRoleIdsForAction([]);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                    activeCategory === key
                      ? "bg-zinc-900 text-white shadow-md scale-105"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <span>{value.icon}</span>
                  <span>{value.label}</span>
                </button>
              ))}
            </div>

            {/* 对话修改子选项 */}
            {activeCategory === "modify" && (
              <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">
                  选择修改方式:
                </span>
                {MODIFY_SUB_TYPES.map((q) => (
                  <button
                    key={q.type}
                    onClick={() => setInterruptType(q.type)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      interruptType === q.type
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                    }`}
                  >
                    <span>{q.icon}</span>
                    <span>{q.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* 禁言/提到的角色选择面板 */}
            {(activeCategory === "mute" || showMentionPanel) && roles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">
                  {activeCategory === "mute" ? "选择禁言对象:" : "@ 指定角色:"}
                </span>
                {roles.map((r) => {
                  const isMuted = mutedRoleIds.includes(r.id);
                  const isSelected = selectedRoleIdsForAction.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => toggleRoleSelection(r.id)}
                      className={`rounded-full px-2 py-1 text-[11px] font-medium transition-all ${
                        isSelected
                          ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200"
                          : isMuted
                            ? "bg-red-50 text-red-400 opacity-60"
                            : "bg-zinc-50 text-zinc-500 hover:bg-zinc-100"
                      }`}
                    >
                      {r.avatar} {r.name} {isMuted && "(已禁言)"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <div className="text-sm font-medium text-zinc-700">
                {activeCategory === "chat" ? "你的话 (插话)" : 
                 activeCategory === "modify" ? `修改建议 (${INTERRUPT_LABEL[interruptType]})` :
                 activeCategory === "mute" ? "禁言备注 (可选)" : "停止理由 (可选)"}
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={onTextareaChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                      return;
                    }
                    e.preventDefault();
                    void sendAndStart();
                  }
                }}
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 outline-none focus:border-zinc-400"
                placeholder={
                  activeCategory === "mute"
                    ? "选中角色后，点击发送执行禁言/解除"
                    : activeCategory === "stop"
                    ? "输入停止理由，点击发送终止对话"
                    : "Enter 发送；Ctrl/⌘ + Enter 换行；输入 @ 选择角色"
                }
              />
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => void sendUserMessage()}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                仅发送
              </button>
              <button
                onClick={() => void sendAndStart()}
                className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                发送并开始
              </button>
            </div>
          </div>
          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}

