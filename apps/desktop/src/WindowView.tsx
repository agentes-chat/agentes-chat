import { Button, EmptyState } from "@agenteschat/ui";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { WindowName } from "./host/types";
import { AppLayer } from "./layer/AppLayer";
import { Notch } from "./windows/Notch";
import { Popover } from "./windows/Popover";

/** One bundle, three screens: the web view's label picks it (the popover, the notch, the main window's app layer). */
export function WindowView({ name }: { name: WindowName }) {
  useEffect(() => {
    document.body.dataset.window = name;
  }, [name]);
  if (name === "app") return <AppLayer />;
  if (name === "notch") return <Notch />;
  return <Popover />;
}

/** A window that broke while drawing (main.tsx's boundary): what happened, and drawn again from the start. */
export function WindowError() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="alert"
      actions={
        <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
          {t("desktop.common.retry")}
        </Button>
      }
    >
      {t("desktop.common.error")}
    </EmptyState>
  );
}
