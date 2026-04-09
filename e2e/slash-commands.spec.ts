import { expect, test } from "@playwright/test";

test("mouse-selected slash heading stays formatted when typing and switching to raw", async ({
  page,
}) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "Rich text editor" });
  await editor.click();
  await editor.type("/hea");

  await page.getByRole("button", { name: /Heading 1/i }).click();
  await editor.type("Title");

  await expect(page.locator(".tiptap h1")).toHaveText("Title");

  await page.getByRole("radio", { name: "Raw" }).click();
  await expect(
    page.getByRole("textbox", { name: "Raw markdown editor" }),
  ).toHaveValue("# Title\n\n");
});

test("keyboard-selected slash heading keeps the requested block type", async ({
  page,
}) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "Rich text editor" });
  await editor.click();
  await editor.type("/hea");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await editor.type("Subtitle");

  await expect(page.locator(".tiptap h2")).toHaveText("Subtitle");

  await page.getByRole("radio", { name: "Raw" }).click();
  await expect(
    page.getByRole("textbox", { name: "Raw markdown editor" }),
  ).toHaveValue("## Subtitle\n\n");
});
