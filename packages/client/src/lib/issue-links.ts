import type { IssueLink } from "../api/types";

const labels = {
  blocks: ["issueLinks.blocks", "issueLinks.blocksIncoming"],
  relates_to: ["issueLinks.relates_to", "issueLinks.relates_to"],
  duplicates: ["issueLinks.duplicates", "issueLinks.duplicatesIncoming"],
  clones: ["issueLinks.clones", "issueLinks.clonesIncoming"],
  parent: ["issueLinks.parent", "issueLinks.parent"],
  child: ["issueLinks.child", "issueLinks.child"],
} as const;
export const issueLinkLabel = (link: Pick<IssueLink, "type" | "incoming">) => labels[link.type][link.incoming ? 1 : 0];
export const issueLinkTypes = ["blocks", "relates_to", "duplicates", "clones"] as const;
