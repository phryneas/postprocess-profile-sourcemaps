import { command, run, positional, string } from "cmd-ts";
import getSource = require("get-source");
import * as fs from "fs";
import type { DurationEvent } from "hermes-profile-transformer/dist/types/EventInterfaces";

const app = command({
  name: "@phryneas/process-profile-sourcemaps",
  description: "a tool to postprocess sourcemap references in a chrome profile",
  args: {
    file: positional({ type: string, displayName: "file" }),
    target: positional({ type: string, displayName: "target" }),
  },
  handler: ({ file, target }) => {
    const contents = fs.readFileSync(file, { encoding: "utf-8" });
    const parsed: DurationEvent[] = JSON.parse(contents);
    const updated = parsed.map((ev) => {
      if (!hasSource(ev)) return ev;

      const realSource = getSource(ev.args.url);
      if (realSource.error) return ev;

      const location = realSource.resolve({ column: ev.args.column, line: ev.args.line });
      return {
        ...ev,
        args: {
          ...ev.args,
          url: location.sourceFile.path,
          column: location.column,
          line: location.line,
          sourceLine: location.sourceLine,
        },
      };
    });

    fs.writeFileSync(target, JSON.stringify(updated), { encoding: "utf-8" });
  },
});

run(app, process.argv.slice(2));

interface EventArgsWithSource {
  line: number;
  column: number;
  url: string;
}

function hasSource(
  e: DurationEvent
): e is Omit<DurationEvent, "args"> & { args: EventArgsWithSource } {
  return (
    !!e.args &&
    typeof e.args.line == "number" &&
    typeof e.args.column == "number" &&
    typeof e.args.url == "string"
  );
}
