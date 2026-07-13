/**
 * Eager gateway boot on app launch so enabled platforms (including A2A) are up
 * before the user sends the first chat message.
 */
// @lat: [[a2a-integration#A2A integration#Eager boot]]
import {
  ensureA2aConfig,
  ensureA2aEnv,
  ensureA2aPluginLinked,
  isA2aPluginAvailable,
} from "../a2a-plugin";
import { HERMES_HOME } from "../installer";
import {
  isRemoteMode,
  restartGateway,
  startGatewayWithRecovery,
} from "../hermes";
import { getActiveProfileNameSync } from "../utils";

export function bootGatewayAndA2aOnAppStart(): void {
  void (async () => {
    const profile = getActiveProfileNameSync();

    try {
      ensureA2aPluginLinked(HERMES_HOME);
    } catch (err) {
      console.warn("[boot] A2A plugin link failed:", err);
    }

    let a2aProvisioningChanged = false;
    if (isA2aPluginAvailable(HERMES_HOME)) {
      try {
        a2aProvisioningChanged = ensureA2aConfig(profile);
      } catch (err) {
        console.warn("[boot] A2A config provisioning failed:", err);
      }
      try {
        a2aProvisioningChanged = ensureA2aEnv(profile) || a2aProvisioningChanged;
      } catch (err) {
        console.warn("[boot] A2A env provisioning failed:", err);
      }
    }

    if (isRemoteMode()) {
      console.log(
        "[boot] Remote/SSH mode — local gateway (and local A2A inbound) not started",
      );
      return;
    }

    const ready = a2aProvisioningChanged
      ? await restartGateway(profile)
      : await startGatewayWithRecovery(profile);
    if (ready) {
      console.log(`[boot] Gateway ready (profile: ${profile})`);
    } else {
      console.warn(
        `[boot] Gateway did not become ready for profile "${profile}" — check gateway logs`,
      );
    }
  })();
}
