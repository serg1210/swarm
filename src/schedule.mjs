const LABEL = 'home.swarm.donate';
const PLIST_PATH = `~/Library/LaunchAgents/${LABEL}.plist`;
const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function cronPath(value) {
  if (/[\r\n]/.test(value)) throw new Error('Cron paths must fit on one line.');
  // Cron interprets % before the shell does, even inside quotes.
  return `'${value.replaceAll("'", "'\\''").replaceAll('%', "'\\%'")}'`;
}

export function scheduleSnippet({ platform, nodePath, binPath, hours = 12, maxTasks = 1 }) {
  const window = Number(hours);
  const limit = Number(maxTasks);
  if (String(hours).trim() === '' || !Number.isFinite(window) || window < 0) {
    throw new Error('--hours must be a non-negative number.');
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('--max-tasks must be a positive integer.');
  }
  const args = ['run', '--only-if-expiring', String(window), '--max-tasks', String(limit)];

  if (platform === 'darwin') {
    const strings = [nodePath, binPath, ...args].map((arg) =>
      `    <string>${arg.replace(/[&<>"']/g, (char) => XML_ENTITIES[char])}</string>`,
    ).join('\n');
    return {
      kind: 'launchd',
      text: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings}
  </array>
  <key>StartInterval</key>
  <integer>3600</integer>
</dict>
</plist>`,
      installHint: `Save the plist to ${PLIST_PATH}, then run\n  launchctl load ${PLIST_PATH}`,
    };
  }

  return {
    kind: 'cron',
    text: `17 * * * * ${cronPath(nodePath)} ${cronPath(binPath)} ${args.join(' ')}`,
    installHint: 'Run crontab -e and add the line above.',
  };
}
