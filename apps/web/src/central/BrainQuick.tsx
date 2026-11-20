import type { CentralAgent } from "@agenteschat/client";
import { keys, useAgentBrain, useApi } from "@agenteschat/client";
import { EFFORT_LEVELS } from "@agenteschat/client/lib/brain-advanced";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOrg } from "@/components/org-context";
import type { useCentralWords } from "./words";

type Words = ReturnType<typeof useCentralWords>;

/**
 * VPS Zen: the model and the effort, changed from the Central. The same "Quem pensa" call as the agent's page; only
 * its owner or an admin sees the choices (`canEdit`), and the rest of its setup stays on that page.
 */
export function BrainQuick({ agent, w }: { agent: CentralAgent; w: Words }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const brain = useAgentBrain(org.id, agent.id);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (input: { model?: string | null; effort?: string | null }) =>
      api.agents.setBrain(org.id, agent.id, input as never),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: keys.agentBrain(org.id, agent.id) });
      void qc.invalidateQueries({ queryKey: keys.central(org.id) });
    },
  });
  const data = brain.data;
  if (!data?.canEdit) return null;
  const option =
    data.options.find((o) => o.kind === data.brain) ??
    data.machines.flatMap((m) => m.options).find((o) => o.kind === data.brain);
  const models = option?.models ?? [];
  return (
    <div className="central-brain">
      {models.length > 0 && (
        <label>
          <span>{w.model}</span>
          <select
            value={data.model ?? ""}
            disabled={save.isPending}
            onChange={(e) => save.mutate({ model: e.target.value || null })}
          >
            <option value="">{w.auto}</option>
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>{w.effort}</span>
        <select
          value={data.effort ?? "auto"}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ effort: e.target.value === "auto" ? null : e.target.value })}
        >
          {["auto", ...EFFORT_LEVELS].map((e) => (
            <option key={e} value={e}>
              {w.efforts[e] ?? e}
            </option>
          ))}
        </select>
      </label>
      {saved && !save.isPending && <small>{w.saved}</small>}
    </div>
  );
}
