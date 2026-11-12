/** The deliberately supported Jev routes. OpenCode is opt-in and uses its free model only. */
export type JevProvider = "typesafe" | "opencode";

export interface JevProviderProfile {
  provider: JevProvider;
  displayName: string;
  baseURL: string;
  model: string;
  supportsVision: boolean;
  envName: "TYPESAFE_API_KEY" | "OPENCODE_JEV_API_KEY";
}

const profiles: Record<JevProvider, Readonly<JevProviderProfile>> = {
  typesafe: {
    provider: "typesafe",
    displayName: "TypeSafe",
    baseURL: "https://api.typesafe.ai",
    model: "jev-latest",
    supportsVision: true,
    envName: "TYPESAFE_API_KEY",
  },
  opencode: {
    provider: "opencode",
    displayName: "OpenCode",
    baseURL: "https://opencode.ai/inference/systemone",
    model: "jev-1.13-free",
    // The gateway's image contract has not been verified, and Box needs Jev 1.14.
    supportsVision: false,
    envName: "OPENCODE_JEV_API_KEY",
  },
};

export const resolveJevProvider = (provider: JevProvider = "typesafe"): JevProviderProfile => ({
  ...profiles[provider],
});

interface JevResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

export interface JevResponse {
  model?: string;
  answers?: Record<string, Record<string, unknown>>;
  usage?: JevResponseUsage;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const probability = (value: unknown) => finite(value) && value >= 0 && value <= 1;
function protocolError(detail: string): never {
  throw new Error(`Jev returned an invalid response: ${detail}`);
}

/** Validate before using OpenCode answers: an omitted answer must not silently become a zero decision. */
export function validateJevResponse(body: unknown, questions: Record<string, unknown>) {
  if (!record(body) || !record(body.answers)) protocolError("answers must be an object");
  const answers = body.answers as Record<string, unknown>;
  for (const [id, value] of Object.entries(questions)) {
    if (!record(value)) protocolError(`invalid question ${id}`);
    const question = value as Record<string, unknown>;
    const candidate = answers[id];
    if (!record(candidate)) protocolError(`missing answer ${id}`);
    const answer = candidate as Record<string, unknown>;
    if (answer.type !== undefined && answer.type !== question.type) protocolError(`wrong type for ${id}`);
    if (answer.confidence !== undefined && !probability(answer.confidence))
      protocolError(`invalid confidence for ${id}`);
    if (question.type === "noul") {
      if (!probability(answer.noul)) protocolError(`invalid probability for ${id}`);
    } else if (question.type === "choice" || question.type === "score") {
      const keys =
        question.type === "choice"
          ? Object.keys(record(question.criteria) ? question.criteria : {})
          : Array.isArray(question.criteria)
            ? question.criteria.map((_, i) => String(i))
            : [];
      if (
        !keys.length ||
        !record(answer.probabilities) ||
        !keys.every((key) => probability((answer.probabilities as Record<string, unknown>)[key]))
      )
        protocolError(`invalid probabilities for ${id}`);
      const probabilities = answer.probabilities as Record<string, number>;
      // A provider may round each probability to two decimals. Allow half a percentage point per
      // option, at least 1% overall, capped at 5% so a large set never accepts a non-distribution.
      const sumTolerance = Math.min(0.05, Math.max(0.01, keys.length * 0.005)) + 1e-9;
      const sum = keys.reduce((total, key) => total + (probabilities[key] ?? 0), 0);
      if (Math.abs(sum - 1) > sumTolerance) protocolError(`probabilities do not sum to one for ${id}`);
      if (question.type === "choice") {
        if (typeof answer.choice !== "string" || !keys.includes(answer.choice))
          protocolError(`invalid choice for ${id}`);
      } else if (!finite(answer.score) || answer.score < 0 || answer.score > keys.length - 1) {
        protocolError(`invalid score for ${id}`);
      } else {
        const expected = keys.reduce((total, key, i) => total + i * (probabilities[key] ?? 0), 0);
        // The score may also be rounded. A 2% tolerance of the level range tolerates ordinary
        // rounded probabilities while refusing a score that contradicts its distribution.
        const scoreTolerance = Math.max(1, keys.length - 1) * 0.02 + 1e-9;
        if (Math.abs(answer.score - expected) > scoreTolerance)
          protocolError(`score contradicts probabilities for ${id}`);
      }
    } else if (question.type === "box") {
      const box = answer.box;
      if (
        !record(box) ||
        !["top", "bottom", "left", "right"].every((edge) => probability((box as Record<string, unknown>)[edge]))
      )
        protocolError(`invalid box for ${id}`);
    } else protocolError(`unknown question type for ${id}`);
  }
  if (!record(body.usage)) protocolError("usage must be an object");
  jevReportedCostNanoUsd(body.usage as JevResponseUsage);
  for (const key of ["input_tokens", "output_tokens"]) {
    const value = body.usage[key];
    if (value !== undefined && (!finite(value) || !Number.isInteger(value) || value < 0))
      protocolError(`invalid usage ${key}`);
  }
}

/** OpenCode reports dollars, including an explicit zero for its free variant. Never apply TypeSafe's tariff. */
export function jevReportedCostNanoUsd(usage: JevResponseUsage | undefined): number {
  const cost = usage?.cost;
  if (!finite(cost) || cost < 0) protocolError("OpenCode usage.cost is missing or invalid");
  const nanoUsd = Math.round(cost * 1_000_000_000);
  if (!Number.isSafeInteger(nanoUsd)) protocolError("OpenCode usage.cost is outside the supported range");
  return nanoUsd;
}
