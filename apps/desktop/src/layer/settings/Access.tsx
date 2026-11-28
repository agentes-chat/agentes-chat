/**
 * Settings › This computer › Folders and tools (ADR 0265 §7): what agents of every workspace use here. The tools (the
 * browser, Commands, the coding programs and their accounts), the folders allowed for them, and the phones plugged
 * into this computer.
 */
import { useTranslation } from "react-i18next";
import { useSnapshot } from "../../app";
import { pairedHomes } from "../../control/store";
import { CardTitle, PrefHead } from "../../ui/settings";
import { Folders } from "./Folders";
import { Phones } from "./ThisMac";
import { Tools } from "./Tools";

export function Access() {
  const { t } = useTranslation();
  const homes = pairedHomes(useSnapshot());
  return (
    <>
      <PrefHead title={t("desktop.settings.access.title")} lead={t("desktop.settings.access.lead")} />
      <section data-focus="tools">
        <CardTitle>{t("desktop.settings.access.tools")}</CardTitle>
        <Tools />
      </section>
      <section data-focus="folders">
        <CardTitle>{t("desktop.settings.access.folders")}</CardTitle>
        <Folders />
      </section>
      <Phones homes={homes} />
    </>
  );
}
