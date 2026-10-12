import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css'; // FIX: required, without it the terminal collapses
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Search, Copy, RotateCcw, Maximize2, Minimize2, ChevronUp, ChevronDown, X, Zap, Check } from 'lucide-react';
import { TerminalTab } from '../types';

interface TerminalViewProps {
  tab: TerminalTab;
  active: boolean;
  onExit?: () => void;
  onSplitToggle?: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  tab,
  active,
  onExit,
  onSplitToggle,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const searchAddonInstance = useRef<SearchAddon | null>(null);

  // Keep latest props in refs so the main effect doesn't depend on them
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const searchQueryRef = useRef('');

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [isWebglAccelerated, setIsWebglAccelerated] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ col: 1, row: 1 });
  const [size, setSize] = useState({ cols: 0, rows: 0 });
  const [connected, setConnected] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sendResize = useCallback((cols: number, rows: number) => {
    const { type, sessionId } = tabRef.current;
    const cmd = type === 'local' ? 'pty_resize' : type === 'ssh' ? 'ssh_resize' : null;
    if (cmd) invoke(cmd, { sessionId, cols, rows }).catch(() => {});
  }, []);

  const safeFit = useCallback(() => {
    const el = terminalRef.current;
    const term = xtermInstance.current;
    const fit = fitAddonInstance.current;
    if (!el || !term || !fit) return;
    // FIX: only skip when truly hidden (0 size), not under 60px
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    try {
      fit.fit();
      sendResize(term.cols, term.rows);
      setSize({ cols: term.cols, rows: term.rows });
    } catch (err) {
      console.warn('safeFit error:', err);
    }
  }, [sendResize]);

  useEffect(() => {
    if (!terminalRef.current) return;
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Monaco, Consolas, monospace',
      lineHeight: 1.25,
      letterSpacing: 0.2,
      theme: {
        background: '#0d0e13',
        foreground: '#d4d8e8',
        cursor: '#38bdf8',
        cursorAccent: '#0d0e13',
        selectionBackground: 'rgba(59, 130, 246, 0.35)',
        black: '#12141c',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
      scrollback: 15000,
      // FIX: convertEol removed, a real PTY already emits \r\n
      allowProposedApi: true,
      smoothScrollDuration: 100,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const unicodeAddon = new Unicode11Addon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    term.open(terminalRef.current);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        setIsWebglAccelerated(false);
      });
      term.loadAddon(webglAddon);
      setIsWebglAccelerated(true);
    } catch {
      setIsWebglAccelerated(false);
    }

    xtermInstance.current = term;
    fitAddonInstance.current = fitAddon;
    searchAddonInstance.current = searchAddon;

    // FIX: fit + send the initial size right away so the PTY never stays at 0/1 rows
    try {
      fitAddon.fit();
      sendResize(term.cols, term.rows);
      setSize({ cols: term.cols, rows: term.rows });
    } catch {
      /* container not laid out yet, the retries below handle it */
    }

    // Ctrl+F opens search (the tooltip promised it, now it works)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
        return false;
      }
      return true;
    });

    // FIX: throttle cursor telemetry to one state update per frame
    let rafId = 0;
    const cursorDisposable = term.onCursorMove(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (disposed) return;
        const b = term.buffer.active;
        setCursorPosition((p) =>
          p.col === b.cursorX + 1 && p.row === b.cursorY + 1
            ? p
            : { col: b.cursorX + 1, row: b.cursorY + 1 }
        );
      });
    });

    const dataDisposable = term.onData((data) => {
      const { type, sessionId } = tabRef.current;
      if (type === 'local') {
        invoke('pty_write', { sessionId, data }).catch(console.error);
      } else if (type === 'ssh') {
        invoke('ssh_write', { sessionId, data }).catch(console.error);
      }
    });

    const eventName = tab.type === 'local' ? `pty-data-${tab.sessionId}` : `ssh-data-${tab.sessionId}`;
    const exitEvent = tab.type === 'local' ? `pty-exit-${tab.sessionId}` : `ssh-exit-${tab.sessionId}`;

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    // FIX: if cleanup ran before listen() resolved (StrictMode), unlisten immediately
    listen<string>(eventName, (event) => {
      term.write(event.payload);
    }).then((u) => {
      if (disposed) u();
      else unlistenData = u;
    });

    listen(exitEvent, () => {
      term.writeln('\r\n\x1b[38;5;208m[Session Terminated]\x1b[0m\r\n');
      setConnected(false);
      onExitRef.current?.();
    }).then((u) => {
      if (disposed) u();
      else unlistenExit = u;
    });

    // FIX: banner no longer claims auth details it can't verify
    if (tab.type === 'ssh' && tab.host) {
      term.writeln(
        `\x1b[38;5;39m➜ Connecting to \x1b[1m${tab.host.label}\x1b[0m \x1b[38;5;244m(${tab.host.address}:${tab.host.port})\x1b[0m`
      );
      term.writeln('\x1b[38;5;240m──────────────────────────────────────────────────────────────────────────\x1b[0m');
    }

    const resizeObserver = new ResizeObserver(() => safeFit());
    resizeObserver.observe(terminalRef.current);

    requestAnimationFrame(safeFit);
    const timer1 = setTimeout(safeFit, 40);
    const timer2 = setTimeout(safeFit, 180);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timer1);
      clearTimeout(timer2);
      resizeObserver.disconnect();
      unlistenData?.();
      unlistenExit?.();
      cursorDisposable.dispose();
      dataDisposable.dispose();
      term.dispose();
      xtermInstance.current = null;
      fitAddonInstance.current = null;
      searchAddonInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sessionId, tab.type, safeFit, sendResize]);

  // Tab becomes active: fit + focus
  useEffect(() => {
    if (active && xtermInstance.current) {
      safeFit();
      xtermInstance.current.focus();
    }
  }, [active, safeFit]);

  // Refit after fullscreen toggles (after layout settles)
  useEffect(() => {
    const t = setTimeout(safeFit, 50);
    return () => clearTimeout(t);
  }, [isFullscreen, safeFit]);

  const handleSearchNext = () => {
    if (searchAddonInstance.current && searchQuery) {
      searchAddonInstance.current.findNext(searchQuery, { caseSensitive: false });
    }
  };

  const handleSearchPrev = () => {
    if (searchAddonInstance.current && searchQuery) {
      searchAddonInstance.current.findPrevious(searchQuery, { caseSensitive: false });
    }
  };

  const closeSearch = () => {
    setShowSearch(false);
    searchAddonInstance.current?.clearDecorations();
    xtermInstance.current?.focus();
  };

  const handleClearBuffer = () => {
    xtermInstance.current?.clear();
    xtermInstance.current?.focus();
  };

  const handleCopySelection = () => {
    const selection = xtermInstance.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).then(() => {
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 1500);
      }).catch(() => {});
    }
  };

  return (
    <div
      className={`w-full h-full bg-[#0d0e13] relative flex flex-col min-h-0 min-w-0 overflow-hidden font-mono ${
        isFullscreen ? 'fixed inset-0 z-50' : ''
      }`}
      onClick={() => xtermInstance.current?.focus()}
    >
      {/* 1. Top bar */}
      <div className="h-8 px-3 bg-[#121318] border-b border-[#1f222e] flex items-center justify-between text-xs flex-shrink-0 z-10 select-none">
        <div className="flex items-center gap-2 truncate">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                tab.type === 'ssh'
                  ? 'bg-emerald-400 ring-2 ring-emerald-400/20'
                  : 'bg-blue-400 ring-2 ring-blue-400/20'
              }`}
            />
            <span className="font-bold text-gray-200 text-xs truncate max-w-[160px]">{tab.title}</span>
          </div>
          <span className="text-[10px] bg-[#0a0b0e] border border-[#1f222e] text-gray-400 px-1.5 py-px rounded font-mono">
            {tab.type === 'ssh' ? 'SSH' : `${tab.shell?.toUpperCase() || 'PTY'}`}
          </span>
          {isWebglAccelerated && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[9px] text-cyan-400 bg-cyan-950/30 border border-cyan-800/40 px-1.5 py-px rounded">
              <Zap size={9} /> WebGL
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {copiedNotification && (
            <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/30 flex items-center gap-1">
              <Check size={10} /> Copied
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); showSearch ? closeSearch() : setShowSearch(true); }}
            className={`p-1 rounded text-gray-400 hover:text-white transition-colors ${
              showSearch ? 'bg-[#1a1c26] text-blue-400' : 'hover:bg-[#1a1c26]'
            }`}
            title="Search Buffer (Ctrl+F)"
          >
            <Search size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopySelection(); }}
            className="p-1 hover:bg-[#1a1c26] rounded text-gray-400 hover:text-white transition-colors"
            title="Copy Selection"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleClearBuffer(); }}
            className="p-1 hover:bg-[#1a1c26] rounded text-gray-400 hover:text-white transition-colors"
            title="Clear Screen"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsFullscreen((v) => !v); }}
            className="p-1 hover:bg-[#1a1c26] rounded text-gray-400 hover:text-white transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Maximize Pane'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {onExit && (
            <button
              onClick={(e) => { e.stopPropagation(); onExit(); }}
              className="p-1 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded transition-colors ml-1"
              title="Close Terminal"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Search overlay */}
      {showSearch && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-10 right-4 z-30 bg-[#121318] border border-[#232736] rounded-lg shadow-2xl p-1.5 flex items-center gap-1.5 backdrop-blur-md"
        >
          <Search size={13} className="text-gray-400 ml-1.5" />
          <input
            type="text"
            autoFocus
            placeholder="Find in buffer..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              searchQueryRef.current = e.target.value;
              searchAddonInstance.current?.findNext(e.target.value, {
                incremental: true,
                caseSensitive: false,
              });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.shiftKey ? handleSearchPrev() : handleSearchNext();
              if (e.key === 'Escape') closeSearch();
            }}
            className="bg-[#0a0b0e] border border-[#1f222e] rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500 w-44"
          />
          <button onClick={handleSearchPrev} className="p-1 hover:bg-[#1c1f2b] rounded text-gray-400 hover:text-white" title="Previous (Shift+Enter)">
            <ChevronUp size={13} />
          </button>
          <button onClick={handleSearchNext} className="p-1 hover:bg-[#1c1f2b] rounded text-gray-400 hover:text-white" title="Next (Enter)">
            <ChevronDown size={13} />
          </button>
          <button onClick={closeSearch} className="p-1 hover:bg-[#1c1f2b] rounded text-gray-400 hover:text-white" title="Close">
            <X size={13} />
          </button>
        </div>
      )}

      {/* 3. Terminal viewport.
          FIX: wrapper has definite size (flex-1 min-h-0 relative); the xterm host is
          absolutely positioned inside it, so it can never collapse to 0 height.
          Padding lives on the wrapper, not on the element FitAddon measures. */}
      <div className="flex-1 min-h-0 min-w-0 relative p-1.5">
        <div ref={terminalRef} className="absolute inset-1.5 overflow-hidden" />
      </div>

      {/* 4. Footer: all values are real now */}
      <div className="h-5 px-3 bg-[#0a0b0e] border-t border-[#181a24] flex items-center justify-between text-[10px] text-gray-500 font-mono select-none flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-gray-400">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {connected ? 'ONLINE' : 'CLOSED'}
          </span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-400">
            Ln {cursorPosition.row}, Col {cursorPosition.col}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>{size.cols}×{size.rows}</span>
          <span className="text-gray-600">|</span>
          <span className={isWebglAccelerated ? 'text-emerald-400' : 'text-gray-400'}>
            {isWebglAccelerated ? 'WebGL' : 'DOM'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TerminalView;
