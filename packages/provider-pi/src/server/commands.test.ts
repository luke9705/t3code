import { expect, it } from "@effect/vitest";

import { parsePiDiscoveredCommands } from "./commands.ts";

it("maps current Pi skill metadata to T3's user and project skill scopes", () => {
  expect(
    parsePiDiscoveredCommands({
      commands: [
        {
          name: "skill:global-review",
          description: "Review changes.",
          source: "skill",
          sourceInfo: {
            path: "/home/test/.agents/skills/global-review/SKILL.md",
            scope: "user",
          },
        },
        {
          name: "skill:project-deploy",
          description: "Deploy this project.",
          source: "skill",
          sourceInfo: {
            path: "/workspace/.agents/skills/project-deploy/SKILL.md",
            scope: "project",
          },
        },
        { name: "hello", description: "Say hello.", source: "extension" },
        { name: "track-journal", source: "extension" },
        { name: "move", source: "extension" },
        { name: "t3-track-journal", source: "extension" },
        { name: "t3-stop-delegate", source: "extension" },
        { name: "t3-service-tier", source: "extension" },
        { name: "review", description: "Review template.", source: "prompt" },
      ],
    }),
  ).toEqual({
    skills: [
      {
        name: "global-review",
        description: "Review changes.",
        path: "/home/test/.agents/skills/global-review/SKILL.md",
        scope: "user",
        enabled: true,
      },
      {
        name: "project-deploy",
        description: "Deploy this project.",
        path: "/workspace/.agents/skills/project-deploy/SKILL.md",
        scope: "project",
        enabled: true,
      },
    ],
    slashCommands: [
      { name: "hello", description: "Say hello." },
      { name: "track-journal" },
      {
        name: "move",
        description: "Move this Pi conversation to another registered T3 project",
        input: { hint: "Destination project directory" },
      },
      { name: "review", description: "Review template.", inline: true },
    ],
  });
});
