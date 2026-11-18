/**
 * A macOS sandbox-exec profile: writes only under `workDir`, and unless `network` is set, no
 * network except loopback.
 */
export function seatbeltProfile({ workDir, network = false }) {
  const rules = ['(version 1)', '(allow default)'];
  if (!network) {
    rules.push(
      '(deny network*)',
      // Loopback only, so tests that start a local server still work.
      '(allow network* (local ip "localhost:*"))',
    );
  }
  rules.push('(deny file-write*)', `(allow file-write* (subpath ${JSON.stringify(workDir)}))`);
  return rules.join('\n');
}
