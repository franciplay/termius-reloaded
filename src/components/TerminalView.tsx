import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TerminalTab } from '../types';

interface TerminalViewProps {
  tab: TerminalTab;
  onExit?: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, onExit }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: 'Cascadia Code, Consolas, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selectionBackground: '#388bfd33',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);

    // Try loading WebGL addon for hardware acceleration
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Fallback to canvas/DOM rendering
    }

    fitAddon.fit();
    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;

    // Send keystrokes to Rust backend
    term.onData((data) => {
      if (tab.type === 'local') {
        invoke('pty_write', { sessionId: tab.sessionId, data }).catch(console.error);
      } else if (tab.type === 'ssh') {
        invoke('ssh_write', { sessionId: tab.sessionId, data }).catch(console.error);
      }
    });

    // Handle terminal resize
    const handleResize = () => {
      if (!fitAddonInstance.current || !xtermInstance.current) return;
      try {
        fitAddonInstance.current.fit();
        const cols = term.cols;
        const rows = term.rows;

        if (tab.type === 'local') {
          invoke('pty_resize', { sessionId: tab.sessionId, cols, rows }).catch(console.error);
        } else if (tab.type === 'ssh') {
          invoke('ssh_resize', { sessionId: tab.sessionId, cols, rows }).catch(console.error);
        }
      } catch (err) {
        console.warn('Resize error:', err);
      }
    };

    // Listen to data from backend
    const eventName = tab.type === 'local' ? `pty-data-${tab.sessionId}` : `ssh-data-${tab.sessionId}`;
    const exitEvent = tab.type === 'local' ? `pty-exit-${tab.sessionId}` : `ssh-exit-${tab.sessionId}`;

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    listen<string>(eventName, (event) => {
      term.write(event.payload);
    }).then((unlisten) => {
      unlistenData = unlisten;
    });

    listen(exitEvent, () => {
      term.writeln('\r\n\x1b[33m[Session disconnected]\x1b[0m');
      if (onExit) onExit();
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    // Handle container resize observer
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(terminalRef.current);

    // Initial resize trigger after DOM layout
    setTimeout(handleResize, 100);

    return () => {
      resizeObserver.disconnect();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      term.dispose();
    };
  }, [tab.id, tab.sessionId, tab.type]);

  return (
    <div className="w-full h-full bg-[#0d1117] relative flex flex-col overflow-hidden">
      <div ref={terminalRef} className="flex-1 w-full h-full overflow-hidden" />
    </div>
  );
};
