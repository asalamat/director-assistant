/**
 * @claude-flow/claims - Business Rules (ADR-016)
 * Domain rules for claiming, stealing eligibility, and load balancing
 *
 * Pure functions that encode the business logic for the claiming system
 */
import type { IssueClaim, Claimant, ClaimStatus, IssuePriority, WorkStealingConfig, IssueClaimWithStealing, StealableReason, ExtendedClaimStatus } from './types.js';
export interface RuleResult<T = boolean> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}
export declare function ruleSuccess<T>(data: T): RuleResult<T>;
export declare function ruleFailure(code: string, message: string, details?: Record<string, unknown>): RuleResult<never>;
/**
 * Check if a claimant can claim a new issue
 */
export declare function canClaimIssue(claimant: Claimant, existingClaims: readonly IssueClaim[]): RuleResult<boolean>;
/**
 * Check if an issue is already claimed
 */
export declare function isIssueClaimed(issueId: string, claims: readonly IssueClaim[]): IssueClaim | null;
/**
 * Determine if a claim status is considered "active"
 */
export declare function isActiveClaim(status: ClaimStatus | ExtendedClaimStatus): boolean;
/**
 * Get valid status transitions for original ClaimStatus
 */
export declare function getOriginalStatusTransitions(currentStatus: ClaimStatus): readonly ClaimStatus[];
/**
 * Get valid status transitions for ExtendedClaimStatus (ADR-016)
 */
export declare function getExtendedStatusTransitions(currentStatus: ExtendedClaimStatus): readonly ExtendedClaimStatus[];
/**
 * Check if a status transition is valid
 */
export declare function canTransitionStatus(currentStatus: ClaimStatus | ExtendedClaimStatus, newStatus: ClaimStatus | ExtendedClaimStatus): RuleResult<boolean>;
/**
 * Check if a claim is eligible to be marked as stealable
 */
export declare function canMarkAsStealable(claim: IssueClaimWithStealing, config: WorkStealingConfig, now?: Date): RuleResult<StealableReason | null>;
/**
 * Check if a claim can be stolen by a specific agent
 */
export declare function canStealClaim(claim: IssueClaimWithStealing, challenger: Claimant, config: WorkStealingConfig, now?: Date): RuleResult<boolean>;
/**
 * Determine if a contest is required for stealing
 */
export declare function requiresStealContest(claim: IssueClaimWithStealing, config: WorkStealingConfig): boolean;
/**
 * Check if a handoff can be initiated
 */
export declare function canInitiateHandoff(claim: IssueClaim, targetClaimant: Claimant, currentClaimant: Claimant): RuleResult<boolean>;
/**
 * Check if a handoff can be accepted
 */
export declare function canAcceptHandoff(claim: IssueClaim, acceptingClaimant: Claimant): RuleResult<boolean>;
/**
 * Check if a handoff can be rejected
 */
export declare function canRejectHandoff(claim: IssueClaim, rejectingClaimant: Claimant): RuleResult<boolean>;
/**
 * Determine if an agent is overloaded
 */
export declare function isAgentOverloaded(load: number, threshold?: number): boolean;
/**
 * Determine if an agent is underloaded
 */
export declare function isAgentUnderloaded(load: number, threshold?: number): boolean;
/**
 * Check if rebalancing is needed for a set of agents
 */
export declare function needsRebalancing(agentLoads: readonly {
    load: number;
}[], config: {
    overloadThreshold: number;
    underloadThreshold: number;
    rebalanceThreshold: number;
}): boolean;
/**
 * Check if a claim can be moved during rebalancing
 */
export declare function canMoveClaim(claim: IssueClaimWithStealing): boolean;
/**
 * Validate claim priority
 */
export declare function isValidPriority(priority: string): priority is IssuePriority;
/**
 * Validate claim status
 */
export declare function isValidStatus(status: string): status is ClaimStatus;
/**
 * Validate extended claim status (ADR-016)
 */
export declare function isValidExtendedStatus(status: string): status is ExtendedClaimStatus;
/**
 * Validate repository format (owner/repo)
 */
export declare function isValidRepository(repository: string): boolean;
//# sourceMappingURL=rules.d.ts.map