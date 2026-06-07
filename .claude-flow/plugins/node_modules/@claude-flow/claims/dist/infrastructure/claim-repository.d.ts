/**
 * @claude-flow/claims - Claim Repository Implementation
 * SQLite-based persistence for claims (ADR-016)
 *
 * @module v3/claims/infrastructure/claim-repository
 */
import { ClaimId, IssueId, Claimant, ClaimStatus, IssueClaim, IssueClaimWithStealing, AgentType, ClaimQueryOptions, ClaimStatistics } from '../domain/types.js';
import { IClaimRepository } from '../domain/repositories.js';
import { IIssueClaimRepository } from '../domain/types.js';
/**
 * In-memory implementation of the claim repository
 * Suitable for development and testing
 */
export declare class InMemoryClaimRepository implements IClaimRepository, IIssueClaimRepository {
    private claims;
    private issueIndex;
    private claimantIndex;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    save(claim: IssueClaim | IssueClaimWithStealing): Promise<void>;
    update(claim: IssueClaimWithStealing): Promise<void>;
    findById(claimId: ClaimId): Promise<IssueClaimWithStealing | null>;
    findByIssueId(issueId: IssueId, repository?: string): Promise<IssueClaimWithStealing | null>;
    findByClaimant(claimant: Claimant): Promise<IssueClaim[]>;
    findByAgentId(agentId: string): Promise<IssueClaimWithStealing[]>;
    findByStatus(status: ClaimStatus): Promise<IssueClaim[]>;
    findStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]>;
    findContested(): Promise<IssueClaimWithStealing[]>;
    findAll(): Promise<IssueClaimWithStealing[]>;
    delete(claimId: ClaimId): Promise<void>;
    findActiveClaims(): Promise<IssueClaim[]>;
    findStaleClaims(staleSince: Date): Promise<IssueClaim[]>;
    findClaimsWithPendingHandoffs(): Promise<IssueClaim[]>;
    countByClaimant(claimantId: string): Promise<number>;
    countByAgentId(agentId: string): Promise<number>;
    query(options: ClaimQueryOptions): Promise<IssueClaimWithStealing[]>;
    getStatistics(): Promise<ClaimStatistics>;
    private getIssueKey;
    private isActiveStatus;
    private ensureFullClaim;
}
/**
 * Create a new claim repository
 */
export declare function createClaimRepository(): InMemoryClaimRepository;
//# sourceMappingURL=claim-repository.d.ts.map