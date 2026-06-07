/**
 * V3 CLI Claims Command
 * Issue claiming and work distribution management
 *
 * Implements:
 * - Core claiming commands (list, claim, release, handoff, status)
 * - Work stealing commands (stealable, steal, mark-stealable, contest)
 * - Load balancing commands (load, rebalance)
 */
import type { Command } from './cli-types.js';
export interface ClaimServices {
    claimIssue: (issueId: string, claimantId: string, claimantType: ClaimantType) => Promise<Claim>;
    releaseClaim: (issueId: string, claimantId: string) => Promise<void>;
    requestHandoff: (issueId: string, targetId: string, targetType: ClaimantType) => Promise<HandoffRequest>;
    updateStatus: (issueId: string, status: ClaimStatus, reason?: string) => Promise<Claim>;
    listClaims: (filter?: ClaimFilter) => Promise<Claim[]>;
    listStealable: () => Promise<Claim[]>;
    stealIssue: (issueId: string, stealerId: string) => Promise<Claim>;
    markStealable: (issueId: string, reason?: string) => Promise<Claim>;
    contestSteal: (issueId: string, contesterId: string, reason: string) => Promise<ContestResult>;
    getAgentLoad: (agentId?: string) => Promise<AgentLoad[]>;
    rebalance: (dryRun?: boolean) => Promise<RebalanceResult>;
}
export type ClaimantType = 'agent' | 'human';
export type ClaimStatus = 'active' | 'blocked' | 'review-requested' | 'stealable' | 'completed';
export interface Claim {
    issueId: string;
    claimantId: string;
    claimantType: ClaimantType;
    status: ClaimStatus;
    progress: number;
    claimedAt: string;
    expiresAt?: string;
    blockedReason?: string;
    stealableReason?: string;
}
export interface ClaimFilter {
    claimantId?: string;
    status?: ClaimStatus;
    available?: boolean;
}
export interface HandoffRequest {
    issueId: string;
    fromId: string;
    toId: string;
    toType: ClaimantType;
    requestedAt: string;
    status: 'pending' | 'accepted' | 'rejected';
}
export interface ContestResult {
    issueId: string;
    contesterId: string;
    originalClaimantId: string;
    resolution: 'steal-reverted' | 'steal-upheld' | 'pending-review';
    reason?: string;
}
export interface AgentLoad {
    agentId: string;
    agentType: string;
    activeIssues: number;
    totalCapacity: number;
    utilizationPercent: number;
    avgCompletionTime: string;
    status: 'healthy' | 'overloaded' | 'idle';
}
export interface RebalanceResult {
    moved: number;
    reassignments: Array<{
        issueId: string;
        fromAgent: string;
        toAgent: string;
        reason: string;
    }>;
    skipped: number;
    dryRun: boolean;
}
export declare const issuesCommand: Command;
/**
 * Create issues command with injected services
 * This allows for testing with mock services
 */
export declare function createIssuesCommand(services: ClaimServices): Command;
export default issuesCommand;
//# sourceMappingURL=cli-commands.d.ts.map