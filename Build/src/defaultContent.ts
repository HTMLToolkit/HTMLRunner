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
