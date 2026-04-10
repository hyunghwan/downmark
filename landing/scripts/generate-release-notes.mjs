import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const landingRoot = process.cwd();
const outputPath = resolve(landingRoot, "src/generated/release-notes.json");

function runGit(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: landingRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

const repoRoot = runGit(["rev-parse", "--show-toplevel"], landingRoot);

function repoGit(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function getTags() {
  const output = repoGit(["tag", "--sort=-creatordate"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function getCommits(range) {
  const format = "%h%x09%s";
  const args = ["log", "--no-merges", `--format=${format}`];

  if (range && range !== "HEAD") {
    args.push(range);
  }

  const output = repoGit(args);

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, subject] = line.split("\t");
      return { hash, subject: subject ?? "" };
    });
}

function classifyCommit(subject) {
  const normalized = subject.trim().toLowerCase();

  if (/^(add|initial)\b/.test(normalized)) {
    return "Added";
  }

  if (/^fix\b/.test(normalized)) {
    return "Fixed";
  }

  return "Changed";
}

function toReadableBullet(subject) {
  const trimmed = subject.trim();
  const withoutPrefix = trimmed.replace(/^(add|initial|fix)(\([^)]*\))?[:\-\s]+/i, "");
  const candidate = withoutPrefix || trimmed;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1);
}

function createSection(version, date, commits) {
  const grouped = new Map([
    ["Added", []],
    ["Changed", []],
    ["Fixed", []],
  ]);

  for (const commit of commits) {
    const category = classifyCommit(commit.subject);
    grouped.get(category)?.push({
      hash: commit.hash,
      text: toReadableBullet(commit.subject),
    });
  }

  return {
    version,
    date,
    categories: Array.from(grouped.entries())
      .map(([title, items]) => ({ title, items }))
      .filter((group) => group.items.length > 0),
  };
}

const tags = getTags();
const sections = [];

if (tags.length === 0) {
  sections.push(createSection("Unreleased", null, getCommits("HEAD")));
} else {
  sections.push(createSection("Unreleased", null, getCommits(`${tags[0]}..HEAD`)));

  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const olderTag = tags[index + 1];
    const range = olderTag ? `${olderTag}..${tag}` : tag;
    const date = repoGit(["log", "-1", "--format=%cs", tag], "");
    sections.push(createSection(tag, date || null, getCommits(range)));
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  releaseUrl: "https://github.com/hyunghwan/downmark/releases",
  repositoryUrl: "https://github.com/hyunghwan/downmark",
  sections,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
