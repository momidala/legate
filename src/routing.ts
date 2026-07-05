// legate-e1i: server-URL resolution logic extracted from index.ts so it can be
// unit-tested in isolation. index.ts cannot be imported directly in a test — its
// module top-level calls main() and connects a StdioServerTransport to the process
// stdio — so the pure D-06/D-07 fallback chain lived untested inside a closure.
// Moving it here (a side-effect-free module) lets tests exercise every branch with
// temp sessions.json/servers.json files, WITHOUT changing behavior: index.ts keeps
// a thin resolveServerUrl(sessionId, serverName) wrapper that supplies BASE_URL.
import { lookupSession, SESSIONS_PATH } from './sessions.js';
import { readRegistry, REGISTRY_PATH } from './registry.js';

// D-06: server URL resolution fallback chain.
//   1. sessionId → sessions.json lookup → that session's server URL
//   2. serverName (entry points only) → registry lookup by name
//   3. no inputs → first entry in registry
//   4. registry empty → baseUrl (LEGATE_SERVER_URL env var)
// D-07: unknown serverName throws with the exact message below.
//
// legate-e1i: sessionsPath/registryPath default to the real config paths (identical
// to the previous inline behavior); tests override them to point at temp files.
export function resolveServerUrl(
  sessionId: string | undefined,
  serverName: string | undefined,
  baseUrl: string,
  sessionsPath: string = SESSIONS_PATH,
  registryPath: string = REGISTRY_PATH,
): string {
  if (sessionId) {
    const entry = lookupSession(sessionId, sessionsPath);
    if (entry) return entry.url;
    throw new Error(
      `Session '${sessionId}' not found in sessions.json. It may have been deleted or never created via legate_create_session.`,
    );
  }
  if (serverName) {
    const reg = readRegistry(registryPath);
    const found = reg.servers.find((s) => s.name === serverName);
    if (!found) {
      throw new Error(
        `Server '${serverName}' not found in registry. Run 'legate list-servers' to see registered servers.`,
      );
    }
    return `http://${found.host}:${found.port}`;
  }
  const reg = readRegistry(registryPath);
  if (reg.servers.length > 0) {
    const s = reg.servers[0];
    return `http://${s.host}:${s.port}`;
  }
  return baseUrl;
}
