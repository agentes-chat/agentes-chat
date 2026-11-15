import { serverText } from "@agenteschat/i18n";
import { taskEndNotice } from "../machine-tasks";
import type { DesignJobView } from "./ledger";
import { DESIGN_COMPLETION_GUIDANCE } from "./notice-data";
/** Same once-per-task conversation delivery as other computer work. */
export const claudeDesignNotice =
  (job: DesignJobView): typeof taskEndNotice =>
  (row, computer, locale = "en") => {
    const base = taskEndNotice(row, computer, locale);
    const code = `claude_design_${job.state}` as const;
    const body = serverText(locale, `chat.body.${code}`, { title: row.title });
    return {
      ...base,
      body,
      text: `${body}\n${JSON.stringify(job)}\n${DESIGN_COMPLETION_GUIDANCE}`,
      meta: {
        ...base.meta,
        machineTask: { ...base.meta.machineTask, result: JSON.stringify(job), lastLine: undefined },
        claudeDesign: { jobId: job.id, outcome: job },
        bodyCode: code,
        bodyParams: { title: row.title },
      },
    };
  };
