import { timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ToolAnnotations } from "./contracts.js";

/** The two fixed scopes. Write includes read; there is no per-agent or per-task scoping. */
export const TOKEN_SCOPES = ["read", "write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** Bearer secrets by scope. A scope with no secret cannot be reached over HTTP. */
export interface ScopedTokens {
  /** `MCP_READ_TOKEN`: may call tools annotated `readOnlyHint: true` and read resources. */
  read?: string | undefined;
  /** `MCP_WRITE_TOKEN`, plus the single `MCP_AUTH_TOKEN` of earlier versions: may call everything. */
  write?: readonly (string | undefined)[] | string | undefined;
}

function tokensMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function nonEmpty(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined && value !== "");
}

/** True when at least one token is configured, which turns bearer auth on. */
export function authEnabled(tokens: ScopedTokens): boolean {
  return nonEmpty([tokens.read, ...[tokens.write].flat()]).length > 0;
}

/**
 * Resolve the scope a presented bearer token grants, or undefined when it matches nothing.
 * Every configured secret is compared, so timing does not reveal which scope was close.
 */
export function resolveScope(tokens: ScopedTokens, provided: string): TokenScope | undefined {
  let scope: TokenScope | undefined;
  for (const secret of nonEmpty([tokens.read])) {
    if (tokensMatch(secret, provided)) {
      scope = "read";
    }
  }
  for (const secret of nonEmpty([tokens.write].flat())) {
    if (tokensMatch(secret, provided)) {
      scope = "write";
    }
  }
  return scope;
}

/** What the transport hands to handlers as `extra.authInfo`. It never carries the token itself. */
export function authInfoFor(scope: TokenScope): AuthInfo {
  return { token: "", clientId: `${scope}-token`, scopes: scope === "write" ? ["write", "read"] : ["read"] };
}

/**
 * The scope a tool needs, derived from its annotations alone: only a tool that
 * declares `readOnlyHint: true` is readable with a read token. A missing hint counts as a write,
 * so a new tool is write-only until someone deliberately marks it read-only.
 */
export function requiredScope(annotations: ToolAnnotations | undefined): TokenScope {
  return annotations?.readOnlyHint === true ? "read" : "write";
}

/**
 * Scope of a call. `undefined` means the transport did no scope checking (auth off, or stdio,
 * where the host spawned the process and owns it), which is unrestricted as before.
 */
export function callerScope(authInfo: AuthInfo | undefined): TokenScope | undefined {
  if (!authInfo) {
    return undefined;
  }
  return authInfo.scopes.includes("write") ? "write" : "read";
}

export function allows(scope: TokenScope | undefined, needed: TokenScope): boolean {
  return scope === undefined || scope === "write" || needed === "read";
}

export function scopeDeniedMessage(tool: string, needed: TokenScope, held: TokenScope | undefined): string {
  return `Forbidden: tool "${tool}" needs the ${needed} scope, but this bearer token has the ${held ?? "read"} scope only. Send the server's MCP_WRITE_TOKEN (or MCP_AUTH_TOKEN) as the bearer token, or ask the operator for it; use query or validate with a read token.`;
}
