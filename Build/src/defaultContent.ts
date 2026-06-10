import type { FileTab } from "./types";

export const defaultHtml = `<!DOCTYPE html>
<html>
<head>
<title>My Page</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<script src="script.js"></script>
<h1>Hello, HTMLRunner!</h1>
<p>This is a demo page.</p>
<button onclick="testFunction()">Click me!</button>
</body>
</html>`;

export const defaultCss = `body {
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
}`;

export const defaultJs = `function testFunction() {
console.log('Button clicked!');
console.warn('This is a warning');
console.error('This is an error');
console.info('This is an info');
console.log('Object:', { name: 'Alice', age: 25, hobbies: ['coding', 'reading'] });
}`;

export function getDefaultFiles(): FileTab[] {
  return [
    { id: "index.html", name: "index.html", content: defaultHtml, language: "html" },
    { id: "styles.css", name: "styles.css", content: defaultCss, language: "css" },
    { id: "script.js", name: "script.js", content: defaultJs, language: "javascript" },
  ];
}

const TEMPLATES: Record<string, string> = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>

</body>
</html>`,
  css: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, sans-serif;
  line-height: 1.6;
  color: #333;
  padding: 20px;
}`,
  js: `'use strict';

`,
  ts: `export {};\n`,
  json: `{\n  \n}\n`,
};

export function getTemplateForExt(ext: string): string {
  return TEMPLATES[ext] ?? "";
}

export function getLanguageForExt(ext: string): string {
  switch (ext) {
    case "html": case "htm": return "html";
    case "css": return "css";
    case "js": case "mjs": case "cjs": case "jsx": case "ts": case "tsx": return "javascript";
    case "json": return "javascript";
    default: return "javascript";
  }
}
