import { useState } from "react";
import DownmarkApp, { type AppDependencies } from "../downmark-app/App";
import "../downmark-app/styles.css";
import "./DemoAppShell.css";
import { createBrowserDemoDependencies } from "../demo/createBrowserDemoDependencies";

interface DemoAppShellProps {
  embedded?: boolean;
}

export default function DemoAppShell({ embedded = false }: DemoAppShellProps) {
  const [dependencies] = useState<AppDependencies>(() => createBrowserDemoDependencies());

  return (
    <div className={`downmark-demo-shell${embedded ? " is-embedded" : ""}`}>
      <div className="demo-window">
        <div aria-hidden="true" className="demo-traffic-lights">
          <span className="red" />
          <span className="yellow" />
          <span className="green" />
        </div>
        <DownmarkApp dependencies={dependencies} />
      </div>
    </div>
  );
}
