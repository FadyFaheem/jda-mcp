import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface Permissions {
  /** When true, write tools run without per-operation prompting. Default false. */
  allowWrite: boolean;
}

export function parsePermissions(argv: string[], env: NodeJS.ProcessEnv): Permissions {
  const flag = argv.includes("--allow-write");
  const envVal = (env.JDA_MOCA_ALLOW_WRITE || "").toLowerCase();
  return { allowWrite: flag || envVal === "1" || envVal === "true" };
}

export interface WriteDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether a write operation may proceed:
 *  1. If --allow-write was set, allow (operator pre-approval).
 *  2. Else, if the client supports elicitation, ask the human to approve THIS
 *     operation (per-operation; never cached).
 *  3. Else, deny with guidance. The AI can request, but cannot self-grant.
 */
export async function ensureWritePermitted(
  server: McpServer,
  perms: Permissions,
  opSummary: string
): Promise<WriteDecision> {
  if (perms.allowWrite) return { allowed: true, reason: "Pre-approved via --allow-write." };

  const caps = server.server.getClientCapabilities();
  if (!caps || !caps.elicitation) {
    return {
      allowed: false,
      reason:
        "Write operations are disabled. Start the server with --allow-write, or use a client that supports MCP elicitation so writes can be approved interactively.",
    };
  }

  try {
    const result = await server.server.elicitInput({
      message: `Approve this MOCA write operation?\n\n${opSummary}`,
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Approve this write",
            description: "Allow this single operation to run against the MOCA server.",
          },
        },
        required: ["confirm"],
      },
    });
    const content = (result.content ?? {}) as Record<string, unknown>;
    if (result.action === "accept" && content.confirm === true) {
      return { allowed: true, reason: "Approved by user." };
    }
    return { allowed: false, reason: `Write not approved (action: ${result.action}).` };
  } catch (e) {
    return { allowed: false, reason: `Approval prompt failed: ${(e as Error).message}` };
  }
}
