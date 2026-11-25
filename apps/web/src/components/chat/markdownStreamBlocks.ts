import { githubHeadingSlug } from "./markdownFragments";

// Definitions, footnotes, raw HTML, container directives and display math can tie blocks together.
const DOCUMENT_WIDE_SYNTAX = /^ {0,3}(?:\[[^\]\n]+\]:|<[A-Za-z!?/]|:::|\$\$)|\[\^/m;
// A backtick fence's info string cannot contain a backtick, so "```a``` is inline" is a code span.
const FENCE_PATTERN = /^ {0,3}(`{3,}(?![^`\n]*`)|~{3,})/;
// After a blank line these still continue the previous block: a list item or indented content.
const CONTINUATION_PATTERN = /^(?:[ \t]|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$))/;
// Claude insight fences render as one callout, so they stay in one block until the closing rule.
const INSIGHT_OPEN_PATTERN = /^( {0,3})(`?)★ Insight[ \t]+─{3,}\2[ \t]*$/u;
const INSIGHT_CLOSE_PATTERN = /^( {0,3})(`?)─{3,}\2[ \t]*$/u;
// An ATX heading, also inside a list item or blockquote; group 1 is its text.
const ATX_HEADING_PATTERN =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
// Setext headings may span a paragraph and containers, so leave their parsing to the renderer.
const SETEXT_UNDERLINE_PATTERN =
  /^(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*(?:=+|-+)[ \t]*$/;

type Scan = {
  offset: number;
  blockStart: number;
  settled: readonly string[];
  fence: string | null;
  fenceIndent: number;
  afterBlankLine: boolean;
  insightIndent: string | null;
  headingKeys: ReadonlySet<string>;
  afterContentLine: boolean;
  uncertainFence: boolean;
};

export type MarkdownStreamState = {
  text: string;
  completeLines: Scan | null;
  blocks: readonly string[] | null;
};

const EMPTY_SCAN: Scan = {
  offset: 0,
  blockStart: 0,
  settled: [],
  fence: null,
  fenceIndent: 0,
  afterBlankLine: false,
  insightIndent: null,
  headingKeys: new Set(),
  afterContentLine: false,
  uncertainFence: false,
};

function scanLines(text: string, start: Scan, end: number): Scan | null {
  const scan = { ...start };
  let addedHeadings: Set<string> | undefined;
  let addedBlocks: string[] | undefined;
  while (scan.offset < end) {
    const lineStart = scan.offset;
    const newline = text.indexOf("\n", lineStart);
    const line = text.slice(lineStart, newline === -1 ? end : newline);
    scan.offset = newline === -1 ? end : newline + 1;
    if (line.includes("\r") || DOCUMENT_WIDE_SYNTAX.test(line)) return null;

    const opener = FENCE_PATTERN.exec(line)?.[1];
    if (scan.fence !== null && /\S/.test(line.slice(0, scan.fenceIndent))) {
      // A dedent can end the list containing a fence. Stop splitting but keep checking headings.
      scan.uncertainFence = true;
    }
    const mayUnderline = scan.afterContentLine || scan.uncertainFence;
    scan.afterContentLine = false;
    if (scan.fence !== null && !scan.uncertainFence) {
      if (
        opener &&
        opener[0] === scan.fence[0] &&
        opener.length >= scan.fence.length &&
        line.trim() === opener
      ) {
        scan.fence = null;
      }
      continue;
    }
    if (!scan.uncertainFence) {
      if (
        scan.insightIndent !== null &&
        INSIGHT_CLOSE_PATTERN.exec(line)?.[1] === scan.insightIndent
      ) {
        scan.insightIndent = null;
        scan.afterBlankLine = false;
        continue;
      }
      if (line.trim() === "") {
        scan.afterBlankLine = true;
        continue;
      }
    }
    if (mayUnderline && SETEXT_UNDERLINE_PATTERN.test(line)) return null;
    const heading = ATX_HEADING_PATTERN.exec(line)?.[1];
    if (heading !== undefined) {
      // Inline syntax and path/directive colons need the renderer before their slug is known.
      if (/[`*_~[\]<&\\!$]|:(?!\s|$)/.test(heading)) return null;
      const key = githubHeadingSlug(heading);
      if (key) {
        if (scan.headingKeys.has(key) || addedHeadings?.has(key)) return null;
        (addedHeadings ??= new Set()).add(key);
      }
    }
    if (scan.uncertainFence) continue;
    scan.afterContentLine = opener === undefined;
    if (
      scan.afterBlankLine &&
      scan.insightIndent === null &&
      lineStart > scan.blockStart &&
      !CONTINUATION_PATTERN.test(line)
    ) {
      (addedBlocks ??= []).push(text.slice(scan.blockStart, lineStart));
      scan.blockStart = lineStart;
    }
    scan.afterBlankLine = false;
    if (scan.insightIndent === null)
      scan.insightIndent = INSIGHT_OPEN_PATTERN.exec(line)?.[1] ?? null;
    scan.fence = opener ?? null;
    if (opener) scan.fenceIndent = line.indexOf(opener);
  }
  if (addedHeadings) scan.headingKeys = new Set([...scan.headingKeys, ...addedHeadings]);
  if (addedBlocks) scan.settled = [...scan.settled, ...addedBlocks];
  return scan;
}

/** Checkpoint only complete lines: a partial heading, fence or definition may change on append. */
export function advanceMarkdownStream(
  text: string,
  previous?: MarkdownStreamState,
): MarkdownStreamState {
  if (previous?.text === text) return previous;
  // A document-wide opener on the first line needs no append check.
  const firstNewline = previous?.completeLines === null ? text.indexOf("\n") : -1;
  if (firstNewline !== -1 && DOCUMENT_WIDE_SYNTAX.test(text.slice(0, firstNewline))) {
    return { text, completeLines: null, blocks: null };
  }
  const append = previous !== undefined && text.startsWith(previous.text);
  const start = append ? previous.completeLines : EMPTY_SCAN;
  const end = text.lastIndexOf("\n") + 1;
  const completeLines =
    start === null || text.startsWith("\ufeff")
      ? null
      : end === start.offset
        ? start
        : scanLines(text, start, end);
  const preview =
    completeLines === null || end === text.length
      ? completeLines
      : scanLines(text, completeLines, text.length);
  return {
    text,
    completeLines,
    blocks:
      preview && (append || previous === undefined)
        ? [...preview.settled, text.slice(preview.blockStart)]
        : null,
  };
}

export function splitMarkdownBlocks(text: string): readonly string[] | null {
  return advanceMarkdownStream(text).blocks;
}
