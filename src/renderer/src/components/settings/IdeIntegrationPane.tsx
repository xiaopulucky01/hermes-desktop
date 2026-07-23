import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Loader,
  RefreshCw,
} from "lucide-react";
import type { AcpLaunchInfo } from "../../../../shared/acp";
import { useI18n } from "../useI18n";

const ACP_DOCS_URL =
  "https://hermes-agent.nousresearch.com/docs/user-guide/features/acp";

/**
 * Settings pane for connecting ACP-compatible IDEs (Zed, JetBrains, VS Code)
 * to the local Hermes engine via a desktop-generated launcher script.
 */
export default function IdeIntegrationPane(): React.JSX.Element {
  const { t } = useI18n();
  const [info, setInfo] = useState<AcpLaunchInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installOk, setInstallOk] = useState<boolean | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.hermesAPI.getAcpLaunchInfo();
      setInfo(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleInstall = async () => {
    setInstalling(true);
    setInstallMessage(null);
    setInstallOk(null);
    try {
      const result = await window.hermesAPI.installAcpExtra();
      setInstallMessage(result.message);
      setInstallOk(result.ok);
      if (result.ok) await refresh();
    } finally {
      setInstalling(false);
    }
  };

  const unavailableMessage = (reason: AcpLaunchInfo["unavailableReason"]) => {
    switch (reason) {
      case "remote_mode":
        return t("settings.acp.unavailableRemote");
      case "no_python":
        return t("settings.acp.unavailablePython");
      case "no_acp_extra":
        return t("settings.acp.unavailableExtra");
      default:
        return t("settings.acp.unavailableCli");
    }
  };

  return (
    <div className="settings-modal-pane">
      <p className="settings-section-intro">{t("settings.acp.intro")}</p>

      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <Code2 size={18} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">{t("settings.acp.title")}</div>
            <div className="settings-card-sub">{t("settings.acp.subtitle")}</div>
          </div>
          {!loading && info && (
            <span
              className={`settings-card-badge ${info.available ? "is-ok" : "is-update"}`}
            >
              {info.available
                ? t("settings.acp.statusReady")
                : t("settings.acp.statusUnavailable")}
            </span>
          )}
        </header>

        <div className="settings-card-body">
          {loading ? (
            <span className="skeleton skeleton-md" />
          ) : info?.available ? (
            <>
              <p className="settings-ide-hint">{t("settings.acp.readyHint")}</p>

              <div className="settings-snippet-stack">
                <CopyBlock
                  label={t("settings.acp.launcherPath")}
                  value={info.launcherPath ?? ""}
                  copied={copiedKey === "launcher"}
                  onCopy={() =>
                    void copyText("launcher", info.launcherPath ?? "")
                  }
                />

                {info.zedAgentJson && (
                  <CopyBlock
                    label={t("settings.acp.zedConfig")}
                    value={info.zedAgentJson}
                    copied={copiedKey === "zed"}
                    multiline
                    onCopy={() => void copyText("zed", info.zedAgentJson ?? "")}
                  />
                )}
              </div>

              <div className="settings-card-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} />
                  {t("settings.acp.refreshLauncher")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    void window.hermesAPI.openExternal(ACP_DOCS_URL)
                  }
                >
                  <ExternalLink size={14} />
                  {t("settings.acp.openDocs")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="settings-hermes-result error">
                {unavailableMessage(info?.unavailableReason)}
              </div>
              {info?.installHint && (
                <pre className="settings-hermes-doctor">{info.installHint}</pre>
              )}
              <div className="settings-card-actions">
                {info?.unavailableReason === "no_acp_extra" &&
                  !info.installHint?.includes("prepare-runtime") && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void handleInstall()}
                      disabled={installing}
                    >
                      {installing ? (
                        <Loader size={14} className="settings-spin" />
                      ) : (
                        <Download size={14} />
                      )}
                      {installing
                        ? t("settings.acp.installing")
                        : t("settings.acp.installExtra")}
                    </button>
                  )}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    void window.hermesAPI.openExternal(ACP_DOCS_URL)
                  }
                >
                  <ExternalLink size={14} />
                  {t("settings.acp.openDocs")}
                </button>
              </div>
              {installMessage && (
                <div
                  className={`settings-hermes-result ${installOk ? "success" : "error"}`}
                >
                  {installMessage}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CopyBlock({
  label,
  value,
  copied,
  onCopy,
  multiline = false,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  multiline?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div
      className={`settings-snippet${multiline ? " is-multiline" : ""}${copied ? " is-copied" : ""}`}
    >
      <div className="settings-snippet-head">
        <span className="settings-meta-label">{label}</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm settings-snippet-copy"
          onClick={onCopy}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("settings.acp.copied") : t("settings.acp.copy")}
        </button>
      </div>
      <pre className="settings-snippet-code">
        <code>{value}</code>
      </pre>
    </div>
  );
}
