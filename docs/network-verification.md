# Network Verification

Methods for verifying that the app makes no unauthorized external network requests.

## Automated: security tests

`tests/security.test.ts` unit-tests the SSRF blocklist (`validateUpstreamUrl`) directly — no network needed:

```bash
npx playwright test tests/security.test.ts
```

This covers loopback, RFC 1918, IPv6, IPv4-mapped IPv6, cloud metadata, hex/octal IP forms, and scheme validation. If any blocked address is accidentally allowed, the test fails.

## Electron: network audit module

`electron/network-audit.js` hooks into Electron's `webRequest.onBeforeRequest` to log every outbound request. Enable it during development to verify no unexpected external calls:

```javascript
const { enableNetworkAudit, printNetworkSummary } = require('./network-audit');

// In main process, after app.whenReady():
enableNetworkAudit(session.defaultSession);

// On app quit:
printNetworkSummary();
```

The audit module records every request URL and classifies it as internal (localhost) or external. `printNetworkSummary()` prints a table of all external requests — the list should be empty except for the upstream API providers the user explicitly configured.

## Playwright: route interception

Playwright tests use `page.route()` to intercept all outbound requests. The test infrastructure in `tests/utils.ts` mocks `/api/keys`, `/api/models`, and `/api/chat` — any request to a URL that isn't mocked will either fail (revealing the request) or be logged by Playwright's trace.

To run all tests and check for unmocked requests:

```bash
npx playwright test --trace on
```

Review the trace output for any requests to external hosts that shouldn't be there.

## OS-level: network monitoring

For maximum assurance, monitor at the OS level:

```bash
# Linux: watch DNS + TCP during a test run
sudo tcpdump -i any -n 'port 53 or port 443' &
npx playwright test
# Review tcpdump output for unexpected destinations
```

Or use `ss` / `netstat` to check active connections while the app is running:

```bash
ss -tnp | grep node
```

The only expected external connections are to the upstream API providers the user configured in Settings.
