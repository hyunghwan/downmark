import React from "react";
import ReactDOM from "react-dom/client";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

async function bootstrap() {
  const isDemoRoute = window.location.pathname === "/demo";

  if (isDemoRoute) {
    const [{ default: DemoAppShell }] = await Promise.all([
      import("./components/DemoAppShell"),
    ]);
    const embedded = new URLSearchParams(window.location.search).get("embed") === "1";

    root.render(
      <React.StrictMode>
        <DemoAppShell embedded={embedded} />
      </React.StrictMode>,
    );
    return;
  }

  await import("./styles.css");
  const { default: App } = await import("./App");

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
