import { z } from "zod";
export const RoomTemplateIdSchema = z.enum(["casual", "realistic", "task"]);
export const InterruptTypeSchema = z.enum([
    "ask",
    "correct",
    "add_constraint",
    "add_setting",
    "change_goal",
    "stop",
]);
export const RoleCardSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    avatar: z.string().min(1).optional(),
    templateId: RoomTemplateIdSchema,
    identity: z.string().min(1),
    voice: z
        .object({
        tags: z.array(z.string().min(1)).default([]),
        examples: z.array(z.string().min(1)).max(3).default([]),
    })
        .default({ tags: [], examples: [] }),
    dos: z.array(z.string().min(1)).default([]),
    donts: z.array(z.string().min(1)).default([]),
    format: z.string().min(1).optional(),
    skills: z.array(z.string().min(1)).default([]),
    parameters: z
        .object({
        temperature: z.number().min(0).max(2).optional(),
        top_p: z.number().min(0).max(1).optional(),
        max_tokens: z.number().int().min(16).max(2048).optional(),
    })
        .default({}),
});
export const RoomConfigSchema = z.object({
    name: z
        .string()
        .min(1, "房间名不能为空")
        .max(30, "房间名最多 30 个字"),
    templateId: RoomTemplateIdSchema,
    selectedRoleIds: z.array(z.string().min(1)).min(2),
    activeRoleIds: z.array(z.string().min(1)).min(2),
    maxTurns: z.number().int().min(1).max(60),
    windowSize: z.number().int().min(5).max(50).default(20),
});
export const DirectorDecisionSchema = z.object({
    nextSpeaker: z.object({
        type: z.enum(["role", "host", "narrator"]),
        id: z.string().min(1).optional(),
    }),
    intent: z.enum([
        "respond",
        "question",
        "challenge",
        "summarize",
        "transition",
        "clarify_interrupt",
        "handle_correction",
    ]),
    phase: z.string().min(1).default("free"),
    instruction: z.string().min(1),
    shouldStop: z.boolean(),
    stopReason: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
});
export const UserMessageInputSchema = z.object({
    roomId: z.string().min(1),
    content: z.string().min(1).max(1000),
    interruptType: InterruptTypeSchema.default("ask"),
});
export const CreateRoomInputSchema = z.object({
    name: RoomConfigSchema.shape.name,
    templateId: RoomTemplateIdSchema,
    selectedRoleIds: z.array(z.string().min(1)).min(2),
});
