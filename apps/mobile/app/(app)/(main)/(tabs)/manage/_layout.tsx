import { useTranslation } from "react-i18next";
import { TabStack } from "@/ui";

/** Gestão: a stack whose root has the native large title. */
export default function ManageStack() {
  const { t } = useTranslation();
  return <TabStack title={t("mobile.manage.title")} />;
}
