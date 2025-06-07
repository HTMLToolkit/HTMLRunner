import { State } from "./types";
import { editors } from "./editor";
import { showError, switchTab, switchOutput } from "./ui";
import { runCode } from "./runner";

export const state: State = {
  html: "",
  css: "",
  js: "",
  activeTab: "html",
  activeOutput: "preview",
  splitSizes: [50, 50],
};

export function saveState(): void {
  state.html = editors.html.view.state.doc.toString();
  state.css = editors.css.view.state.doc.toString();
  state.js = editors.js.view.state.doc.toString();
  try {
    localStorage.setItem("htmlRunnerState", JSON.stringify(state));
  } catch (e: any) {
    showError("Failed to save state: " + e.message);
  }
}

export function loadState(): void {
  try {
    const savedState = localStorage.getItem("htmlRunnerState");
    if (savedState) {
      const parsed = JSON.parse(savedState);

      // Validate state properties
      if (typeof parsed.html === "string") {
        editors.html.view.dispatch({
          changes: {
            from: 0,
            to: editors.html.view.state.doc.length,
            insert: parsed.html,
          },
        });
      }
      if (typeof parsed.css === "string") {
        editors.css.view.dispatch({
          changes: {
            from: 0,
            to: editors.css.view.state.doc.length,
            insert: parsed.css,
          },
        });
      }
      if (typeof parsed.js === "string") {
        editors.js.view.dispatch({
          changes: {
            from: 0,
            to: editors.js.view.state.doc.length,
            insert: parsed.js,
          },
        });
      }

      if (["html", "css", "js"].includes(parsed.activeTab)) {
        switchTab(parsed.activeTab);
      }
      if (["preview", "console"].includes(parsed.activeOutput)) {
        switchOutput(parsed.activeOutput);
      }
      if (
        Array.isArray(parsed.splitSizes) &&
        parsed.splitSizes.length === 2 &&
        parsed.splitSizes.every((size: any) => typeof size === "number")
      ) {
        state.splitSizes = parsed.splitSizes;
      }

      runCode();
    } else {
      resetCode(true); // Set default code without confirmation
    }
  } catch (e: any) {
    showError("Failed to load state: " + e.message);
    resetCode(true); // Set default code without confirmation
  }
}

export function resetCode(skipConfirmation: boolean = false): void {
  if (skipConfirmation || confirm("Are you sure you want to reset all code?")) {
    editors.html.view.dispatch({
      changes: {
        from: 0,
        to: editors.html.view.state.doc.length,
        insert: `<!DOCTYPE html>
<html>
<head>
<title>My Page</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<script src="main.js"><\/script>
<h1>Hello, HTMLRunner!</h1>
<p>This is a demo page.</p>
<button onclick="testFunction()">Click me!</button>
<\/body>
<\/html>`,
      },
    });

    editors.css.view.dispatch({
      changes: {
        from: 0,
        to: editors.css.view.state.doc.length,
        insert: `body {
font-family: Arial, sans-serif;
margin: 20px;
line-height: 1.6;
}
button {
background: #2196F3;
color: white;
border: none;
padding: 10px 15px;
border-radius: 4px;
cursor: pointer;
font-size: 16px;
}
button:hover {
background: #1976D2;
}`,
      },
    });

    editors.js.view.dispatch({
      changes: {
        from: 0,
        to: editors.js.view.state.doc.length,
        insert: `function testFunction() {
console.log('Button clicked!');
console.warn('This is a warning');
console.error('This is an error');
console.info('This is an info');
console.log('Object:', { name: 'Alice', age: 25, hobbies: ['coding', 'reading'] });
}`,
      },
    });

    runCode();
    saveState();
  }
}