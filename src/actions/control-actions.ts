// SPDX-License-Identifier: GPL-3.0-or-later
import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type PropertyInspectorDidAppearEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { InFlightLock } from "../action-runner";
import type { ControlState } from "../contract";
import { DirectorConnection, type ConnectionSnapshot } from "../connection";
import { HoldToFire } from "../hold";
import { render, resolveObsScene, type ActionId, type ActionSettings } from "../render";

type ActionData = ActionSettings;
type CommandAction = KeyDownEvent<ActionData>["action"];

abstract class ControlAction<TSettings extends ActionData = ActionData> extends SingletonAction<TSettings> {
  private readonly lock = new InFlightLock();
  private readonly holdByContext = new Map<string, HoldToFire>();
  private readonly restoreTimers = new Map<string, ReturnType<typeof setTimeout>>();

  protected constructor(
    protected readonly connection: DirectorConnection,
    protected readonly actionId: ActionId,
  ) {
    super();
    connection.onChange(snapshot => void this.refreshAll(snapshot));
  }

  override async onWillAppear(event: WillAppearEvent<TSettings>): Promise<void> {
    if (event.action.isKey()) await this.renderKey(event.action, event.payload.settings);
  }

  override async onDidReceiveSettings(event: DidReceiveSettingsEvent<TSettings>): Promise<void> {
    if (event.action.isKey()) await this.renderKey(event.action, event.payload.settings);
  }

  override onWillDisappear(event: WillDisappearEvent<TSettings>): void {
    this.holdByContext.delete(event.action.id);
    const timer = this.restoreTimers.get(event.action.id);
    if (timer) clearTimeout(timer);
    this.restoreTimers.delete(event.action.id);
  }

  protected async runCommand(
    action: CommandAction,
    command: () => Promise<unknown>,
    afterSuccess?: () => Promise<void>,
  ): Promise<void> {
    await this.lock.run(async () => {
      try {
        await command();
        if (action.isKey()) await action.showOk();
        await afterSuccess?.();
      } catch (error) {
        if (action.isKey()) await action.showAlert();
        await this.showReason(action, errorMessage(error));
      }
    });
  }

  protected holdDown(
    action: CommandAction,
    fire: () => Promise<unknown>,
    afterSuccess?: () => Promise<void>,
  ): void {
    let hold = this.holdByContext.get(action.id);
    if (!hold) {
      hold = new HoldToFire(
        () => void this.runCommand(action, fire, afterSuccess),
        () => void this.showTemporaryTitle(action, "HOLD"),
      );
      this.holdByContext.set(action.id, hold);
    }
    hold.keyDown();
  }

  protected holdUp(action: CommandAction): void {
    this.holdByContext.get(action.id)?.keyUp();
  }

  protected async showAlert(action: CommandAction, reason: string): Promise<void> {
    if (action.isKey()) await action.showAlert();
    await this.showReason(action, reason);
  }

  protected async currentState(): Promise<ControlState | null> {
    return this.connection.snapshot().state;
  }

  protected async refreshKey(action: CommandAction, settings?: TSettings): Promise<void> {
    const current = this.connection.snapshot();
    const actionSettings = settings ?? await action.getSettings() as TSettings;
    const output = render(this.actionId, current.connection, current.state, actionSettings);
    if (!action.isKey()) return;
    await action.setTitle(output.title);
    await action.setState(output.state);
    if (output.image) await action.setImage(output.image);
  }

  protected async showTemporaryTitle(action: CommandAction, title: string): Promise<void> {
    if (!action.isKey()) return;
    const oldTimer = this.restoreTimers.get(action.id);
    if (oldTimer) clearTimeout(oldTimer);
    await action.setTitle(title);
    this.restoreTimers.set(action.id, setTimeout(() => {
      this.restoreTimers.delete(action.id);
      void this.refreshKey(action);
    }, 900));
  }

  private async showReason(action: CommandAction, reason: string): Promise<void> {
    const title = reason.toUpperCase().replace(/\s+/g, " ").slice(0, 16) || "ERROR";
    await this.showTemporaryTitle(action, title);
  }

  private async renderKey(action: CommandAction, settings?: TSettings): Promise<void> {
    await this.refreshKey(action, settings);
  }

  private async refreshAll(snapshot: ConnectionSnapshot): Promise<void> {
    for (const action of this.actions) {
      if (!action.isKey()) continue;
      const settings = await action.getSettings() as TSettings;
      const output = render(this.actionId, snapshot.connection, snapshot.state, settings);
      await action.setTitle(output.title);
      await action.setState(output.state);
      if (output.image) await action.setImage(output.image);
    }
  }
}

