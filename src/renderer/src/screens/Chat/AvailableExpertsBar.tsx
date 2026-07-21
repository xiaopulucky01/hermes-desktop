import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";

export type A2aExpert = Awaited<
  ReturnType<typeof window.hermesAPI.listA2aExperts>
>[number];

interface AvailableExpertsBarProps {
  /** When set, prepend a preference hint into the composer. */
  onPreferExpert?: (expert: A2aExpert) => void;
  preferredKey?: string | null;
}

/**
 * Compact strip of A2A peers from a2a_registry.json so users see which
 * specialists are available without calling tools themselves.
 */
export function AvailableExpertsBar({
  onPreferExpert,
  preferredKey,
}: AvailableExpertsBarProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [experts, setExperts] = useState<A2aExpert[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await window.hermesAPI.listA2aExperts();
      setExperts(list);
    } catch {
      setExperts([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (experts.length === 0) return null;

  async function handleClick(expert: A2aExpert): Promise<void> {
    const target = expert.service_id || expert.endpoint;
    try {
      await window.hermesAPI.ensureAgentServiceRunningByEndpoint(target);
    } catch {
      /* best-effort lazy start */
    }
    onPreferExpert?.(expert);
  }

  return (
    <div className="chat-experts-bar" role="list" aria-label={t("chat.expertsLabel")}>
      <span className="chat-experts-label">
        <Sparkles size={12} />
        {t("chat.expertsLabel")}
      </span>
      <div className="chat-experts-chips">
        {experts.map((expert) => {
          const active = preferredKey === expert.key;
          return (
            <button
              key={expert.key}
              type="button"
              role="listitem"
              className={`chat-experts-chip${active ? " is-active" : ""}`}
              title={expert.description || expert.endpoint}
              onClick={() => void handleClick(expert)}
            >
              {expert.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
