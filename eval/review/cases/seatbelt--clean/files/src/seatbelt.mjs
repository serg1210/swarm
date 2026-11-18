/**
 * A macOS sandbox-exec profile: writes only under `workDir`, and unless `network` is set, no
 * network except loopback.
 */
export function seatbeltProfile({ workDir, network = false }) {
  const rules = ['(version 1)', '(allow default)'];
  if (!network) {
    rules.push(
      '(deny network*)',
      // Loopback only, one direction per rule: listen, accept, and connect to a local address.
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    );
  }
  rules.push('(deny file-write*)', `(allow file-write* (subpath ${JSON.stringify(workDir)}))`);
  return rules.join('\n');
}