export class RunStatusAction extends ControlAction {
  override manifestId = "com.simracecenter.director.run-status";
  constructor(connection: DirectorConnection) {
    super(connection, "run-status");
  }
}

export class PreflightAction extends ControlAction {
  override manifestId = "com.simracecenter.director.preflight";
  constructor(connection: DirectorConnection) {
    super(connection, "preflight");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> {
    return this.runCommand(event.action, () => this.connection.command("run.preflight"));
  }
}

export class StartRunAction extends ControlAction {
  override manifestId = "com.simracecenter.director.start-run";
  constructor(connection: DirectorConnection) {
    super(connection, "start-run");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> {
    return this.runCommand(event.action, () => this.connection.command("run.start"));
  }
}

export class PauseResumeAction extends ControlAction {
  override manifestId = "com.simracecenter.director.pause-resume";
  constructor(connection: DirectorConnection) {
    super(connection, "pause-resume");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> | void {
    const state = this.connection.snapshot().state;
    if (!state?.run.paused && !state?.run.live) return;
    const command = state.run.paused ? "run.resume" : "run.pause";
    return this.runCommand(event.action, () => this.connection.command(command));
  }
}

export class StopRunAction extends ControlAction {
  override manifestId = "com.simracecenter.director.stop-run";
  constructor(connection: DirectorConnection) {
    super(connection, "stop-run");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): void {
    this.holdDown(event.action, () => this.connection.command("run.stop"));
  }
  override onKeyUp(event: KeyUpEvent<ActionData>): void {
    this.holdUp(event.action);
  }
}

export class AllStopAction extends ControlAction {
  override manifestId = "com.simracecenter.director.all-stop";
  constructor(connection: DirectorConnection) {
    super(connection, "all-stop");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): void {
    this.holdDown(event.action, () => this.connection.command("run.allStop"), async () => {
      if (event.action.isKey()) await event.action.setTitle("HELD");
    });
  }
  override onKeyUp(event: KeyUpEvent<ActionData>): void {
    this.holdUp(event.action);
  }
}

export class ObsSceneAction extends ControlAction {
  override manifestId = "com.simracecenter.director.obs-scene";
  constructor(connection: DirectorConnection) {
    super(connection, "obs-scene");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> {
    const settings = event.payload.settings;
    const state = this.connection.snapshot().state;
    const scene = resolveObsScene(settings, state);
    if (!scene) {
      const slot = settings.slot;
      return this.showAlert(
        event.action,
        Number.isInteger(slot) && slot !== undefined && slot >= 1 && slot <= 8
          ? `Scene slot ${slot} unavailable`
          : "Select scene",
      );
    }
    return this.runCommand(event.action, () => this.connection.command("obs.setScene", { scene }));
  }
  override async onPropertyInspectorDidAppear(_event: PropertyInspectorDidAppearEvent<ActionData>): Promise<void> {
    const state = await this.currentState();
    await streamDeck.ui.sendToPropertyInspector({
      type: "scene-options",
      scenes: state?.obs.scenes ?? [],
      liveScenes: state?.obs.liveScenes ?? [],
    });
  }
  override async onSendToPlugin(event: SendToPluginEvent<Record<string, any>, ActionData>): Promise<void> {
    const value = event.payload as { type?: unknown; scene?: unknown; slot?: unknown; clear?: unknown };
    if (value?.type !== "set-scene") return;
    if (value.clear === true) {
      await event.action.setSettings({});
    } else if (typeof value.slot === "number" && Number.isInteger(value.slot) && value.slot >= 1 && value.slot <= 8) {
      await event.action.setSettings({ scene: "", slot: value.slot });
    } else if (typeof value.scene === "string") {
      await event.action.setSettings({ scene: value.scene });
    }
  }
}

abstract class ObsOutputAction extends ControlAction {
  protected abstract readonly commandId: "obs.setStream" | "obs.setRecord";
  protected abstract readonly output: "streaming" | "recording";

  override onKeyDown(event: KeyDownEvent<ActionData>): void {
    const active = this.connection.snapshot().state?.obs[this.output];
    if (active === null || active === undefined) {
      void this.showAlert(event.action, "OBS ?");
      return;
    }
    if (active) {
      this.holdDown(event.action, () => this.connection.command(this.commandId, { enabled: false }));
    } else {
      void this.runCommand(event.action, () => this.connection.command(this.commandId, { enabled: true }));
    }
  }

