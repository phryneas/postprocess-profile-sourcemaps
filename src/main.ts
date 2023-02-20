#!/usr/bin/env node

import { command, run, positional, string } from "cmd-ts";
import getSource = require("get-source");
import * as fs from "fs";
import type { DurationEvent } from "hermes-profile-transformer/dist/types/EventInterfaces";
import {
  Project,
  SyntaxKind,
  Node,
  FunctionDeclaration,
  FunctionExpression,
  ArrowFunction,
  MethodDeclaration,
} from "ts-morph";

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
        name:
          ev.name !== "anonymous"
            ? ev.name
            : findFunctionName(
                location.sourceFile.path,
                location.sourceFile.text,
                location.line,
                location.column
              ),
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

// -- helpers --

const p = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  skipLoadingLibFiles: true,
});

function findFunctionName(
  fileName: string,
  contents: string,
  line: number,
  column: number
): string {
  const source = p.createSourceFile(fileName, contents, { overwrite: true });

  const found = recursiveFindFunctionName(source);
  if (typeof found == "string") console.log(`found ${found} in ${fileName}:${line}`);
  return typeof found == "string" ? found : "anonymous (not found)";

  function recursiveFindFunctionName(
    node: Node
  ):
    | string
    | FunctionDeclaration
    | FunctionExpression
    | ArrowFunction
    | MethodDeclaration
    | undefined {
    const startLine = node.getStartLineNumber(),
      startPos = node.getStartLinePos(),
      endLine = node.getEndLineNumber();

    if (startLine > line || (startLine == line && startPos > column) || endLine < line) {
      return;
    }

    const bestMatch = node.forEachChild(recursiveFindFunctionName);
    if (typeof bestMatch == "string") {
      if (bestMatch === "anonymous" && "getName" in node && typeof node.getName == "function") {
        const name = node.getName();
        if (name) return `${bestMatch} in ${name}`;
      }
      return bestMatch;
    }
    if (bestMatch) {
      if (node.isKind(SyntaxKind.VariableDeclaration)) {
        return node.getName();
      }
      return "anonymous";
    }

    if (
      node.isKind(SyntaxKind.FunctionDeclaration) ||
      node.isKind(SyntaxKind.FunctionExpression) ||
      node.isKind(SyntaxKind.MethodDeclaration)
    ) {
      return node.getName() || node;
    } else if (node.isKind(SyntaxKind.ArrowFunction)) {
      return node;
    }
  }
}
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
