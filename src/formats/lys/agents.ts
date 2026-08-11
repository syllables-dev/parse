import type { LyricsDocument, LyricsLine } from "../../types";

export function* lysSideLines(
  doc: LyricsDocument
): Generator<[LyricsLine, number]> {
  const agentTypes = new Map(doc.agents.map((agent) => [agent.id, agent.type]));
  let previousPerson: string | undefined;
  let runningSide = 0;

  for (const line of doc.lines) {
    if (line.agent === null) {
      yield [line, runningSide];
      continue;
    }
    const type = agentTypes.get(line.agent);
    if (type === undefined) {
      throw new Error(`line ${line.id} references an undeclared lys agent`);
    }
    switch (type) {
      case "person":
        if (previousPerson === undefined) {
          runningSide = 1;
        } else if (line.agent !== previousPerson) {
          runningSide = runningSide === 1 ? 2 : 1;
        }
        previousPerson = line.agent;
        yield [line, runningSide];
        continue;
      case "group":
        yield [line, 1];
        continue;
      case "other":
        yield [line, 2];
        continue;
      default:
        yield [line, runningSide];
    }
  }
}
