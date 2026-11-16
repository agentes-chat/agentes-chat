import type { CustomServer } from "@agenteschat/client";
import { useCustomServerAction } from "@agenteschat/client";
import { Alert, Button, DialogBody, DialogFooter, Field, Input, Textarea } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "@/api/context";
import { useOrg } from "./org-context";

export interface StdioDraft {
  name: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
}
export const emptyStdioDraft = (name = ""): StdioDraft => ({ name, command: "", args: "[]", cwd: "", env: "{}" });

/** Local processes use the same connect → tools → agents flow as remote MCP servers. */
export function ConnectStdio({
  tabs,
  connectionId,
  initialName,
  draft,
  onDraftChange,
  returnTo,
  onConnected,
  onClose,
}: {
  tabs: ReactNode;
  connectionId?: string;
  initialName?: string;
  draft?: StdioDraft;
  onDraftChange?: (draft: StdioDraft) => void;
  returnTo: string;
  onConnected: (server: CustomServer) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const { connect } = useCustomServerAction(org.id);
  const capability = useQuery({
    queryKey: ["org", org.id, "custom-transports"],
    queryFn: () => api.customConnectors.transports?.(org.id) ?? Promise.resolve({ stdio: false }),
  });
  const [localDraft, setLocalDraft] = useState(() => emptyStdioDraft(initialName));
  const { name, command, args, cwd, env } = draft ?? localDraft;
  const change = (key: keyof StdioDraft, value: string) => {
    const next = { ...(draft ?? localDraft), [key]: value };
    setLocalDraft(next);
    onDraftChange?.(next);
  };
  const [invalid, setInvalid] = useState(false);
  const allowed = capability.data?.stdio === true;
  const submit = () => {
    if (!allowed || connect.isPending) return;
    let argv: unknown;
    let variables: unknown;
    try {
      argv = JSON.parse(args);
      variables = JSON.parse(env);
      if (
        !command.trim() ||
        !Array.isArray(argv) ||
        !argv.every((v) => typeof v === "string") ||
        !variables ||
        Array.isArray(variables) ||
        typeof variables !== "object" ||
        !Object.values(variables).every((v) => typeof v === "string")
      )
        throw new Error("invalid");
    } catch {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    connect.mutate(
      {
        label: name.trim() || undefined,
        returnTo,
        connectionId,
        stdio: {
          command: command.trim(),
          args: argv as string[],
          env: variables as Record<string, string>,
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        },
      },
      {
        onSuccess: (result) => {
          if (result.status === "connected") onConnected(result.server);
        },
      },
    );
  };
  return (
    <>
      <DialogBody className="cflow__body">
        {tabs}
        <p className="muted cflow__text">{t("connectFlow.local.where")}</p>
        {capability.isPending ? (
          <p role="status">{t("connectFlow.local.checking")}</p>
        ) : (
          !allowed && (
            <Alert tone="neutral">
              {t(capability.isError ? "connectFlow.local.checkFailed" : "connectFlow.local.disabled")}
            </Alert>
          )
        )}
        <form
          id="cflow-stdio"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="cflow__stdio-fields" disabled={!allowed || connect.isPending}>
            <Field label={t("connectFlow.name")} id="cflow-stdio-name">
              <Input
                value={name}
                onChange={(e) => change("name", e.target.value)}
                placeholder={t("connectFlow.namePlaceholder")}
              />
            </Field>
            <Field
              label={t("connectFlow.local.command")}
              id="cflow-stdio-command"
              example={t("connectFlow.local.commandHelp")}
            >
              <Input
                value={command}
                onChange={(e) => change("command", e.target.value)}
                placeholder={t("connectFlow.local.commandExample")}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label={t("connectFlow.local.args")} id="cflow-stdio-args" example={t("connectFlow.local.argsHelp")}>
              <Textarea value={args} onChange={(e) => change("args", e.target.value)} rows={3} spellCheck={false} />
            </Field>
            <Field label={t("connectFlow.local.cwd")} id="cflow-stdio-cwd" example={t("connectFlow.local.cwdHelp")}>
              <Input
                value={cwd}
                onChange={(e) => change("cwd", e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <details>
              <summary>{t("connectFlow.local.environment")}</summary>
              <Field label={t("connectFlow.local.env")} id="cflow-stdio-env" example={t("connectFlow.local.envHelp")}>
                <Input
                  type="password"
                  value={env}
                  onChange={(e) => change("env", e.target.value)}
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </Field>
            </details>
          </fieldset>
        </form>
        {invalid && <Alert tone="danger">{t("connectFlow.local.invalid")}</Alert>}
        {connect.isError && <Alert tone="danger">{t("connectFlow.local.failed")}</Alert>}
      </DialogBody>
      <DialogFooter bar note={t("connectFlow.local.permissions")}>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          type="submit"
          form="cflow-stdio"
          disabled={!allowed || connect.isPending}
          loading={connect.isPending}
        >
          {t("connectors.connect")}
        </Button>
      </DialogFooter>
    </>
  );
}
