// legate-hry: discovery / file / exec tools — list_agents, list_providers, find_symbol,
// vcs_info, file_status, list_mcp_servers, get_config, list_commands, list_tools,
// find_file, get_file_content, session_shell, inject_mcp_server. Moved verbatim from
// index.ts; shared state now arrives via ServerContext.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import path from 'node:path';
import type { ServerContext } from '../server-context.js';
import { apiError } from '../errors.js';
// legate-tcg: server-side credential redaction for legate_get_config.
import { redactSecrets } from '../redact.js';

export function registerDiscovery(server: McpServer, ctx: ServerContext): void {
  const {
    execToolsEnabled, execDisabledMessage,
    registerSessionTool, registerServerTool,
  } = ctx;

  // API-01: List OpenCode agents (Phase 8)
  registerServerTool(
    'legate_list_agents',
    {
      description: 'List the agents available in the connected OpenCode instance. Returns Array<{ name, description?, mode }>. Use the returned name (e.g. "build", "general") as the agent param when calling legate_run. Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.app.agents({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return (data ?? []).map((a) => ({
        name: a.name,
        description: a.description,
        mode: a.mode,
      }));
    }
  );

  // API-02: List OpenCode providers and their models (Phase 8)
  registerServerTool(
    'legate_list_providers',
    {
      description: 'List the providers configured in the connected OpenCode instance and their available models. Returns Array<{ id, name, models: Array<{ id, name }> }>. Use returned provider.id + model.id as providerID/modelID params for legate_run. Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.provider.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return (data?.all ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.values(p.models).map((m) => ({ id: m.id, name: m.name })),
      }));
    }
  );

  // API-03: Find workspace symbols by query (Phase 8)
  registerServerTool(
    'legate_find_symbol',
    {
      description: 'Search the OpenCode workspace for symbols matching a query string (e.g. function or class names). Returns Array<{ name, kind, path, range }> where path is project-root-relative when a directory is resolved (via directory param or LEGATE_DEFAULT_PROJECT), absolute otherwise. kind is the LSP SymbolKind number.',
      inputSchema: z.object({
        query: z.string().describe('Symbol name or pattern to search for'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir, args }) => {
      const { query: symbolQuery } = args;
      const { data, error } = await client.find.symbols({
        query: { query: symbolQuery, ...(dir ? { directory: dir } : {}) },
      });
      if (error) throw apiError(error);
      return (data ?? []).map((sym) => {
        if (!sym.location.uri.startsWith('file://')) return null;
        const absolutePath = decodeURIComponent(sym.location.uri.replace(/^file:\/\//, ''));
        const filePath = dir ? path.relative(dir, absolutePath) : absolutePath;
        return {
          name: sym.name,
          kind: sym.kind,
          path: filePath,
          range: sym.location.range,
        };
      }).filter((sym): sym is NonNullable<typeof sym> => sym !== null);
    }
  );

  // API-04: legate_vcs_info — get VCS/git info for the workspace
  registerServerTool(
    'legate_vcs_info',
    {
      description: 'Get VCS/git info for the OpenCode workspace. Returns { branch: string } with the current git branch name. Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.vcs.get({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // API-05: legate_file_status — get git-tracked file status for the workspace
  registerServerTool(
    'legate_file_status',
    {
      description: 'Get git-tracked file status for the OpenCode workspace. Returns Array<{ path: string, added: number, removed: number, status: "added"|"deleted"|"modified" }>. Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.file.status({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // API-06: legate_list_mcp_servers — list MCP servers configured in OpenCode
  registerServerTool(
    'legate_list_mcp_servers',
    {
      description: 'List the MCP servers configured in the connected OpenCode instance. Returns { [serverName: string]: McpStatus } where McpStatus has a status field of "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration". Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.mcp.status({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // API-11: legate_get_config — get the current OpenCode configuration
  registerServerTool(
    'legate_get_config',
    {
      description: 'Get the current OpenCode configuration object. Returns the full Config as JSON. Pass directory to scope to a specific project root. WARNING: the OpenCode config can hold provider credentials — so credential-shaped fields (keys matching apiKey/api_key/token/secret/password/credential/authorization) are redacted server-side to the literal "[REDACTED]" before this tool returns. All other fields are returned unchanged.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.config.get({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      // legate-tcg: redact credential-shaped fields before the config leaves this
      // process — the raw config can carry provider API keys/tokens.
      return redactSecrets(data);
    }
  );

  // API-12: legate_list_commands — list available slash commands
  registerServerTool(
    'legate_list_commands',
    {
      description: 'List available slash commands in the OpenCode instance. Returns Array<{ name: string, description?: string, agent?: string, model?: string, template: string, subtask?: boolean }>. Complements legate_session_command which executes a named command. Pass directory to scope to a specific project root.',
      inputSchema: z.object({
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir }) => {
      const { data, error } = await client.command.list({
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // API-08: legate_list_tools — list available tools per model (dual-endpoint)
  registerServerTool(
    'legate_list_tools',
    {
      description: 'List tools available in the OpenCode instance. When provider and model are both omitted, returns all tool IDs (Array<string>) via GET /experimental/tool/ids. When both provider and model are supplied, returns tool details (Array<{ id, description, parameters }>) for that specific model via GET /experimental/tool. Both provider and model are required together when using the detailed endpoint.',
      inputSchema: z.object({
        provider: z.string().optional().describe('Provider ID (e.g. "anthropic"). Required when model is provided.'),
        model: z.string().optional().describe('Model ID (e.g. "claude-sonnet-4-6"). Required when provider is provided.'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir, args }) => {
      const { provider, model } = args;
      if ((provider && !model) || (!provider && model)) {
        throw new Error('legate_list_tools: provider and model must be supplied together; omit both for tool IDs only');
      }
      if (provider && model) {
        // GET /experimental/tool — requires BOTH provider + model (non-optional in SDK types)
        const { data, error } = await client.tool.list({
          query: {
            provider,
            model,
            ...(dir ? { directory: dir } : {}),
          },
        });
        if (error) throw apiError(error);
        return data;
      } else {
        // GET /experimental/tool/ids — no required params
        const { data, error } = await client.tool.ids({
          query: dir ? { directory: dir } : undefined,
        });
        if (error) throw apiError(error);
        return data;
      }
    }
  );

  // API-09: legate_find_file — find files in the workspace by name or pattern
  registerServerTool(
    'legate_find_file',
    {
      description: 'Find files in the OpenCode workspace matching a query string. Returns Array<string> of matching file paths. Optionally include directories in results via dirs param. Pass directory to scope the search to a project root.',
      inputSchema: z.object({
        query: z.string().describe('Filename or pattern to search for'),
        dirs: z.enum(['true', 'false']).optional().describe('Whether to include directory paths in results. Defaults to "false". Must be the string "true" or "false", not a boolean.'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir, args }) => {
      const { query: fileQuery, dirs } = args;
      const { data, error } = await client.find.files({
        query: {
          query: fileQuery,
          ...(dirs ? { dirs } : {}),
          ...(dir ? { directory: dir } : {}),
        },
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // API-10: legate_get_file_content — get the content of a file in the workspace
  registerServerTool(
    'legate_get_file_content',
    {
      description: 'Get the content of a file in the OpenCode workspace. Returns { type: "text"|"binary", content: string, diff?, patch?, encoding?, mimeType? }. path is the file path — absolute or relative to directory if provided.',
      inputSchema: z.object({
        path: z.string().describe('File path to read (absolute, or relative to the directory param if provided)'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir, args }) => {
      const { path: filePath } = args;
      const { data, error } = await client.file.read({
        query: {
          path: filePath,
          ...(dir ? { directory: dir } : {}),
        },
      });
      if (error) throw apiError(error);
      return data;
    }
  );

  // SESSION-14: legate_session_shell — execute a shell command in a session context
  registerSessionTool(
    'legate_session_shell',
    {
      description: 'WARNING: Executes an arbitrary shell command in the context of an OpenCode session. The command runs in the session\'s working directory with the session\'s environment. Returns AssistantMessage containing command output. Use with caution — there is no sandboxing at the Legate layer. DISABLED BY DEFAULT: this tool only runs when LEGATE_ENABLE_EXEC_TOOLS=1 is set in the legate MCP server\'s environment; otherwise every call returns an isError with enable instructions. sessionId, agent, and command are all required. model override is optional.',
      inputSchema: z.object({
        sessionId: z.string().min(1).describe('Session ID in which to execute the command'),
        command: z.string().describe('Shell command to execute in the session\'s context'),
        agent: z.string().describe('Required. Agent context for command execution (e.g. "general"). Must match a configured agent name.'),
        model: z.object({
          providerID: z.string(),
          modelID: z.string(),
        }).optional().describe('Optional model override. Both providerID and modelID required together if provided.'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, serverUrl, dir, args }) => {
      const { sessionId, command, agent, model } = args;
      const { data, error } = await client.session.shell({
        path: { id: sessionId },
        body: {
          agent,
          command,
          ...(model ? { model } : {}),
        },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) await ctx.handleNotFound(error, sessionId, serverUrl);
      return data;
    },
    // legate-tcg: opt-in gate — arbitrary command execution on the OpenCode host.
    { gate: () => execToolsEnabled() ? null : execDisabledMessage('legate_session_shell', 'executes arbitrary commands on the OpenCode host') },
  );

  // API-07: legate_inject_mcp_server — add an MCP server to OpenCode at runtime
  registerServerTool(
    'legate_inject_mcp_server',
    {
      description: 'WARNING: with configType "local" this registers an arbitrary command that the OpenCode host will execute as a subprocess — only inject MCP servers you trust. DISABLED BY DEFAULT: this tool only runs when LEGATE_ENABLE_EXEC_TOOLS=1 is set in the legate MCP server\'s environment; otherwise every call returns an isError with enable instructions. Add an MCP server to the OpenCode instance at runtime. For local stdio servers, pass configType: "local" with commandArgs as an array (e.g. ["node", "/path/to/server.js"]). For remote HTTP/SSE servers, pass configType: "remote" with url. Returns the updated MCP server map { [serverName]: McpStatus }.',
      inputSchema: z.object({
        name: z.string().describe('Unique name for this MCP server in the OpenCode MCP registry'),
        configType: z.enum(['local', 'remote']).describe('"local" for stdio subprocess MCP servers; "remote" for HTTP/SSE MCP servers'),
        commandArgs: z.array(z.string()).optional().describe('Required when configType is "local". Command and arguments as an array (e.g. ["node", "/path/to/server.js"]).'),
        environment: z.record(z.string(), z.string()).optional().describe('Environment variables to set when running a local MCP server'),
        url: z.string().optional().describe('Required when configType is "remote". URL of the remote MCP server'),
        headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers for remote MCP server requests'),
        enabled: z.boolean().optional().describe('Whether to enable this MCP server. Defaults to true.'),
        timeout: z.number().int().positive().optional().describe('Timeout in ms for fetching tools from the MCP server (local only). Default: 5000.'),
        directory: z.string().optional().describe('Absolute path to the project root. Falls back to LEGATE_DEFAULT_PROJECT env var if not provided.'),
      }),
    },
    async ({ client, dir, args }) => {
      const { name, configType, commandArgs, environment, url, headers, enabled, timeout } = args;
      if (configType === 'local' && (!commandArgs || commandArgs.length === 0)) {
        throw new Error('legate_inject_mcp_server: commandArgs is required when configType is "local"');
      }
      if (configType === 'remote' && !url) {
        throw new Error('legate_inject_mcp_server: url is required when configType is "remote"');
      }
      const config: import('@opencode-ai/sdk').McpLocalConfig | import('@opencode-ai/sdk').McpRemoteConfig =
        configType === 'local'
          ? {
              type: 'local',
              command: commandArgs!,
              ...(environment ? { environment } : {}),
              ...(enabled !== undefined ? { enabled } : {}),
              ...(timeout !== undefined ? { timeout } : {}),
            }
          : {
              type: 'remote',
              url: url!,
              ...(headers ? { headers } : {}),
              ...(enabled !== undefined ? { enabled } : {}),
            };
      const { data, error } = await client.mcp.add({
        body: { name, config },
        query: dir ? { directory: dir } : undefined,
      });
      if (error) throw apiError(error);
      return data;
    },
    // legate-tcg: opt-in gate — registers a command the OpenCode host will spawn.
    { gate: () => execToolsEnabled() ? null : execDisabledMessage('legate_inject_mcp_server', 'registers an arbitrary command the OpenCode host will spawn as a subprocess') },
  );
}
