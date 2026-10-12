import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { TerminalTab } from '../types';

interface TerminalViewProps {
  tab: TerminalTab;
  active: boolean;
  onExit?: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ tab, active, onExit }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);

  const safeFit = () => {
    if (!terminalRef.current || !fitAddonInstance.current || !xtermInstance.current) return;
    const { clientWidth, clientHeight } = terminalRef.current;
    if (clientWidth > 100 && clientHeight > 100) {
      try {
        fitAddonInstance.current.fit();
        const cols = xtermInstance.current.cols;
        const rows = xtermInstance.current.rows;

        if (tab.type === 'local') {
          invoke('pty_resize', { sessionId: tab.sessionId, cols, rows }).catch(() => {});
        } else if (tab.type === 'ssh') {
          invoke('ssh_resize', { sessionId: tab.sessionId, cols, rows }).catch(() => {});
        }
      } catch (err) {
        console.warn('safeFit error:', err);
      }
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: 'Cascadia Code, Consolas, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
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
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);

    // Hardware accelerated WebGL renderer with graceful fallback
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // Fallback to default canvas/DOM
    }

    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;

    // Send user keystrokes to backend
    term.onData((data) => {
      if (tab.type === 'local') {
        invoke('pty_write', { sessionId: tab.sessionId, data }).catch(console.error);
      } else if (tab.type === 'ssh') {
        invoke('ssh_write', { sessionId: tab.sessionId, data }).catch(console.error);
      }
    });

    // Listen to incoming streaming data from Rust backend
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
      term.writeln('\r\n\x1b[33;1m[Session closed]\x1b[0m\r\n');
      if (onExit) onExit();
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    // Handle container resize
    const resizeObserver = new ResizeObserver(() => {
      safeFit();
    });
    resizeObserver.observe(terminalRef.current);

    // Initial fits
    requestAnimationFrame(safeFit);
    const timer1 = setTimeout(safeFit, 50);
    const timer2 = setTimeout(safeFit, 200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      resizeObserver.disconnect();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      term.dispose();
    };
  }, [tab.id, tab.sessionId, tab.type]);

  // When tab becomes active, trigger fit and focus
  useEffect(() => {
    if (active && xtermInstance.current) {
      safeFit();
      xtermInstance.current.focus();
    }
  }, [active]);

  return (
    <div
      className="w-full h-full bg-[#0d1117] relative flex flex-col min-h-0 min-w-0 overflow-hidden"
      onClick={() => xtermInstance.current?.focus()}
    >
      <div ref={terminalRef} className="flex-1 w-full h-full min-h-0 min-w-0 overflow-hidden" />
    </div>
  );
};
