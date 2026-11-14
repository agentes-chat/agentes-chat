import type { Machine, MachineTool } from "@agenteschat/client";
import { useAllowMachineTool, useMachines } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { firstName } from "@agenteschat/client/lib/format";
import { messageToolOff } from "@agenteschat/client/lib/machine-outages";
import { type ToolOneClick, toolOneClick, toolWords } from "@agenteschat/client/lib/machines";
import { Button, type ButtonProps, SettingNote } from "@agenteschat/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/lib/toast";
import { useOrg } from "../org-context";

/**
 * The one way out where a tool is off on a computer (ADR 0036 §8): its owner turns it on right here, anyone else asks
 * them (they get the same button in their inbox), an app too old says to update it. Nothing where nobody can.
 * `label` replaces "Ligar o navegador" where the click does more ("Ligar e fazer login"); `onAllowed` runs once on.
 * Several tools ask in one button (one ask each) and turn on one button each (`ToolOneClickButtons`).
 */
export function ToolOneClickButton({
  machineId,
  machineName,
  oneClick,
  tool,
  label,
  ariaLabel,
  onAllowed,
  size = "sm",
  variant = "primary",
}: {
  machineId: string;
  machineName: string;
  oneClick: ToolOneClick | null;
  tool: MachineTool | readonly MachineTool[];
  label?: string;
  ariaLabel?: string;
  onAllowed?: () => void;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const allow = useAllowMachineTool(org.id);
  if (!oneClick) return null;
  if (oneClick.kind === "outdated")
    return <span className="small muted">{t("machines.oneClick.outdated", { machine: machineName })}</span>;
  const fail = (err: unknown) => toast.show(errorText(t, err), "error");
  const tools: readonly MachineTool[] = typeof tool === "string" ? [tool] : tool;
  if (oneClick.kind === "ask") {
    const name = firstName(oneClick.ownerName);
    return (
      <Button
        size={size}
        variant={variant === "primary" ? "default" : variant}
        loading={allow.isPending}
        aria-label={ariaLabel}
        onClick={() =>
          Promise.all(tools.map((x) => allow.mutateAsync({ machineId, tool: x, ask: true }))).then(
            () => toast.show(t("machines.oneClick.asked", { name })),
            fail,
          )
        }
      >
        {t("machines.oneClick.ask", { name })}
      </Button>
    );
  }
  return (
    <Button
      size={size}
      variant={variant}
      loading={allow.isPending}
      aria-label={ariaLabel}
      onClick={() =>
        allow.mutate(
          { machineId, tool: tools[0] as MachineTool },
          {
            onSuccess: () =>
              onAllowed ? onAllowed() : toast.show(t("machines.oneClick.done", { machine: machineName })),
            onError: fail,
          },
        )
      }
    >
      {label ?? t("machines.oneClick.allow", { tool: toolWords(t, tools[0] as MachineTool) })}
    </Button>
  );
}

/** What one click does for this person on `machine` (null: nothing from here). */
export function useToolOneClick(machine: Machine | null | undefined) {
  const { me } = useOrg();
  return toolOneClick(machine, me.user.id);
}

/**
 * A tool off on a computer, said in a note with its button, where the way out used to be a settings screen. Null where
 * one click can't do it (an app too old, the workspace's own computer): the caller keeps its own steps there.
 */
export function ToolOffNote({ machine, tool, children }: { machine: Machine; tool: MachineTool; children: ReactNode }) {
  const oneClick = useToolOneClick(machine);
  if (!oneClick || oneClick.kind === "outdated") return null;
  return (
    <SettingNote icon="computer">
      {children}
      <span style={{ display: "block", marginTop: "var(--space-2)" }}>
        <MachineToolButton machine={machine} tool={tool} />
      </span>
    </SettingNote>
  );
}

/**
 * Under an agent's message that needs a switch on its computer (a wait for its CLI or commands, a call refused for
 * the browser or the desktop): the one click, until it is on. The message says the cause; this is its way out.
 */
export function WaitToolOffAction({ meta }: { meta: Record<string, unknown> | null | undefined }) {
  const { org } = useOrg();
  const off = messageToolOff(meta);
  const machine = useMachines(org.id, Boolean(off)).data?.find((m) => m.id === off?.machineId);
  const tools = off && machine ? off.tools.filter((tool) => machine.access?.tools[tool] !== true) : [];
  if (!machine || tools.length === 0) return null;
  return (
    <div className="ac-acts" style={{ marginTop: "var(--space-2)" }}>
      <MachineToolButtons machine={machine} tools={tools} />
    </div>
  );
}

/** The same, for a computer the screen already has: who may do what follows from who paired it. */
export function MachineToolButton({
  machine,
  tool,
  ...rest
}: { machine: Machine; tool: MachineTool | readonly MachineTool[] } & Omit<
  Parameters<typeof ToolOneClickButton>[0],
  "machineId" | "machineName" | "oneClick" | "tool"
>) {
  const { me } = useOrg();
  return (
    <ToolOneClickButton
      machineId={machine.id}
      machineName={machine.name}
      oneClick={toolOneClick(machine, me.user.id)}
      tool={tool}
      {...rest}
    />
  );
}

/**
 * The switches a screen still needs on `machine`: one button each for whoever connected it, one ask for all of them
 * for anyone else.
 */
export function MachineToolButtons({
  machine,
  tools,
  onAllowed,
}: {
  machine: Machine;
  tools: readonly MachineTool[];
  onAllowed?: () => void;
}) {
  const oneClick = useToolOneClick(machine);
  if (tools.length === 0) return null;
  if (oneClick?.kind === "ask") return <MachineToolButton machine={machine} tool={tools} />;
  return (
    <>
      {tools.map((tool) => (
        <MachineToolButton key={tool} machine={machine} tool={tool} {...(onAllowed ? { onAllowed } : {})} />
      ))}
    </>
  );
}
