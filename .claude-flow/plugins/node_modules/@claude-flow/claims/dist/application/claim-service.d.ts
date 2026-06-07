/**
 * Claim Service - Application Layer
 *
 * Implements IClaimService interface for managing issue claims.
 * Supports both human and agent claimants with handoff capabilities.
 *
 * Key Features:
 * - Issue claiming and releasing
 * - Human-to-agent and agent-to-agent handoffs
 * - Status tracking and updates
 * - Auto-management (expiration, auto-assignment)
 * - Full event sourcing (ADR-007)
 *
 * @module v3/claims/application/claim-service
 */
import { Claimant, ClaimStatus, Issue, IssueClaim, IssueWithClaim, IssueFilters, ClaimResult, Duration } from '../domain/types.js';
import { IClaimRepository, IIssueRepository, IClaimantRepository, IClaimEventStore } from '../domain/repositories.js';
/**
 * IClaimService interface - main contract for claim operations
 */
export interface IClaimService {
    /**
     * Claim an issue for a claimant
     */
    claim(issueId: string, claimant: Claimant): Promise<ClaimResult>;
    /**
     * Release a claim on an issue
     */
    release(issueId: string, claimant: Claimant): Promise<void>;
    /**
     * Request a handoff from one claimant to another
     */
    requestHandoff(issueId: string, from: Claimant, to: Claimant, reason: string): Promise<void>;
    /**
     * Accept a pending handoff
     */
    acceptHandoff(issueId: string, claimant: Claimant): Promise<void>;
    /**
     * Reject a pending handoff
     */
    rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void>;
    /**
     * Update the status of a claim
     */
    updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void>;
    /**
     * Request review for a claimed issue
     */
    requestReview(issueId: string, reviewers: Claimant[]): Promise<void>;
    /**
     * Get all issues claimed by a specific claimant
     */
    getClaimedBy(claimant: Claimant): Promise<IssueClaim[]>;
    /**
     * Get available (unclaimed) issues matching filters
     */
    getAvailableIssues(filters?: IssueFilters): Promise<Issue[]>;
    /**
     * Get the current status of an issue including claim info
     */
    getIssueStatus(issueId: string): Promise<IssueWithClaim>;
    /**
     * Expire stale claims that haven't had activity
     */
    expireStale(maxAge: Duration): Promise<IssueClaim[]>;
    /**
     * Auto-assign an issue to the best available claimant
     */
    autoAssign(issue: Issue): Promise<Claimant | null>;
}
/**
 * Claim Service implementation with event sourcing
 */
export declare class ClaimService implements IClaimService {
    private readonly claimRepository;
    private readonly issueRepository;
    private readonly claimantRepository;
    private readonly eventStore;
    constructor(claimRepository: IClaimRepository, issueRepository: IIssueRepository, claimantRepository: IClaimantRepository, eventStore: IClaimEventStore);
    claim(issueId: string, claimant: Claimant): Promise<ClaimResult>;
    release(issueId: string, claimant: Claimant): Promise<void>;
    requestHandoff(issueId: string, from: Claimant, to: Claimant, reason: string): Promise<void>;
    acceptHandoff(issueId: string, claimant: Claimant): Promise<void>;
    rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void>;
    updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void>;
    requestReview(issueId: string, reviewers: Claimant[]): Promise<void>;
    getClaimedBy(claimant: Claimant): Promise<IssueClaim[]>;
    getAvailableIssues(filters?: IssueFilters): Promise<Issue[]>;
    getIssueStatus(issueId: string): Promise<IssueWithClaim>;
    expireStale(maxAge: Duration): Promise<IssueClaim[]>;
    autoAssign(issue: Issue): Promise<Claimant | null>;
    /**
     * Get valid status transitions from a given status
     */
    private getValidStatusTransitions;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=claim-service.d.ts.map