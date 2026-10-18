// SPDX-License-Identifier: GPL-3.0-or-later
// Semantically identical to Director src/shared/control-surface.ts; operator-control API version 1.
import { z } from "zod";

const serviceIdSchema = z.enum(["youtubeChat", "chatAgent", "spectator"]);

export const controlCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("run.preflight") }).strict(),
  z.object({ command: z.literal("run.start") }).strict(),
  z.object({ command: z.literal("run.pause") }).strict(),
  z.object({ command: z.literal("run.resume") }).strict(),
  z.object({ command: z.literal("run.stop") }).strict(),
  z.object({ command: z.literal("run.allStop") }).strict(),
  z.object({ command: z.literal("obs.setScene"), args: z.object({ scene: z.string().min(1).max(200) }).strict() }).strict(),
  z.object({ command: z.literal("obs.setStream"), args: z.object({ enabled: z.boolean() }).strict() }).strict(),
  z.object({ command: z.literal("obs.setRecord"), args: z.object({ enabled: z.boolean() }).strict() }).strict(),
  z.object({ command: z.literal("service.start"), args: z.object({ id: serviceIdSchema }).strict() }).strict(),
  z.object({ command: z.literal("service.stop"), args: z.object({ id: serviceIdSchema }).strict() }).strict(),
  z.object({ command: z.literal("service.restart"), args: z.object({ id: z.literal("spectator") }).strict() }).strict(),
  z.object({ command: z.literal("coverage.setFocusWeight"), args: z.object({ weight: z.number().min(0).max(1) }).strict() }).strict(),
  z.object({ command: z.literal("coverage.adjustFocusWeight"), args: z.object({ delta: z.number().min(-1).max(1) }).strict() }).strict(),
]);
export type ControlCommand = z.infer<typeof controlCommandSchema>;

export const controlCommandIds = [
  "run.preflight",
  "run.start",
  "run.pause",
  "run.resume",
  "run.stop",
  "run.allStop",
  "obs.setScene",
  "obs.setStream",
  "obs.setRecord",
  "service.start",
  "service.stop",
  "service.restart",
  "coverage.setFocusWeight",
  "coverage.adjustFocusWeight",
] as const;
export const CONTROL_COMMAND_IDS = controlCommandIds;
export const CONTROL_SERVICE_IDS = ["youtubeChat", "chatAgent", "spectator"] as const;

export const controlServiceIdSchema = serviceIdSchema;
export const controlStateSchema = z.object({
  api: z.literal(1),
  run: z.object({
    available: z.boolean(),
    live: z.boolean(),
    paused: z.boolean(),
    held: z.boolean(),
    allStopHold: z.boolean(),
    holdReason: z.string().nullable(),
    preflightCurrent: z.boolean(),
    admit: z.boolean(),
    admitReason: z.string().nullable(),
    lastPreflightOk: z.boolean().nullable(),
    runId: z.string().nullable(),
  }).strict(),
  obs: z.object({
    connected: z.boolean(),
    programScene: z.string().nullable(),
    scenes: z.array(z.string()),
    liveScenes: z.array(z.string()),
    streaming: z.boolean().nullable(),
    recording: z.boolean().nullable(),
  }).strict(),
  /** Operator coverage controls (ADR 0023 amendment): focus-driver weight 0..1 and camera-steer profile. */
  coverage: z.object({
    focusWeight: z.number().min(0).max(1),
    profile: z.enum(["balanced", "prefer_off_board"]),
  }).strict(),
  services: z.array(z.object({
    id: serviceIdSchema,
    label: z.string(),
    state: z.enum(["stopped", "starting", "running", "error", "unavailable"]),
    detail: z.string().nullable(),
    canStart: z.boolean(),
    canStop: z.boolean(),
  }).strict()),
}).strict();
export type ControlState = z.infer<typeof controlStateSchema>;

export const controlSurfacePairRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(64),
}).strict();
