import { useCallback, useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Loader,
  Network,
  Play,
  Plus,
  RefreshCw,
  Square,
} from "lucide-react";
import { useI18n } from "../useI18n";

type ServiceRow = Awaited<
  ReturnType<typeof window.hermesAPI.listAgentServices>
>[number];

type UpdateRow = Awaited<
  ReturnType<typeof window.hermesAPI.listAgentServiceUpdates>
>[number];

function statusBadgeClass(status: ServiceRow["status"]): string {
  switch (status) {
    case "running":
      return "is-ok";
    case "starting":
      return "is-update";
    case "error":
      return "is-error";
    default:
      return "is-muted";
  }
}

export default function AgentServicesPane(): React.JSX.Element {
  const { t } = useI18n();
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [list, ups] = await Promise.all([
        window.hermesAPI.listAgentServices(),
        window.hermesAPI.listAgentServiceUpdates(),
      ]);
      setRows(list);
      setUpdates(ups);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function start(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const res = await window.hermesAPI.startAgentService(id);
      if (!res.success) setError(res.error || "Start failed");
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function stop(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await window.hermesAPI.stopAgentService(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function openUi(id: string): Promise<void> {
    const res = await window.hermesAPI.openAgentServiceUi(id);
    if (!res.success) {
      setError(res.error || "No UI");
    }
  }

  async function applyUpdate(id: string): Promise<void> {
    setBusyId(id);
    setInfo(null);
    setError(null);
    try {
      const res = await window.hermesAPI.applyAgentServiceUpdate(id);
      if (!res.success) setError(res.error || "Update failed");
      else setInfo(t("settings.agentServices.updateApplied", { id }));
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function scaffoldNew(): Promise<void> {
    const id = window.prompt(t("settings.agentServices.scaffoldPromptId"));
    if (!id?.trim()) return;
    const name =
      window.prompt(t("settings.agentServices.scaffoldPromptName"), id) ||
      undefined;
    setBusyId("scaffold");
    setInfo(null);
    setError(null);
    try {
      const res = await window.hermesAPI.scaffoldAgentService({
        id: id.trim(),
        name: name?.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error || "Scaffold failed");
      } else {
        setInfo(
          t("settings.agentServices.scaffoldDone", { path: res.path || "" }),
        );
      }
    } finally {
      setBusyId(null);
    }
  }

  const updateById = new Map(updates.map((u) => [u.id, u]));
  const statusLabel = (status: ServiceRow["status"]): string => {
    switch (status) {
      case "running":
        return t("settings.agentServices.statusRunning");
      case "starting":
        return t("settings.agentServices.statusStarting");
      case "error":
        return t("settings.agentServices.statusError");
      default:
        return t("settings.agentServices.statusStopped");
    }
  };

  return (
    <div className="settings-modal-pane">
      <p className="settings-section-intro">{t("settings.agentServices.intro")}</p>

      {error && (
        <div className="settings-hermes-result error" role="alert">
          {error}
        </div>
      )}
      {info && (
        <div className="settings-hermes-result success" role="status">
          {info}
        </div>
      )}

      {updates.length > 0 && (
        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-card-icon">
              <Download size={18} />
            </span>
            <div className="settings-card-headtext">
              <div className="settings-card-title">
                {t("settings.agentServices.updatesTitle")}
              </div>
              <div className="settings-card-sub">
                {t("settings.agentServices.updatesSubtitle", {
                  count: updates.length,
                })}
              </div>
            </div>
          </header>
          <div className="settings-card-body">
            <ul className="agent-services-updates-list">
              {updates.map((u) => (
                <li key={u.id} className="agent-services-update-row">
                  <div className="agent-services-update-meta">
                    <strong>{u.id}</strong>
                    <span className="settings-meta-pathvalue">
                      v{u.currentVersion} → v{u.availableVersion}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === u.id}
                    onClick={() => void applyUpdate(u.id)}
                  >
                    {busyId === u.id ? (
                      <Loader size={14} className="settings-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    {t("settings.agentServices.applyUpdate")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <Network size={18} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {t("settings.agentServices.cardTitle")}
            </div>
            <div className="settings-card-sub">
              {t("settings.agentServices.cardSubtitle")}
            </div>
          </div>
          {rows.length > 0 && (
            <span className="settings-card-badge is-ok">
              {t("settings.agentServices.count", { count: rows.length })}
            </span>
          )}
        </header>

        <div className="settings-card-body">
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? (
                <Loader size={14} className="settings-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {t("settings.agentServices.refresh")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyId === "scaffold"}
              onClick={() => void scaffoldNew()}
            >
              {busyId === "scaffold" ? (
                <Loader size={14} className="settings-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t("settings.agentServices.scaffold")}
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="agent-services-empty">
              <p className="agent-services-empty-title">
                {t("settings.agentServices.emptyTitle")}
              </p>
              <p className="agent-services-empty-body">
                {t("settings.agentServices.empty")}
              </p>
              <p className="agent-services-empty-hint">
                {t("settings.agentServices.emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="agent-services-list">
              {rows.map((row) => {
                const up = updateById.get(row.id);
                const busy = busyId === row.id;
                return (
                  <li key={row.id} className="agent-services-row">
                    <div className="agent-services-meta">
                      <div className="agent-services-title-row">
                        <strong className="agent-services-name">
                          {row.name}
                        </strong>
                        <span
                          className={`settings-card-badge ${statusBadgeClass(row.status)}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </div>
                      <span className="agent-services-idline">
                        {row.id}
                        {" · "}v{row.version}
                        {row.port ? ` · :${row.port}` : ""}
                        {row.has_venv === false
                          ? ` · ${t("settings.agentServices.noVenv")}`
                          : ""}
                        {up?.updateAvailable
                          ? ` · ${t("settings.agentServices.updateAvailable", { version: up.availableVersion })}`
                          : ""}
                      </span>
                      {row.description && (
                        <p className="agent-services-desc">{row.description}</p>
                      )}
                      {row.last_error && (
                        <p className="agent-services-row-error">
                          {row.last_error}
                        </p>
                      )}
                    </div>
                    <div className="agent-services-actions">
                      {row.status === "running" ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => void stop(row.id)}
                        >
                          {busy ? (
                            <Loader size={14} className="settings-spin" />
                          ) : (
                            <Square size={14} />
                          )}
                          {t("settings.agentServices.stop")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy || row.status === "starting"}
                          onClick={() => void start(row.id)}
                        >
                          {busy ? (
                            <Loader size={14} className="settings-spin" />
                          ) : (
                            <Play size={14} />
                          )}
                          {t("settings.agentServices.start")}
                        </button>
                      )}
                      {up?.updateAvailable && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy}
                          onClick={() => void applyUpdate(row.id)}
                        >
                          <Download size={14} />
                          {t("settings.agentServices.applyUpdate")}
                        </button>
                      )}
                      {row.ui && row.ui.type && row.ui.type !== "none" && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => void openUi(row.id)}
                        >
                          <ExternalLink size={14} />
                          {t("settings.agentServices.openUi")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