  override onKeyUp(event: KeyUpEvent<ActionData>): void {
    this.holdUp(event.action);
  }
}

export class ObsStreamAction extends ObsOutputAction {
  override manifestId = "com.simracecenter.director.obs-stream";
  protected readonly commandId = "obs.setStream" as const;
  protected readonly output = "streaming" as const;
  constructor(connection: DirectorConnection) {
    super(connection, "obs-stream");
  }
}

export class ObsRecordAction extends ObsOutputAction {
  override manifestId = "com.simracecenter.director.obs-record";
  protected readonly commandId = "obs.setRecord" as const;
  protected readonly output = "recording" as const;
  constructor(connection: DirectorConnection) {
    super(connection, "obs-record");
  }
}

export class ServiceAction extends ControlAction {
  override manifestId = "com.simracecenter.director.service";
  constructor(connection: DirectorConnection) {
    super(connection, "service");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> {
    const service = this.connection.snapshot().state?.services.find(item => item.id === event.payload.settings.serviceId);
    if (!service) return this.showAlert(event.action, "Select service");
    if (service.canStart) return this.runCommand(event.action, () => this.connection.command("service.start", { id: service.id }));
    if (service.canStop) return this.runCommand(event.action, () => this.connection.command("service.stop", { id: service.id }));
    return this.showAlert(event.action, service.detail ?? `Cannot ${service.state}`);
  }
  override async onPropertyInspectorDidAppear(_event: PropertyInspectorDidAppearEvent<ActionData>): Promise<void> {
    const services = this.connection.snapshot().state?.services ?? [];
    await streamDeck.ui.sendToPropertyInspector({ type: "service-options", services });
  }
  override async onSendToPlugin(event: SendToPluginEvent<Record<string, any>, ActionData>): Promise<void> {
    const value = event.payload as { type?: unknown; serviceId?: unknown };
    if (value?.type !== "set-service" || typeof value.serviceId !== "string") return;
    await event.action.setSettings({ serviceId: value.serviceId });
  }
}

export class FocusWeightAction extends ControlAction {
  override manifestId = "com.simracecenter.director.focus-weight";
  constructor(connection: DirectorConnection) {
    super(connection, "focus-weight");
  }
  override onKeyDown(event: KeyDownEvent<ActionData>): Promise<void> {
    const { focusMode, focusValue } = event.payload.settings;
    if (typeof focusValue !== "number" || !Number.isFinite(focusValue)) return this.showAlert(event.action, "Configure focus key");
    if (focusMode === "step") {
      return this.runCommand(event.action, () => this.connection.command("coverage.adjustFocusWeight", { delta: Math.max(-1, Math.min(1, focusValue)) }));
    }
    return this.runCommand(event.action, () => this.connection.command("coverage.setFocusWeight", { weight: Math.max(0, Math.min(1, focusValue)) }));
  }
  override async onPropertyInspectorDidAppear(_event: PropertyInspectorDidAppearEvent<ActionData>): Promise<void> {
    const coverage = this.connection.snapshot().state?.coverage ?? null;
    await streamDeck.ui.sendToPropertyInspector({ type: "focus-options", coverage });
  }
  override async onSendToPlugin(event: SendToPluginEvent<Record<string, any>, ActionData>): Promise<void> {
    const value = event.payload as { type?: unknown; focusMode?: unknown; focusValue?: unknown };
    if (value?.type !== "set-focus") return;
    const focusMode = value.focusMode === "step" ? "step" : "preset";
    const focusValue = typeof value.focusValue === "number" ? value.focusValue : Number(value.focusValue);
    if (!Number.isFinite(focusValue)) return;
    await event.action.setSettings({ focusMode, focusValue });
  }
}

export class ConnectionAction extends ControlAction {
  override manifestId = "com.simracecenter.director.connection";
  constructor(connection: DirectorConnection) {
    super(connection, "connection");
  }
  override onKeyDown(_event: KeyDownEvent<ActionData>): void {
    this.connection.reconnect();
  }
  override async onPropertyInspectorDidAppear(_event: PropertyInspectorDidAppearEvent<ActionData>): Promise<void> {
    const current = this.connection.snapshot();
    await streamDeck.ui.sendToPropertyInspector({
      type: "connection",
      directorUrl: this.connection.directorUrl(),
      status: current.connection,
    });
  }
  override async onSendToPlugin(event: SendToPluginEvent<Record<string, any>, ActionData>): Promise<void> {
    const payload = event.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return;
    const value = payload as Record<string, unknown>;
    if (value.type !== "pair" || typeof value.code !== "string" || typeof value.name !== "string") return;
    try {
      await this.connection.pair(value.code, value.name, typeof value.directorUrl === "string" ? value.directorUrl : undefined);
      await streamDeck.ui.sendToPropertyInspector({ type: "pair-result", ok: true });
    } catch (error) {
      await streamDeck.ui.sendToPropertyInspector({ type: "pair-result", ok: false, error: errorMessage(error) });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
