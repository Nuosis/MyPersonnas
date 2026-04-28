/**
 * Chain Run Database — SQLite persistence for chain execution history
 * 
 * Stores: chain runs with their original inputs and all step outputs
 * Auto-purges records older than 7 days (unless preserved)
 */

import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const DB_PATH = join(process.env.HOME || "", ".pi", "agent", "agents", "chains", "chain-runs.db");
const TTL_DAYS = 7;

// Ensure directory exists
const dbDir = join(DB_PATH, "..");
if (!existsSync(dbDir)) {
	mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// ── Schema ───────────────────────────────────────

db.exec(`
	CREATE TABLE IF NOT EXISTS chain_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chain_name TEXT NOT NULL,
		original_input TEXT NOT NULL,
		started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		ended_at DATETIME,
		status TEXT DEFAULT 'running',
		preserved INTEGER DEFAULT 0,
		total_elapsed_ms INTEGER
	);

	CREATE TABLE IF NOT EXISTS chain_steps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		run_id INTEGER NOT NULL,
		step_index INTEGER NOT NULL,
		agent_name TEXT NOT NULL,
		step_input TEXT,
		step_output TEXT,
		status TEXT DEFAULT 'pending',
		started_at DATETIME,
		ended_at DATETIME,
		elapsed_ms INTEGER,
		FOREIGN KEY (run_id) REFERENCES chain_runs(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_runs_started ON chain_runs(started_at);
	CREATE INDEX IF NOT EXISTS idx_runs_preserved ON chain_runs(preserved);
	CREATE INDEX IF NOT EXISTS idx_steps_run ON chain_steps(run_id);
`);

// ── Types ────────────────────────────────────────

export interface ChainRun {
	id?: number;
	chain_name: string;
	original_input: string;
	started_at?: string;
	ended_at?: string;
	status: "running" | "done" | "error" | "stopped";
	preserved?: boolean;
	total_elapsed_ms?: number;
}

export interface ChainStepRecord {
	id?: number;
	run_id: number;
	step_index: number;
	agent_name: string;
	step_input?: string;
	step_output?: string;
	status: "pending" | "running" | "done" | "error" | "stopped";
	started_at?: string;
	ended_at?: string;
	elapsed_ms?: number;
}

// ── Operations ──────────────────────────────────

export function startRun(chainName: string, originalInput: string): number {
	const stmt = db.prepare(`
		INSERT INTO chain_runs (chain_name, original_input, status)
		VALUES (?, ?, 'running')
	`);
	const result = stmt.run(chainName, originalInput);
	return result.lastInsertRowid as number;
}

export function completeRun(
	runId: number,
	status: "done" | "error" | "stopped",
	elapsedMs: number
): void {
	const stmt = db.prepare(`
		UPDATE chain_runs 
		SET status = ?, ended_at = CURRENT_TIMESTAMP, total_elapsed_ms = ?
		WHERE id = ?
	`);
	stmt.run(status, elapsedMs, runId);
}

export function startStep(
	runId: number,
	stepIndex: number,
	agentName: string,
	stepInput: string
): number {
	const stmt = db.prepare(`
		INSERT INTO chain_steps (run_id, step_index, agent_name, step_input, status, started_at)
		VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
	`);
	const result = stmt.run(runId, stepIndex, agentName, stepInput);
	return result.lastInsertRowid as number;
}

export function completeStep(
	stepId: number,
	stepOutput: string,
	status: "done" | "error" | "stopped",
	elapsedMs: number
): void {
	const stmt = db.prepare(`
		UPDATE chain_steps 
		SET step_output = ?, status = ?, ended_at = CURRENT_TIMESTAMP, elapsed_ms = ?
		WHERE id = ?
	`);
	stmt.run(stepOutput, status, elapsedMs, stepId);
}

export function preserveRun(runId: number): void {
	const stmt = db.prepare(`UPDATE chain_runs SET preserved = 1 WHERE id = ?`);
	stmt.run(runId);
}

export function unpreserveRun(runId: number): void {
	const stmt = db.prepare(`UPDATE chain_runs SET preserved = 0 WHERE id = ?`);
	stmt.run(runId);
}

export function getRun(runId: number): ChainRun | null {
	const stmt = db.prepare(`SELECT * FROM chain_runs WHERE id = ?`);
	return (stmt.get(runId) as ChainRun) || null;
}

export function getRunSteps(runId: number): ChainStepRecord[] {
	const stmt = db.prepare(`
		SELECT * FROM chain_steps 
		WHERE run_id = ? 
		ORDER BY step_index
	`);
	return stmt.all(runId) as ChainStepRecord[];
}

export interface RunSummary {
	id: number;
	chain_name: string;
	original_input: string;
	started_at: string;
	status: string;
	preserved: boolean;
	total_elapsed_ms: number | null;
	step_count: number;
}

export function listRuns(limit = 20, offset = 0): RunSummary[] {
	const stmt = db.prepare(`
		SELECT 
			r.id, r.chain_name, r.original_input, r.started_at, 
			r.status, r.preserved, r.total_elapsed_ms,
			COUNT(s.id) as step_count
		FROM chain_runs r
		LEFT JOIN chain_steps s ON s.run_id = r.id
		GROUP BY r.id
		ORDER BY r.started_at DESC
		LIMIT ? OFFSET ?
	`);
	return stmt.all(limit, offset) as RunSummary[];
}

export function searchRuns(query: string, limit = 20): RunSummary[] {
	const stmt = db.prepare(`
		SELECT 
			r.id, r.chain_name, r.original_input, r.started_at, 
			r.status, r.preserved, r.total_elapsed_ms,
			COUNT(s.id) as step_count
		FROM chain_runs r
		LEFT JOIN chain_steps s ON s.run_id = r.id
		WHERE r.original_input LIKE ? OR r.chain_name LIKE ?
		GROUP BY r.id
		ORDER BY r.started_at DESC
		LIMIT ?
	`);
	const likeQuery = `%${query}%`;
	return stmt.all(likeQuery, likeQuery, limit) as RunSummary[];
}

export function getLastRun(chainName?: string): ChainRun | null {
	let query = `SELECT * FROM chain_runs`;
	if (chainName) {
		query += ` WHERE chain_name = ?`;
	}
	query += ` ORDER BY started_at DESC LIMIT 1`;
	
	const stmt = db.prepare(query);
	return (chainName ? stmt.get(chainName) : stmt.get()) as ChainRun | null;
}

// ── Purge (runs on startup + can be called manually) ──

export function purgeOldRuns(): number {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - TTL_DAYS);
	const cutoffStr = cutoff.toISOString();

	const stmt = db.prepare(`
		DELETE FROM chain_runs 
		WHERE preserved = 0 AND started_at < ?
	`);
	const result = stmt.run(cutoffStr);
	return result.changes;
}

// Run purge on startup
const purged = purgeOldRuns();
if (purged > 0) {
	console.log(`[chain-db] Purged ${purged} expired chain runs`);
}
