import { create } from "zustand";

export type ChatMessage = {
  id: string;
  roomId: string;
  speakerType: "user" | "role" | "host" | "narrator" | "system";
  speakerId?: string;
  speakerName: string;
  content: string;
  createdAt: number;
  meta?: Record<string, unknown>;
};

type RoomState = {
  roomId: string | null;
  roomName: string;
  running: boolean;
  turnIndex: number;
  messages: ChatMessage[];
  pendingById: Record<string, boolean>;
  setRoom: (p: { roomId: string; roomName: string }) => void;
  setRunning: (running: boolean, turnIndex?: number) => void;
  setMessages: (messages: ChatMessage[]) => void;
  startMessage: (m: ChatMessage) => void;
  appendDelta: (messageId: string, delta: string) => void;
  finalizeMessage: (m: ChatMessage) => void;
  reset: () => void;
};

export const useRoomStore = create<RoomState>((set) => ({
  roomId: null,
  roomName: "",
  running: false,
  turnIndex: 0,
  messages: [],
  pendingById: {},
  setRoom: ({ roomId, roomName }) => set({ roomId, roomName }),
  setRunning: (running, turnIndex) =>
    set((s) => ({ running, turnIndex: turnIndex ?? s.turnIndex })),
  setMessages: (messages) => set({ messages }),
  startMessage: (m) =>
    set((s) => ({
      messages: [...s.messages, m],
      pendingById: { ...s.pendingById, [m.id]: true },
    })),
  appendDelta: (messageId, delta) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, content: m.content + delta } : m)),
    })),
  finalizeMessage: (m) =>
    set((s) => ({
      messages: s.messages.map((x) => (x.id === m.id ? m : x)),
      pendingById: { ...s.pendingById, [m.id]: false },
    })),
  reset: () =>
    set({
      roomId: null,
      roomName: "",
      running: false,
      turnIndex: 0,
      messages: [],
      pendingById: {},
    }),
}));

