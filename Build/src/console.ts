import { ConsoleMessage, StackInfo } from './types';
import { editors } from './editor';

export const consoleOutput = document.getElementById('console') as HTMLDivElement;

// Console interceptor code that will be injected into the preview iframe
export const consoleInterceptor = `
    const originalConsole = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    function sendToConsole(level, ...args) {
        window.parent.postMessage({ type: 'console', level, data: args, timestamp: new Date().toISOString() }, '*');
        originalConsole[level].apply(console, args);
    }
    console.log = (...args) => sendToConsole('log', ...args);
    console.error = (...args) => sendToConsole('error', ...args);
    console.warn = (...args) => sendToConsole('warn', ...args);
    console.info = (...args) => sendToConsole('info', ...args);
    window.onerror = (message, source, lineno, colno, error) => {
        sendToConsole('error', error || message, { stack: error?.stack });
        return true;
    };
    window.onunhandledrejection = (event) => {
        sendToConsole('error', event.reason, { stack: event.reason?.stack });
    };
`;

// Initialize console message handler
export function initializeConsole(): void {
    window.addEventListener('message', handleConsoleMessage);
}

function handleConsoleMessage(event: MessageEvent<ConsoleMessage>): void {
    if (event.data.type === 'console') {
        const entry = document.createElement('div');
        entry.className = 'console-entry';
        const timestamp = document.createElement('span');
        timestamp.className = 'timestamp';
        timestamp.textContent = new Date(event.data.timestamp).toLocaleTimeString();
        const message = document.createElement('span');
        message.className = `console-${event.data.level}`;
        if (event.data.data && event.data.data.length) {
            event.data.data.forEach((item: any, i: number) => {
                if (i > 0) message.appendChild(document.createTextNode(' '));
                if (item && typeof item === 'object') {
                    message.appendChild(renderObject(item));
                } else {
                    message.appendChild(document.createTextNode(String(item)));
                }
            });
        }
        if (event.data.data[1]?.stack) {
            const stack = document.createElement('div');
            stack.className = 'console-stack';
            const rawStack: string = event.data.data[1].stack;
            // Render each stack line as a clickable element when possible
            rawStack.split('\n').forEach((line) => {
                const lineEl = document.createElement('div');
                lineEl.className = 'console-stack-line';
                lineEl.textContent = line.trim();
                // Try to parse ":line:col" at end of line
                const m = line.match(/:(\d+):(\d+)\)?$/);
                if (m) {
                    const lineNum = parseInt(m[1], 10);
                    const colNum = parseInt(m[2], 10);
                    lineEl.classList.add('clickable');
                    lineEl.addEventListener('click', () => {
                        // Focus JS editor if available and set cursor
                        const ed = editors.js;
                        if (!ed) return;
                        const doc = ed.view.state.doc;
                        const maxLine = doc.lines;
                        const safeLine = Math.max(1, Math.min(lineNum, maxLine));
                        const lineObj = doc.line(safeLine);
                        const offset = Math.min(lineObj.to, lineObj.from + Math.max(0, colNum - 1));
                        ed.view.dispatch({ selection: { anchor: offset } });
                        ed.view.focus();
                    });
                }
                stack.appendChild(lineEl);
            });
            stack.addEventListener('click', (e) => { if (e.target === stack) stack.classList.toggle('expanded'); });
            message.appendChild(stack);
        }
        entry.appendChild(timestamp);
        entry.appendChild(document.createTextNode(' '));
        entry.appendChild(message);
        consoleOutput.appendChild(entry);
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
}

function renderObject(obj: any, level = 0, visited = new WeakSet()): Node {
    if (obj === null) return document.createTextNode('null');
    if (typeof obj !== 'object') return document.createTextNode(String(obj));
    if (visited.has(obj)) return document.createTextNode('[Circular]');
    if (level > 3) return document.createTextNode('[...]');
    visited.add(obj);

    const container = document.createElement('span');
    if (obj instanceof Error) {
        const errorEl = document.createElement('span');
        errorEl.className = 'console-error';
        errorEl.textContent = `${obj.name}: ${obj.message}`;
        if (obj.stack) errorEl.textContent += `\n${obj.stack.split('\n').slice(1).join('\n')}`;
        container.appendChild(errorEl);
        return container;
    }

    const preview = document.createElement('span');
    preview.className = 'console-object';
    preview.textContent = Array.isArray(obj) ? `Array(${obj.length})` : '{...}';
    const content = document.createElement('div');
    content.className = 'console-object-content';

    Object.entries(obj).forEach(([key, value]) => {
        const prop = document.createElement('div');
        prop.textContent = `${key}: `;
        prop.appendChild(renderObject(value, level + 1, visited));
        content.appendChild(prop);
    });

    preview.addEventListener('click', (e) => {
        e.stopPropagation();
        preview.classList.toggle('expanded');
    });

    container.appendChild(preview);
    container.appendChild(content);
    return container;
}

export function clearConsole(): void {
    consoleOutput.innerHTML = '';
}

export function logConsoleError(message: string, stack: StackInfo = {}): void {
    const entry = document.createElement('div');
    entry.className = 'console-entry';
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = new Date().toLocaleTimeString();
    const msg = document.createElement('span');
    msg.className = 'console-error';
    msg.textContent = message;
    if (stack.stack) {
        const stackEl = document.createElement('div');
        stackEl.className = 'console-stack';
        stackEl.textContent = stack.stack;
        stackEl.addEventListener('click', () => stackEl.classList.toggle('expanded'));
        msg.appendChild(stackEl);
    }
    entry.appendChild(timestamp);
    entry.appendChild(document.createTextNode(' '));
    entry.appendChild(msg);
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
