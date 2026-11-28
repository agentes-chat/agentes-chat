/**
 * Settings › This computer › Overview (ADR 0265 §6): this computer's picture and name (renamed here for every
 * workspace), whether something needs the person, the workspaces whose agents use it and the app's version; then
 * "Always ready", what keeps agents working here without anyone looking, and "Who uses this computer".
 */
import { Button, Input } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSnapshot, useStore } from "../../app";
import { unpairedWorkspaces } from "../../control/pair";
import { orgName } from "../../control/store";
import { macStateOf } from "../../control/tray";
import { useWorkspaces } from "../../hooks";
import { MacPortrait } from "../../ui/bits";
import { CardTitle } from "../../ui/settings";
import { useToast } from "../../ui/Toast";
import { listNames } from "../../ui/time";
import { AlwaysOn, rowsNeedingYou } from "./AlwaysOn";
import type { SettingsContext } from "./Settings";
import { WhoUses } from "./ThisMac";

export function Overview({ ctx }: { ctx: SettingsContext }) {
  const { t, i18n } = useTranslation();
  const store = useStore();
  const snap = useSnapshot();
  const toast = useToast();
  const { homes, essentials, update } = ctx;
  // Every workspace the person is signed in to where agents may work here, not paired yet: Allow.
  const offers = unpairedWorkspaces(useWorkspaces(), snap);
  const current = homes.find((h) => h.status?.machine)?.status?.machine?.name ?? "";
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  // The name arrives with the first status.
  useEffect(() => {
    if (current && !renaming) setName(current);
  }, [current, renaming]);
  // Renaming starts in the field.
  useEffect(() => {
    if (renaming) document.getElementById("machine-name")?.focus();
  }, [renaming]);

  const saveName = async () => {
    const clean = name.trim();
    if (!clean || clean === current) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await store.requestAll({ type: "config.set", patch: { name: clean } });
      await Promise.all(homes.map((h) => store.refresh(h.homeId)));
      toast(t("desktop.prefs.general.saved"));
      setRenaming(false);
    } catch {
      toast(t("desktop.common.error"), "alert");
    } finally {
      setSaving(false);
    }
  };

  const needs = rowsNeedingYou(essentials.list);
  const orgs = [...new Set(homes.map(orgName).filter(Boolean))];
  const { latest, available } = update.state;
  const version = update.version
    ? available && latest
      ? t("desktop.settings.overview.versionNewer", { version: update.version, latest: latest.version })
      : t("desktop.settings.overview.version", { version: update.version })
    : null;
  const sub = [
    orgs.length > 0 ? t("desktop.settings.overview.used", { orgs: listNames(orgs, i18n.language) }) : null,
    version,
  ].filter(Boolean);

  return (
    <>
      <div className="dk-sx__head">
        <MacPortrait state={macStateOf(homes)} size={96} />
        <div className="dk-sx__headtext">
          {renaming ? (
            <form
              className="dk-inline-form dk-sx__rename"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <Input
                id="machine-name"
                value={name}
                maxLength={64}
                aria-label={t("desktop.prefs.general.nameLabel")}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  // Esc ends the renaming, not the settings.
                  e.preventDefault();
                  setName(current);
                  setRenaming(false);
                }}
              />
              <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!name.trim()}>
                {t("desktop.prefs.general.save")}
              </Button>
            </form>
          ) : (
            <h2>
              <span>{current || t("desktop.settings.nav.thisDevice")}</span>
              {current && (
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="edit"
                  aria-label={t("desktop.settings.overview.rename")}
                  onClick={() => setRenaming(true)}
                />
              )}
            </h2>
          )}
          {essentials.read && (
            <p className={needs > 0 ? "dk-sx__warn" : "dk-sx__ok"} aria-live="polite">
              {needs > 0 ? t("desktop.settings.nav.needs", { count: needs }) : t("desktop.settings.overview.allSet")}
            </p>
          )}
          {sub.length > 0 && <small className="dk-sx__sub">{sub.join(" · ")}</small>}
        </div>
      </div>

      <CardTitle>{t("desktop.settings.overview.always")}</CardTitle>
      <AlwaysOn essentials={essentials} chooseReach={() => ctx.show("server", "reach")} />

      <CardTitle>{t("desktop.settings.overview.who")}</CardTitle>
      {/* The screen's one filled button: a fix above while something needs the person, else the first Allow. */}
      <WhoUses homes={homes} offers={offers} primary={needs === 0} />
    </>
  );
}
