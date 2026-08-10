import type { FormatId, LyricsDocument } from "../../types";

const lysAgentIds = ["v1", "v2"];

export function checkLysAgents(
  doc: LyricsDocument,
  format: Extract<FormatId, "lqe" | "lys">
): void {
  const references = new Set(
    doc.lines.flatMap((line) => (line.agent === null ? [] : [line.agent]))
  );
  const expectedIds = lysAgentIds.filter((id) => references.has(id));
  if (
    references.size !== expectedIds.length ||
    doc.agents.length !== expectedIds.length ||
    doc.agents.some(
      (agent, index) =>
        agent.id !== expectedIds[index] || agent.type !== "person"
    )
  ) {
    throw new Error(
      `${format} requires referenced v1 and v2 person agents in canonical order`
    );
  }
}
