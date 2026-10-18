// SPDX-License-Identifier: GPL-3.0-or-later
import streamDeck from "@elgato/streamdeck";
import {
  AllStopAction,
  ConnectionAction,
  FocusWeightAction,
  ObsRecordAction,
  ObsSceneAction,
  ObsStreamAction,
  PauseResumeAction,
  PreflightAction,
  RunStatusAction,
  ServiceAction,
  StartRunAction,
  StopRunAction,
} from "./actions/control-actions";
import { DEFAULT_DIRECTOR_URL, DirectorConnection, type GlobalSettings } from "./connection";

const connection = new DirectorConnection({
  saveSettings: settings => streamDeck.settings.setGlobalSettings(settings),
});

streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>(event => connection.configure(event.settings));
void streamDeck.settings.getGlobalSettings<GlobalSettings>().then(settings => {
  connection.configure({
    directorUrl: settings.directorUrl ?? DEFAULT_DIRECTOR_URL,
    ...(settings.token ? { token: settings.token } : {}),
  });
});

for (const action of [
  new RunStatusAction(connection),
  new PreflightAction(connection),
  new StartRunAction(connection),
  new PauseResumeAction(connection),
  new StopRunAction(connection),
  new AllStopAction(connection),
  new ObsSceneAction(connection),
  new ObsStreamAction(connection),
  new ObsRecordAction(connection),
  new ServiceAction(connection),
  new FocusWeightAction(connection),
  new ConnectionAction(connection),
]) {
  streamDeck.actions.registerAction(action);
}

streamDeck.actions.onKeyDown(event => {
  streamDeck.logger.debug(`keyDown delivered for ${event.action.manifestId}`);
});

streamDeck.connect();
