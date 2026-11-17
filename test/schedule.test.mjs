import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';
import { scheduleSnippet } from '../src/schedule.mjs';
import { setLogSink } from '../src/util.mjs';

test('scheduleSnippet builds a launchd plist with separate escaped arguments and defaults', () => {
  const { kind, text, installHint } = scheduleSnippet({
    platform: 'darwin',
    nodePath: '/opt/my tools/bin/node',
    binPath: `/home/a&b/<"swarm's">/swarm.mjs`,
  });
  assert.equal(kind, 'launchd');
  assert.match(text, /^<\?xml[\s\S]*<plist version="1.0">[\s\S]*<\/plist>$/);
  assert.match(text, /<key>Label<\/key>\s*<string>home\.swarm\.donate<\/string>/);
  const programArguments = text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1];
  assert.deepEqual([...programArguments.matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1]), [
    '/opt/my tools/bin/node', '/home/a&amp;b/&lt;&quot;swarm&apos;s&quot;&gt;/swarm.mjs',
    'run', '--only-if-expiring', '12', '--max-tasks', '1',
  ]);
  assert.match(text, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  assert.match(installHint, /launchctl load ~\/Library\/LaunchAgents\/home\.swarm\.donate\.plist/);
});

test('scheduleSnippet quotes cron paths and accepts a custom quota window and task limit', () => {
  const { kind, text, installHint } = scheduleSnippet({
    platform: 'linux',
    nodePath: '/opt/my tools/bin/node',
    binPath: "/home/Pat's $tools%/swarm.mjs",
    hours: 6.5,
    maxTasks: 3,
  });
  assert.equal(kind, 'cron');
  assert.equal(text, String.raw`17 * * * * '/opt/my tools/bin/node' '/home/Pat'\''s $tools'\%'/swarm.mjs' run --only-if-expiring 6.5 --max-tasks 3`);
  assert.match(installHint, /crontab -e/);
});

test('swarm schedule prints the snippet and hint and is listed in help', async () => {
  const lines = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    await main(['schedule', '--hours', '8', '--max-tasks=2']);
    const { text, installHint } = scheduleSnippet({
      platform: process.platform,
      nodePath: process.execPath,
      binPath: fileURLToPath(new URL('../bin/swarm.mjs', import.meta.url)),
      hours: 8,
      maxTasks: 2,
    });
    assert.deepEqual(lines, [text, `\n${installHint}`]);
    await assert.rejects(main(['schedule', '--hours', 'soon']), /--hours must be a non-negative number/);
    await assert.rejects(main(['schedule', '--max-tasks', '1.5']), /--max-tasks must be a positive integer/);
    assert.deepEqual(lines, [text, `\n${installHint}`]);

    await main(['help']);
    assert.match(lines.at(-1), /swarm schedule \[--hours <n>\] \[--max-tasks <n>\]/);
  } finally {
    setLogSink(restore);
  }
});
