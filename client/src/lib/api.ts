import type { SessionSummary } from "ame-shared";
import type { StoredErrorGroup, StoredErrorEvent } from "ame-shared/errors";
import { auth } from "./stores/auth";

import { ServerUrl as BaseUrl } from "$lib/config";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = auth.getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BaseUrl}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json();

  if (!res.ok) {
    throw new ApiError(body.code ?? "UNKNOWN", body.message ?? "Request failed", res.status, body);
  }

  return body as T;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** The whole error body, for responses that carry more than code+message. */
    public body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Auth ───────────────────────────────────────────────

export async function signup(email: string, password: string, name: string) {
  return request<{ message: string }>(
    "/api/admin/signup",
    { method: "POST", body: JSON.stringify({ email, password, name }) },
  );
}

export async function login(email: string, password: string) {
  return request<{ token: string; experimenter: { id: string; email: string; name: string; role: string } }>(
    "/api/admin/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
}

export async function getMe() {
  return request<{ id: string; email: string; name: string; createdAt: string }>("/api/admin/me");
}

// ── Accounts ──────────────────────────────────────────

type Account = { id: string; email: string; name: string; role: string; status: string; createdAt: string };

export async function listAccounts(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<Account[]>(`/api/admin/accounts${query}`);
}

export async function approveAccount(id: string) {
  return request<Account>(`/api/admin/accounts/${id}/approve`, { method: "POST" });
}

export async function rejectAccount(id: string) {
  return request<void>(`/api/admin/accounts/${id}/reject`, { method: "POST" });
}

// ── Experiments ────────────────────────────────────────

export async function listExperiments() {
  return request<unknown[]>("/api/admin/experiments");
}

export async function getExperiment(id: string) {
  return request<Record<string, unknown>>(`/api/admin/experiments/${id}`);
}

export async function createExperiment(data: Record<string, unknown>) {
  return request<{ id: string; name: string; visible: boolean; createdAt: string }>(
    "/api/admin/experiments",
    { method: "POST", body: JSON.stringify(data) },
  );
}

export async function updateExperiment(id: string, data: Record<string, unknown>) {
  return request<Record<string, unknown>>(`/api/admin/experiments/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteExperiment(id: string) {
  return request<void>(`/api/admin/experiments/${id}`, { method: "DELETE" });
}

export async function toggleVisibility(id: string) {
  return request<{ id: string; visible: boolean }>(`/api/admin/experiments/${id}/visibility`, {
    method: "PUT",
  });
}

// ── Participants ───────────────────────────────────────

export async function listParticipants(experimentId: string) {
  return request<unknown[]>(`/api/admin/experiments/${experimentId}/participants`);
}

export async function getParticipant(id: string) {
  return request<Record<string, unknown>>(`/api/admin/participants/${id}`);
}

export async function deleteParticipant(id: string) {
  return request<void>(`/api/admin/participants/${id}`, { method: "DELETE" });
}

export async function listSessions(experimentId: string) {
  return request<SessionSummary[]>(`/api/admin/experiments/${experimentId}/sessions`);
}

export async function manualMatch(experimentId: string, routineName: string, participantIds: string[]) {
  return request<{ sessionId: string; participants: string[]; routineName: string }>(
    `/api/admin/experiments/${experimentId}/match-participants`,
    { method: "POST", body: JSON.stringify({ routineName, participantIds }) },
  );
}

// ── Content ────────────────────────────────────────────

export async function listContent(experimentId: string) {
  return request<unknown[]>(`/api/admin/experiments/${experimentId}/content`);
}

/**
 * The band of content a Session Designer block claims. With `blockId` set the
 * server replaces only the rows that block stamped; without it, every row in
 * the progress range for the listed conditions — which is why `conditions`
 * is required rather than optional, and why the server rejects an empty list.
 */
export interface ContentReplaceRange {
  fromProgress: number;
  toProgress: number;
  conditions: string[];
  blockId?: string;
}

/**
 * Rewrites one band of content in a single transaction, returning how many
 * rows were removed and how many written. Distinct from the append endpoint
 * (`POST /content`), which no client path uses since the Progress tab took
 * over the table and saves through `saveContent`.
 */
export async function replaceContent(
  experimentId: string,
  rows: unknown[],
  replaceRange: ContentReplaceRange,
) {
  return request<{ deleted: number; created: number }>(
    `/api/admin/experiments/${experimentId}/content`,
    { method: "PUT", body: JSON.stringify({ rows, replaceRange }) },
  );
}

/** The Progress tab's save: every row, in one transaction, hard rules enforced. */
export async function saveContent(experimentId: string, rows: unknown[]) {
  return request<{ count: number }>(`/api/admin/experiments/${experimentId}/content/all`, {
    method: "PUT",
    body: JSON.stringify({ rows }),
  });
}

// ── Results ────────────────────────────────────────────

export async function listResults(experimentId: string) {
  return request<unknown[]>(`/api/admin/experiments/${experimentId}/results`);
}

/** `csv`: responses; `files`: recordings and uploaded files (ZIP); `json`: the experiment design. */
export type ExportKind = "csv" | "files" | "json";

/**
 * Start a download of one export. A browser download cannot send the login
 * header, so the server first gives a 5-minute download token for this
 * experiment, which goes in the URL instead of the login token.
 */
export async function downloadExport(experimentId: string, kind: ExportKind): Promise<void> {
  const { token } = await request<{ token: string }>(
    `/api/admin/experiments/${experimentId}/export/token`,
    { method: "POST" },
  );
  window.location.assign(
    `${BaseUrl}/api/admin/experiments/${experimentId}/export/${kind}?token=${encodeURIComponent(token)}`,
  );
}

export async function importExperimentJson(body: unknown) {
  return request<{ id: string; name: string; contentRows: number }>(
    "/api/admin/experiments/import/json",
    { method: "POST", body: JSON.stringify(body) },
  );
}

// ── Assets ─────────────────────────────────────────────

export interface AssetSummary {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  /** The row exists but its file does not — imported and not yet restored. */
  missing: boolean;
  createdAt: string;
}

export async function listAssets(experimentId: string) {
  return request<{ assets: AssetSummary[] }>(
    `/api/admin/experiments/${experimentId}/assets`,
  );
}

export async function deleteAsset(assetId: string) {
  return request<void>(`/api/admin/assets/${assetId}`, { method: "DELETE" });
}

// ── Errors ─────────────────────────────────────────────

export async function listExperimentErrors(experimentId: string, status = "open") {
  return request<StoredErrorGroup[]>(
    `/api/admin/experiments/${experimentId}/errors?status=${status}`,
  );
}

export async function listPlatformErrors(scope = "all", status = "open") {
  return request<StoredErrorGroup[]>(`/api/admin/errors?scope=${scope}&status=${status}`);
}

export async function listErrorEvents(groupId: string) {
  return request<StoredErrorEvent[]>(`/api/admin/errors/${groupId}/events`);
}

export async function resolveError(groupId: string) {
  return request<StoredErrorGroup>(`/api/admin/errors/${groupId}/resolve`, { method: "POST" });
}

export async function reopenError(groupId: string) {
  return request<StoredErrorGroup>(`/api/admin/errors/${groupId}/reopen`, { method: "POST" });
}
