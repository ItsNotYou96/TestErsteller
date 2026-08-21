"use client";

import katex from "katex";
import { Fragment, useMemo } from "react";

// Entspricht bewusst weitgehend dem Erkennungsmuster der alten WPF-App:
// klassische TeX-Delimiter, \frac, einzelne TeX-Befehle sowie Potenzen wie x^2.
const TOKEN_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\\frac\{([^}]+)\}\{([^}]+)\}|\b[0-9A-Za-z]+(?:\^[0-9A-Za-z]+)+\b|\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^}]*\})*/g;

type Piece = { kind: "text"; value: string } | { kind: "math"; value: string; display: boolean };

function tokenize(text: string): Piece[] {
  const pieces: Piece[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) pieces.push({ kind: "text", value: text.slice(lastIndex, index) });

    const full = match[0];
    const isDisplay = full.startsWith("$$") || full.startsWith("\\[");
    let formula = full;
    if (full.startsWith("$$") && full.endsWith("$$")) formula = full.slice(2, -2);
    else if (full.startsWith("$") && full.endsWith("$")) formula = full.slice(1, -1);
    else if (full.startsWith("\\(") && full.endsWith("\\)")) formula = full.slice(2, -2);
    else if (full.startsWith("\\[") && full.endsWith("\\]")) formula = full.slice(2, -2);

    pieces.push({ kind: "math", value: formula, display: isDisplay });
    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) pieces.push({ kind: "text", value: text.slice(lastIndex) });
  return pieces.length ? pieces : [{ kind: "text", value: text }];
}

export function LatexText({ text }: { text: string }) {
  const pieces = useMemo(() => tokenize(text || ""), [text]);

  return (
    <span className="latexText">
      {pieces.map((piece, index) => {
        if (piece.kind === "text") return <Fragment key={index}>{piece.value}</Fragment>;

        const html = katex.renderToString(piece.value, {
          throwOnError: false,
          displayMode: piece.display,
          strict: "ignore",
          output: "html",
        });
        return (
          <span
            key={index}
            className={piece.display ? "latexBlock" : "latexInline"}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
