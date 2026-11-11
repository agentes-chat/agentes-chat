// Bundled with the Windows app so older servers and the loading cover also have controls.
(() => {
  if (window.top !== window) return;

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      const invoke = (action) => window.__TAURI_INTERNALS__.invoke("main_window_action", { action });
      const host = document.createElement("agentes-window-controls");
      const shadow = host.attachShadow({ mode: "closed" });

      // Constructed stylesheets keep working on servers that block inline styles with CSP.
      const layout = new CSSStyleSheet();
      layout.replaceSync(`
      html:not([data-fullscreen]) .titlebar {
        --window-controls-space: calc(138px / var(--app-zoom, 1));
        padding-right: var(--window-controls-space);
      }
      html:not([data-fullscreen]) .titlebar__search {
        /* Center on the window, clamping to the space between navigation and window controls. */
        --titlebar-offset: calc(
          (var(--window-controls-space) - var(--titlebar-lights) - var(--titlebar-nav) - 12px) / 2
        );
        transform: translateX(clamp(
          calc(-1 * var(--titlebar-room)),
          var(--titlebar-offset),
          var(--titlebar-room)
        ));
      }
      html:has(.titlebar) > body > agentes-window-controls {
        --window-drag-display: none;
      }
      html[data-fullscreen] > body > agentes-window-controls {
        display: none;
      }
      body:has(> .cover) > agentes-window-controls {
        --window-controls-color: white;
      }
    `);
      document.adoptedStyleSheets.push(layout);

      const styles = new CSSStyleSheet();
      styles.replaceSync(`
      :host {
        position: fixed;
        top: 0;
        right: 0;
        z-index: 60;
        display: flex;
        height: calc(40px / var(--app-zoom, 1));
        color: var(--window-controls-color, var(--muted, inherit));
        user-select: none;
      }
      .drag {
        display: var(--window-drag-display, block);
        width: calc(48px / var(--app-zoom, 1));
      }
      button {
        display: grid;
        place-items: center;
        width: calc(42px / var(--app-zoom, 1));
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: default;
      }
      button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
      button:focus-visible { outline-offset: -3px; }
      button:last-child:hover { color: white; background: #c42b1c; }
      svg {
        width: calc(12px / var(--app-zoom, 1));
        height: calc(12px / var(--app-zoom, 1));
        fill: none;
        stroke: currentColor;
      }
    `);
      shadow.adoptedStyleSheets = [styles];

      const drag = document.createElement("div");
      drag.className = "drag";
      drag.addEventListener("mousedown", (event) => {
        if (event.button === 0 && event.detail === 1) {
          window.__TAURI_INTERNALS__.invoke("plugin:window|start_dragging").catch(console.error);
        }
      });
      drag.addEventListener("dblclick", () => run("toggleMaximize"));
      shadow.append(drag);

      const icons = {
        minimize: "M2 6h8",
        maximize: "M2 2h8v8H2z",
        restore: "M1.5 4.5h6v6h-6zM4.5 4.5v-3h6v6h-3",
        close: "m2 2 8 8m0-8-8 8",
      };
      const labels = {
        en: { minimize: "Minimize", maximize: "Maximize", restore: "Restore", close: "Close" },
        pt: { minimize: "Minimizar", maximize: "Maximizar", restore: "Restaurar", close: "Fechar" },
      };
      function setButton(button, name) {
        const language = document.documentElement.lang || navigator.language;
        const label = (language.toLowerCase().startsWith("pt") ? labels.pt : labels.en)[name];
        button.title = label;
        button.setAttribute("aria-label", label);
        button.querySelector("path").setAttribute("d", icons[name]);
      }

      function addButton(action, name) {
        const button = document.createElement("button");
        button.type = "button";
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("aria-hidden", "true");
        svg.append(document.createElementNS(svg.namespaceURI, "path"));
        button.append(svg);
        setButton(button, name);
        button.addEventListener("click", () => run(action));
        shadow.append(button);
        return button;
      }

      async function syncMaximize() {
        setButton(maximize, (await invoke("isMaximized")) ? "restore" : "maximize");
      }

      async function run(action) {
        try {
          await invoke(action);
          if (action === "toggleMaximize") await syncMaximize();
        } catch (error) {
          console.error(error);
        }
      }

      addButton("minimize", "minimize");
      const maximize = addButton("toggleMaximize", "maximize");
      addButton("close", "close");
      document.body.append(host);
      syncMaximize().catch(console.error);
      window.addEventListener("resize", () => syncMaximize().catch(console.error));
    },
    { once: true },
  );
})();
