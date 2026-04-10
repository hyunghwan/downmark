import { afterEach, describe, expect, it } from "vitest";

import { MarkdownGateway } from "./markdown-gateway";

const samples = [
  "# Heading\n\nParagraph with **bold** and _italic_.",
  "- one\n- two\n\n1. alpha\n2. beta",
  "- [ ] todo\n- [x] done",
  "> quoted line\n\n---\n\n`inline`",
  "```ts\nconsole.log('downmark')\n```",
  "[OpenAI](https://openai.com)\n\n## Nested\n\n- item with **bold**",
  "![diagram](diagram.png)",
  "| Name | Value |\n| --- | ---: |\n| Alpha | 1 |\n| Beta | 2 |",
];

describe("markdown gateway", () => {
  const gateways: MarkdownGateway[] = [];

  afterEach(() => {
    while (gateways.length) {
      gateways.pop()?.destroy();
    }
  });

  it("round-trips supported markdown into stable markdown", () => {
    const gateway = new MarkdownGateway();
    gateways.push(gateway);

    for (const sample of samples) {
      const rich = gateway.toRich(sample);
      const serialized = gateway.fromRich(rich);
      const serializedAgain = gateway.fromRich(gateway.toRich(serialized));

      expect(serializedAgain).toBe(serialized);
      expect(serialized.length).toBeGreaterThan(0);
    }
  });

  it("normalizes CRLF into LF for in-memory editing", () => {
    const gateway = new MarkdownGateway();
    gateways.push(gateway);

    const normalized = gateway.normalize("# Hello\r\n\r\nBody", { newlineStyle: "lf" });
    const crlf = gateway.normalize("# Hello\n\nBody", { newlineStyle: "crlf" });

    expect(normalized).toBe("# Hello\n\nBody");
    expect(crlf).toBe("# Hello\r\n\r\nBody");
  });
});
