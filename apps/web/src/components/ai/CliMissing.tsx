import type { InstallableCli, Machine, MachineAccountKind } from "@agenteschat/client";
import { useCheckMachineClis, useCliInstall } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { firstName } from "@agenteschat/client/lib/format";
import { CLI_GIT_MISSING, cliOneClick, GIT_FOR_WINDOWS_URL, installableCli } from "@agenteschat/client/lib/machines";
import { Button, HintLine, Icon, SettingNote, Spinner } from "@agenteschat/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/lib/toast";
import { useOrg } from "../org-context";

/**
 * Claude Code or Codex isn't on a computer someone connected (`not_installed`), or is there and won't start
 * (`cant_start`): one line, then the way on. Whoever connected it installs it from here with the vendor's own installer,
 * anyone else asks them; anyone looks again after installing by hand. `useKey`: the panel's "Use an API key now".
 * Null for a computer where nobody installs from here (the workspace's own installs its programs itself) or a program
 * with no installer: the caller keeps its own line there.
 */
export function CliMissing({
  machine,
  kind,
  computer,
  reason,
  useKey,
}: {
  machine: Machine | undefined;
  kind: MachineAccountKind;
  computer: string;
  reason: "not_installed" | "cant_start";
  useKey?: ReactNode;
}) {
  const { t } = useTranslation();
  const { org, me } = useOrg();
  const toast = useToast();
  const cli = installableCli(kind);
  const oneClick = machine && cli ? cliOneClick(machine, me.user.id, cli) : null;
  const run = useCliInstall(org.id, machine?.id ?? null, cli ?? "claude", oneClick?.kind === "allow");
  const check = useCheckMachineClis(org.id);
  const [checked, setChecked] = useState(false);
  if (!machine || !cli || machine.kind === "managed") return null;

  const program = t(`brain.card.${kind}`);
  const words = { program, computer };
  const install = run.install;
  const running = install?.state === "running";
  const pending = run.start.isPending || run.cancel.isPending || run.ask.isPending || check.isPending;
  const broken = reason === "cant_start" ? (machine.cliErrors?.[cli] ?? "") : null;
  const gitMissing =
    (install?.state === "failed" && install.cause === "git_missing") ||
    (broken === CLI_GIT_MISSING && install?.state !== "failed");
  const fail = (err: unknown) => toast.show(errorText(t, err), "error");

  let line: ReactNode;
  if (running) {
    line = (
      <p className="setup-line ac-iconline" role="status">
        <Spinner size={14} />
        <span>{t("connectAi.cli.installing", words)}</span>
      </p>
    );
  } else {
    const text = gitMissing
      ? t("connectAi.cli.gitMissing", words)
      : install?.state === "failed"
        ? install.cause === "still_missing"
          ? t("connectAi.cli.stillMissing", words)
          : t("connectAi.cli.failed", { computer, message: install.message ?? "" })
        : broken !== null
          ? broken
            ? t("connectAi.cli.cantStart", { ...words, message: broken })
            : t("brain.reasons.cant_start", words)
          : checked
            ? t("connectAi.cli.checked", words)
            : oneClick?.kind === "outdated"
              ? t("common.joinSentences", {
                  a: t("connectAi.cli.missing", words),
                  b: t("connectAi.cli.outdated", { computer }),
                })
              : null;
    // The Claude chat app is likely on a Mac or a PC, and isn't Claude Code: said once, behind the ⓘ.
    const why = cli === "claude" && (machine.os === "windows" || machine.os === "darwin");
    line = (
      <SettingNote icon="alert" live>
        {text ??
          (why ? (
            <HintLine name={t("common.about", { label: program })} hint={t("connectAi.cli.claudeApp")}>
              {t("connectAi.cli.missing", words)}
            </HintLine>
          ) : (
            t("connectAi.cli.missing", words)
          ))}
      </SettingNote>
    );
  }

  const start = () => run.start.mutate(undefined, { onError: fail });
  const lookAgain = () =>
    check.mutate(machine.id, {
      onSuccess: () => setChecked(true),
      onError: fail,
    });
  const failedBefore = install?.state === "failed" || install?.state === "canceled";
  return (
    <>
      {line}
      <div className="ac-acts">
        {running ? (
          <Button size="sm" disabled={pending} loading={run.cancel.isPending} onClick={() => run.cancel.mutate()}>
            {t("common.cancel")}
          </Button>
        ) : (
          <>
            {gitMissing && (
              <Button asChild size="sm" variant="primary">
                <a href={GIT_FOR_WINDOWS_URL} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={14} />
                  {t("connectAi.cli.getGit")}
                </a>
              </Button>
            )}
            {oneClick?.kind === "allow" && broken === null && (
              <Button
                size="sm"
                variant={gitMissing ? "default" : "primary"}
                disabled={pending}
                loading={run.start.isPending}
                onClick={start}
              >
                {failedBefore ? t("common.retry") : t("connectAi.cli.install", { program })}
              </Button>
            )}
            {oneClick?.kind === "ask" && broken === null && (
              <Button
                size="sm"
                disabled={pending}
                loading={run.ask.isPending}
                onClick={() =>
                  run.ask.mutate(undefined, {
                    onSuccess: () => toast.show(t("connectAi.cli.asked", { name: firstName(oneClick.ownerName) })),
                    onError: fail,
                  })
                }
              >
                {t("machines.oneClick.ask", { name: firstName(oneClick.ownerName) })}
              </Button>
            )}
            {machine.cliInstall && (
              <Button size="sm" disabled={pending || !machine.online} loading={check.isPending} onClick={lookAgain}>
                {t("connectAi.cli.check")}
              </Button>
            )}
          </>
        )}
        {useKey}
      </div>
    </>
  );
}

/**
 * The inbox row's one click for whoever connected the computer, when someone asked them for a coding CLI there: it
 * installs it, and says so while it runs.
 */
export function CliInstallButton({ machineId, cli }: { machineId: string; cli: InstallableCli }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const run = useCliInstall(org.id, machineId, cli, true);
  const running = run.install?.state === "running";
  return (
    <Button
      size="sm"
      variant="primary"
      loading={run.start.isPending || running}
      onClick={() => run.start.mutate(undefined, { onError: (err) => toast.show(errorText(t, err), "error") })}
    >
      {t("connectAi.cli.install", { program: t(`brain.card.${cli === "claude" ? "claude_code" : "codex"}`) })}
    </Button>
  );
}
