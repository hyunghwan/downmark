import { useMemo, useState } from "react";
import releaseNotesData from "./generated/release-notes.json";
import type { ReleaseNotesPayload, ReleaseNoteSection } from "./types";

const releaseNotes = releaseNotesData as ReleaseNotesPayload;
const releasesUrl = "https://github.com/hyunghwan/downmark/releases";
const appUrl = "https://github.com/hyunghwan/downmark";

type Route = "/" | "/releasenote" | "404";

interface NavLinkItem {
  href: string;
  label: string;
}

function normalizeRoute(pathname: string): Route {
  if (pathname === "/") {
    return "/";
  }

  if (pathname === "/releasenote") {
    return "/releasenote";
  }

  return "404";
}

function useCurrentRoute() {
  return useMemo(() => normalizeRoute(window.location.pathname), []);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

function formatVersionLabel(version: string) {
  return version === "Unreleased" ? "Latest" : version;
}

function BrandMark() {
  return (
    <a href="/" className="brand-mark" aria-label="Downmark home">
      <img src="/downmark-logo.svg" alt="" />
      <span>Downmark</span>
    </a>
  );
}

function MobileNotice() {
  return (
    <div className="mobile-notice">
      Downmark is available for macOS and Windows. The web preview resets on refresh.
    </div>
  );
}

function MobileNav({ items }: { items: NavLinkItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="mobile-nav">
      <div className="mobile-nav-header">
        <BrandMark />
        <button
          type="button"
          className="mobile-nav-toggle"
          aria-expanded={open}
          aria-label="Toggle navigation"
          onClick={() => setOpen((current) => !current)}
        >
          <span />
          <span />
        </button>
      </div>
      <div className={`mobile-nav-links${open ? " is-open" : ""}`}>
        {items.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function SideNav({
  items,
  currentPath,
  versions,
}: {
  items: NavLinkItem[];
  currentPath: Route;
  versions?: ReleaseNoteSection[];
}) {
  return (
    <nav className="side-nav">
      <div className="side-nav-logo">
        <BrandMark />
      </div>
      <div className="nav-links">
        {items.map((item, index) => {
          const isActive =
            item.href === currentPath ||
            (currentPath === "/" && index === 0) ||
            (currentPath === "/releasenote" && item.href === "/releasenote");

          return (
            <div className="nav-item-wrapper" key={item.href}>
              <a href={item.href} className={`nav-link${isActive ? " active" : ""}`}>
                {item.label}
              </a>
            </div>
          );
        })}
        {versions?.length ? <div className="nav-section">Versions</div> : null}
        {versions?.map((section) => (
          <div className="nav-item-wrapper" key={section.version}>
            <a className="nav-link" href={`#${slugify(section.version)}`}>
              {formatVersionLabel(section.version)}
            </a>
          </div>
        ))}
      </div>
      <div className="nav-meta">
        <a href={appUrl} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span className="nav-dot">·</span>
        <a href="https://byun.design/" target="_blank" rel="noreferrer">
          byun.design
        </a>
      </div>
    </nav>
  );
}

function SectionHeading({ id, title }: { id: string; title: string }) {
  return (
    <div className="section-heading" id={id}>
      <h2>{title}</h2>
      <div />
    </div>
  );
}

function DownloadButtons() {
  return (
    <div className="cta-row">
      <a href={releasesUrl} className="cta-primary" target="_blank" rel="noreferrer">
        Download for macOS
      </a>
      <a href={releasesUrl} className="cta-secondary" target="_blank" rel="noreferrer">
        Download for Windows
      </a>
      <a href="/releasenote" className="cta-tertiary">
        Release notes
      </a>
    </div>
  );
}

function HomePage() {
  return (
    <article className="article home-article">
      <section className="demo-hero" id="overview">
        <div className="embed-shell hero-embed-shell">
          <iframe src="/demo?embed=1" title="Downmark preview" className="demo-embed" />
        </div>
        <div className="hero-copy">
          <h1>Downmark keeps Markdown editing simple.</h1>
          <p className="hero-body">
            A focused editor for macOS and Windows that opens one Markdown file, lets you work in
            Rich or Raw mode, and saves it back as a standard `.md` document.
          </p>
          <div id="download">
            <DownloadButtons />
          </div>
          <p className="hero-note">
            Web preview resets on refresh.
          </p>
        </div>
      </section>

      <section>
        <SectionHeading id="faq" title="FAQ" />
        <div className="faq-list">
          <div>
            <h3>Does the web preview save?</h3>
            <p>No. It resets when you refresh the page.</p>
          </div>
          <div>
            <h3>Which platforms are available?</h3>
            <p>Downmark is available for macOS and Windows.</p>
          </div>
          <div>
            <h3>Where can I download it?</h3>
            <p>Desktop builds are published on GitHub Releases.</p>
          </div>
          <div>
            <h3>Where can I see what's new?</h3>
            <p>Each release is listed on the release notes page.</p>
          </div>
        </div>
      </section>
    </article>
  );
}

function ReleaseNotePage() {
  return (
    <article className="article release-article">
      <header className="release-header">
        <h1>Release notes</h1>
        <p className="release-summary">Updates, fixes, and improvements across recent Downmark releases.</p>
      </header>

      {releaseNotes.sections.map((section) => (
        <section key={section.version} id={slugify(section.version)} className="release-section">
          <div className="section-heading">
            <h2>{formatVersionLabel(section.version)}</h2>
            <div />
          </div>
          {section.date ? <p className="release-date">{formatDate(section.date)}</p> : null}
          {section.categories.length ? (
            section.categories.map((category) => (
              <div className="release-group" key={`${section.version}-${category.title}`}>
                <h3>{category.title}</h3>
                <ul>
                  {category.items.map((item) => (
                    <li key={`${section.version}-${category.title}-${item.hash}`}>
                      <span className="release-text">{item.text}</span>
                      <span className="release-hash">{item.hash}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="release-empty">Updates will appear here.</p>
          )}
        </section>
      ))}
    </article>
  );
}

function NotFoundPage() {
  return (
    <main className="missing-page">
      <BrandMark />
      <h1>Page not found</h1>
      <p>Explore the Downmark overview, preview, and release notes.</p>
      <a href="/">Go back home</a>
    </main>
  );
}

export default function App() {
  const route = useCurrentRoute();

  if (route === "404") {
    return <NotFoundPage />;
  }

  const navItems: NavLinkItem[] = [
    { href: "/#overview", label: "Overview" },
    { href: "/#download", label: "Download" },
    { href: "/#faq", label: "FAQ" },
    { href: "/releasenote", label: "Release notes" },
  ];

  return (
    <>
      <MobileNotice />
      <MobileNav items={navItems} />
      <div className="site-frame">
        <SideNav
          items={navItems}
          currentPath={route}
          versions={route === "/releasenote" ? releaseNotes.sections : undefined}
        />
        <main className="main-content">
          {route === "/" ? <HomePage /> : <ReleaseNotePage />}
          <footer className="page-footer">
            <p>
              Made by{" "}
              <a href="https://byun.design/" target="_blank" rel="noreferrer">
                Hyunghwan Byun
              </a>
            </p>
            <div className="page-footer-links">
              <a href={releasesUrl} target="_blank" rel="noreferrer">
                Download
              </a>
              <a href={appUrl} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </div>
          </footer>
        </main>
      </div>
    </>
  );
}
