/** Manual, synthetic rendering fixture. No server, credentials or workspace data. */
import { Avatar, PixelSky } from "@agenteschat/ui";
import "@agenteschat/ui/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const names = Array.from({ length: 24 }, (_, i) => `Agent ${i + 1}`);

function Fixture() {
  const [clicks, setClicks] = useState(0);
  return (
    <main>
      <h1>Lightweight mode rendering fixture</h1>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Clicks: {clicks}
      </button>
      <div style={{ position: "relative", height: 360, overflow: "hidden" }}>
        <PixelSky
          options={{
            palette: ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa"],
            base: (u, v, t) => 0.5 + Math.sin(u * 6 + v * 4 + t) * 0.4,
            sprites: 20,
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 16 }}>
        {names.map((name) => (
          <div key={name}>
            <Avatar kind="agent" name={name} size="lg" state="thinking" />
            <span>{name}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
