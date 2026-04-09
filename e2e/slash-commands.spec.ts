import { expect, test, type Page } from "@playwright/test";

interface DownmarkTestBridge {
  applyRichCommand(commandId: string): Promise<boolean>;
  applySlashCommand(commandId: string): Promise<boolean>;
  getRawValue(): string;
  getRichHtml(): string;
  insertRichText(text: string): Promise<boolean>;
  selectAllRichText(): Promise<boolean>;
  setMode(mode: "raw" | "rich"): Promise<void>;
  setRawValue(value: string): Promise<void>;
}

function trackPageErrors(page: Page) {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
}

async function openDownmark(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[role="textbox"][aria-label="Rich text editor"]');
  await page.waitForFunction(() => typeof window.__DOWNMARK_TEST__ === "object");
}

function expectNoRuntimeErrors(errors: string[]) {
  const relevantErrors = errors.filter(
    (error) => !error.includes("React DevTools"),
  );
  expect(relevantErrors).toEqual([]);
}

test("titlebar controls remain hit-testable above the drag chrome", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDownmark(page);

  const hitTest = await page.evaluate(() => {
    const rawToggle = [...document.querySelectorAll('[role="radio"]')].find(
      (node) => node.textContent?.trim() === "Raw",
    );

    if (!(rawToggle instanceof HTMLElement)) {
      return null;
    }

    const rect = rawToggle.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );

    return {
      topLabel: top?.textContent?.trim() ?? null,
      topRole: top?.getAttribute("role"),
      matches: top === rawToggle,
    };
  });

  expect(hitTest).toEqual({
    topLabel: "Raw",
    topRole: "radio",
    matches: true,
  });
  expectNoRuntimeErrors(errors);
});

test("slash commands keep the requested block when typing and switching to raw", async ({
  page,
}) => {
  const errors = trackPageErrors(page);
  await openDownmark(page);

  const rawValue = await page.evaluate(async () => {
    const bridge = window.__DOWNMARK_TEST__ as DownmarkTestBridge | undefined;
    if (!bridge) {
      throw new Error("Missing downmark test bridge.");
    }

    await bridge.applySlashCommand("heading-1");
    await bridge.insertRichText("Title");
    await bridge.setMode("raw");
    return bridge.getRawValue();
  });

  await expect(page.getByRole("textbox", { name: "Raw markdown editor" })).toHaveValue(
    "# Title\n\n",
  );
  expect(rawValue).toBe("# Title\n\n");
  expectNoRuntimeErrors(errors);
});

test("bubble formatting survives the switch back to raw", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDownmark(page);

  const rawValue = await page.evaluate(async () => {
    const bridge = window.__DOWNMARK_TEST__ as DownmarkTestBridge | undefined;
    if (!bridge) {
      throw new Error("Missing downmark test bridge.");
    }

    await bridge.insertRichText("Hello");
    await bridge.selectAllRichText();
    await bridge.applyRichCommand("bold");
    await bridge.setMode("raw");
    return bridge.getRawValue();
  });

  await expect(page.getByRole("textbox", { name: "Raw markdown editor" })).toHaveValue(
    "**Hello**",
  );
  expect(rawValue).toBe("**Hello**");
  expectNoRuntimeErrors(errors);
});

test("raw markdown renders cleanly back into the rich editor", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDownmark(page);

  const richHtml = await page.evaluate(async () => {
    const bridge = window.__DOWNMARK_TEST__ as DownmarkTestBridge | undefined;
    if (!bridge) {
      throw new Error("Missing downmark test bridge.");
    }

    await bridge.setRawValue("# Heading\n\n- first\n- second\n\n`inline`");
    await bridge.setMode("rich");
    return bridge.getRichHtml();
  });

  await expect(page.locator(".tiptap h1")).toHaveText("Heading");
  await expect(page.locator(".tiptap li")).toHaveCount(2);
  await expect(page.locator(".tiptap code")).toContainText("inline");
  expect(richHtml).toContain("<h1>Heading</h1>");
  expectNoRuntimeErrors(errors);
});
