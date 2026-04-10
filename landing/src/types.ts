export interface ReleaseNoteItem {
  hash: string;
  text: string;
}

export interface ReleaseNoteCategory {
  title: "Added" | "Changed" | "Fixed";
  items: ReleaseNoteItem[];
}

export interface ReleaseNoteSection {
  version: string;
  date: string | null;
  categories: ReleaseNoteCategory[];
}

export interface ReleaseNotesPayload {
  generatedAt: string;
  releaseUrl: string;
  repositoryUrl: string;
  sections: ReleaseNoteSection[];
}
