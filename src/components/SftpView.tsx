import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Folder, FileText, ArrowUp, RefreshCw, Eye, X, Save } from 'lucide-react';
import { SftpEntry, TerminalTab } from '../types';

interface SftpViewProps {
  tab: TerminalTab;
}

export const SftpView: React.FC<SftpViewProps> = ({ tab }) => {
  const [currentPath, setCurrentPath] = useState('/root');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File preview/edit state
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchDirectory = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const items = await invoke<SftpEntry[]>('sftp_list', {
        sessionId: tab.sessionId,
        remotePath: path,
      });
      setEntries(items);
      setCurrentPath(path);
    } catch (err: any) {
      setError(err?.toString() || 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory(currentPath);
  }, [tab.sessionId]);

  const handleNavigate = (entry: SftpEntry) => {
    if (entry.is_dir) {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      fetchDirectory(newPath);
    } else {
      handleOpenFile(entry.path);
    }
  };

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = '/' + parts.join('/');
    fetchDirectory(parentPath || '/');
  };

  const handleOpenFile = async (path: string) => {
    setLoading(true);
    try {
      const content = await invoke<string>('sftp_read_file', {
        sessionId: tab.sessionId,
        path,
      });
      setFileContent(content);
      setEditingFile(path);
    } catch (err: any) {
      alert(`Error reading file: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveFile = async () => {
    if (!editingFile) return;
    setIsSaving(true);
    try {
      await invoke('sftp_write_file', {
        sessionId: tab.sessionId,
        path: editingFile,
        content: fileContent,
      });
      alert('File saved successfully!');
    } catch (err: any) {
      alert(`Error saving file: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0d1117] text-[#c9d1d9] select-text">
      {/* SFTP Toolbar */}
      <div className="flex items-center gap-2 p-3 bg-[#161b22] border-b border-[#30363d]">
        <button
          onClick={handleGoUp}
          disabled={currentPath === '/'}
          className="p-1.5 rounded hover:bg-[#21262d] disabled:opacity-40 text-gray-300"
          title="Parent Directory"
        >
          <ArrowUp size={18} />
        </button>
        <button
          onClick={() => fetchDirectory(currentPath)}
          className="p-1.5 rounded hover:bg-[#21262d] text-gray-300"
          title="Refresh"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>

        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            fetchDirectory(currentPath);
          }}
        >
          <input
            type="text"
            value={currentPath}
            onChange={(e) => setCurrentPath(e.target.value)}
            className="w-full bg-[#0d1117] border border-[#30363d] rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
          />
        </form>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-950/60 border-l-4 border-red-500 text-red-200 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#30363d] text-xs uppercase text-gray-400 bg-[#161b22]/50 sticky top-0">
              <th className="py-2.5 px-4 font-medium">Name</th>
              <th className="py-2.5 px-4 font-medium w-28">Size</th>
              <th className="py-2.5 px-4 font-medium w-24">Type</th>
              <th className="py-2.5 px-4 font-medium w-28 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.path}
                onDoubleClick={() => handleNavigate(entry)}
                className="border-b border-[#21262d] hover:bg-[#1f242c] cursor-pointer transition-colors"
              >
                <td className="py-2.5 px-4 flex items-center gap-2.5 font-mono text-gray-200">
                  {entry.is_dir ? (
                    <Folder size={18} className="text-yellow-400 fill-yellow-400/20 flex-shrink-0" />
                  ) : (
                    <FileText size={18} className="text-blue-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </td>
                <td className="py-2.5 px-4 text-gray-400 font-mono text-xs">
                  {entry.is_dir ? '-' : formatSize(entry.size)}
                </td>
                <td className="py-2.5 px-4 text-gray-400 text-xs">
                  {entry.is_dir ? 'Directory' : 'File'}
                </td>
                <td className="py-2.5 px-4 text-right">
                  {!entry.is_dir && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenFile(entry.path);
                      }}
                      className="p-1 text-gray-400 hover:text-blue-400 rounded hover:bg-[#30363d]"
                      title="View / Edit"
                    >
                      <Eye size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="text-center py-12 text-gray-500">
                  Directory is empty or cannot be read.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* File Editor Modal */}
      {editingFile && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#30363d] bg-[#0d1117]">
              <div className="font-mono text-sm text-gray-200 truncate max-w-lg">
                📄 {editingFile}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveFile}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
                >
                  <Save size={14} />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingFile(null)}
                  className="p-1.5 hover:bg-[#30363d] rounded text-gray-400 hover:text-gray-200"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="flex-1 w-full bg-[#0d1117] text-gray-200 p-4 font-mono text-xs focus:outline-none resize-none"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
};
