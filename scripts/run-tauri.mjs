import { spawn } from 'node:child_process';
import process from 'node:process';

// Remove rogue quotes in Windows PATH that corrupt cmd.exe environment
const cleanPath = (process.env.PATH || '').replace(/"/g, '');

const args = ['tauri', ...process.argv.slice(2)];
const tauriProcess = spawn('npx', args, {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    PATH: cleanPath,
  },
});

tauriProcess.on('exit', (code) => {
  process.exit(code ?? 0);
});
