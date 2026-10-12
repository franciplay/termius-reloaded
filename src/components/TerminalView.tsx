import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Search,
  Copy,
  RotateCcw,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  X,
  Zap,
  Check,
  AlertCircle
} from 'lucide-react';
import { TerminalTab } from '../types';

export interface SshErrorInfo {
  title: string;
  message: string;
  suggestions: string[];
}

interface TerminalViewProps {
  tab: TerminalTab;
  active: boolean;
  onExit?: () => void;
  onSplitToggle?: () => void;
  onRetry?: () => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  tab,
  active,
  onExit,
  onSplitToggle,
  onRetry,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonInstance = useRef<FitAddon | null>(null);
  const searchAddonInstance = useRef<SearchAddon | null>(null);

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
  const [errorInfo, setErrorInfo] = useState<SshErrorInfo | null>(null);
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
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    try {
      fit.fit();
      if (term.cols > 0 && term.rows > 0) {
        sendResize(term.cols, term.rows);
        setSize({ cols: term.cols, rows: term.rows });
      }
    } catch {
      // fit failed because element is not yet attached
    }
  }, [sendResize]);

  useEffect(() => {
    if (!terminalRef.current) return;
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Code", "Fira Code", monospace',
      lineHeight: 1.25,
      theme: {
        background: '#0d0e13',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d0e13',
        selectionBackground: 'rgba(56, 139, 253, 0.35)',
        black: '#000000',
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

    try {
      fitAddon.fit();
      sendResize(term.cols, term.rows);
      setSize({ cols: term.cols, rows: term.rows });
    } catch {
      // not laid out yet
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowSearch(true);
        return false;
      }
      return true;
    });

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
    const errorEvent = `ssh-error-${tab.sessionId}`;

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    listen<string>(eventName, (event) => {
      term.write(event.payload);
    }).then((u) => {
      if (disposed) u();
      else unlistenData = u;
    });

    // Listen for detailed error diagnostics from Rust backend
    listen<SshErrorInfo>(errorEvent, (event) => {
      setErrorInfo(event.payload);
      setConnected(false);
    }).then((u) => {
      if (disposed) u();
      else unlistenError = u;
    });

    // When connection terminates, update status but KEEP TAB OPEN so user can see diagnostics
    listen(exitEvent, () => {
      term.writeln('\r\n\x1b[38;5;208m[Session Terminated]\x1b[0m\r\n');
      setConnected(false);
    }).then((u) => {
      if (disposed) u();
      else unlistenExit = u;
    });

    if (tab.type === 'ssh' && tab.host) {
      term.writeln(
        `\x1b[38;5;39m➜ Connecting to \x1b[1m${tab.host.label || tab.host.address}\x1b[0m \x1b[38;5;244m(${tab.host.address}:${tab.host.port})\x1b[0m`
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
      unlistenError?.();
      cursorDisposable.dispose();
      dataDisposable.dispose();
      term.dispose();
      xtermInstance.current = null;
      fitAddonInstance.current = null;
      searchAddonInstance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sessionId, tab.type, safeFit, sendResize]);

  useEffect(() => {
    if (active && xtermInstance.current) {
      safeFit();
      xtermInstance.current.focus();
    }
  }, [active, safeFit]);

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
                connected
                  ? tab.type === 'ssh'
                    ? 'bg-emerald-400 ring-2 ring-emerald-400/20'
                    : 'bg-blue-400 ring-2 ring-blue-400/20'
                  : 'bg-red-500 ring-2 ring-red-500/20'
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
            className={`p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26] ${showSearch ? 'text-blue-400 bg-blue-500/10' : ''}`}
            title="Search (Ctrl+F)"
          >
            <Search size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleCopySelection(); }}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26]"
            title="Copy selection"
          >
            <Copy size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleClearBuffer(); }}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26]"
            title="Clear buffer"
          >
            <RotateCcw size={13} />
          </button>
          {onSplitToggle && (
            <button
              onClick={(e) => { e.stopPropagation(); onSplitToggle(); }}
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26]"
              title="Split pane"
            >
              <RotateCcw size={13} className="rotate-90" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setIsFullscreen(!isFullscreen); }}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-[#1a1c26]"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {onExit && (
            <button
              onClick={(e) => { e.stopPropagation(); onExit(); }}
              className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 ml-1"
              title="Close tab"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 2. Visual Error Banner: What happened and how to fix it */}
      {errorInfo && (
        <div className="bg-[#1c0d10] border-b border-red-500/30 p-3.5 text-xs select-text shadow-xl z-20 flex-shrink-0 animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="p-1.5 rounded-lg bg-red-500/20 text-red-400 mt-0.5 flex-shrink-0">
                <AlertCircle size={18} />
              </div>
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-red-200 text-sm">
                    Connection Failed: {errorInfo.title}
                  </h3>
                  <span className="text-[10px] font-mono bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30">
                    SSH Error
                  </span>
                </div>

                <p className="text-red-300 font-mono text-xs bg-black/40 px-2.5 py-1.5 rounded border border-red-500/20">
                  {errorInfo.message}
                </p>

                {errorInfo.suggestions && errorInfo.suggestions.length > 0 && (
                  <div className="pt-1">
                    <span className="font-semibold text-amber-300 text-xs block mb-1">
                      Possible Solutions & Troubleshooting:
                    </span>
                    <ul className="space-y-1 text-gray-300 text-xs list-disc list-inside">
                      {errorInfo.suggestions.map((s, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {onRetry && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setErrorInfo(null);
                    onRetry();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium text-xs shadow transition-colors"
                >
                  <RotateCcw size={12} />
                  Retry
                </button>
              )}
              {onExit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onExit();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#252836] hover:bg-[#2f3345] text-gray-300 hover:text-white rounded-md font-medium text-xs transition-colors"
                >
                  <X size={12} />
                  Close Tab
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Normal disconnected banner (if exited cleanly without error) */}
      {!connected && !errorInfo && (
        <div className="bg-[#181a22] border-b border-[#2a2d3d] px-3.5 py-2 text-xs flex items-center justify-between z-20 flex-shrink-0">
          <div className="flex items-center gap-2 text-gray-400">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Session disconnected.</span>
          </div>
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry();
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs transition-colors"
              >
                <RotateCcw size={11} /> Reconnect
              </button>
            )}
            {onExit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExit();
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#252836] hover:bg-[#2f3345] text-gray-300 rounded text-xs transition-colors"
              >
                <X size={11} /> Close Tab
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Search bar */}
      {showSearch && (
        <div
          className="absolute top-9 right-3 z-30 bg-[#121318] border border-[#2a2d3d] rounded-lg p-2 flex items-center gap-2 shadow-2xl animate-in fade-in duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <Search size={13} className="text-gray-400" />
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

      {/* 5. Terminal viewport */}
      <div className="flex-1 min-h-0 min-w-0 relative p-1.5">
        <div ref={terminalRef} className="absolute inset-1.5 overflow-hidden" />
      </div>

      {/* 6. Footer telemetry */}
      <div className="h-5 px-3 bg-[#0a0b0e] border-t border-[#181a24] flex items-center justify-between text-[10px] text-gray-500 font-mono select-none flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-gray-400">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {connected ? 'ONLINE' : 'DISCONNECTED'}
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
