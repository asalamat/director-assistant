/**
 * Claims Domain Types
 *
 * Core type definitions for the issue claiming system.
 * Supports both human and agent claimants with handoff capabilities.
 *
 * @module v3/claims/domain/types
 */
/**
 * Unique identifier for claims
 */
export type ClaimId = `claim-${string}`;
/**
 * Unique identifier for issues
 */
export type IssueId = string;
/**
 * Claimant type - human or agent
 */
export type ClaimantType = 'human' | 'agent';
/**
 * Claim status lifecycle
 */
export type ClaimStatus = 'active' | 'pending_handoff' | 'in_review' | 'completed' | 'released' | 'expired' | 'paused' | 'blocked' | 'stealable';
/**
 * Issue labels/tags
 */
export type IssueLabel = string;
/**
 * Issue priority levels
 */
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
/**
 * Issue complexity levels
 */
export type IssueComplexity = 'trivial' | 'simple' | 'moderate' | 'complex' | 'epic';
/**
 * Duration value object for time-based operations
 */
export interface Duration {
    value: number;
    unit: 'ms' | 'seconds' | 'minutes' | 'hours' | 'days';
}
/**
 * Convert duration to milliseconds
 */
export declare function durationToMs(duration: Duration): number;
/**
 * Claimant - a human or agent that can claim issues
 */
export interface Claimant {
    id: string;
    type: ClaimantType;
    name: string;
    capabilities?: string[];
    specializations?: string[];
    currentWorkload?: number;
    maxConcurrentClaims?: number;
    metadata?: Record<string, unknown>;
}
/**
 * Issue - a work item that can be claimed
 */
export interface Issue {
    id: IssueId;
    title: string;
    description: string;
    labels: IssueLabel[];
    priority: IssuePriority;
    complexity: IssueComplexity;
    requiredCapabilities?: string[];
    estimatedDuration?: Duration;
    repositoryId?: string;
    url?: string;
    createdAt: Date;
    updatedAt: Date;
    metadata?: Record<string, unknown>;
}
/**
 * Issue claim - represents an active claim on an issue
 */
export interface IssueClaim {
    id: ClaimId;
    issueId: IssueId;
    claimant: Claimant;
    status: ClaimStatus;
    claimedAt: Date;
    lastActivityAt: Date;
    expiresAt?: Date;
    notes?: string[];
    handoffChain?: HandoffRecord[];
    reviewers?: Claimant[];
    metadata?: Record<string, unknown>;
}
/**
 * Handoff record - tracks handoff history
 */
export interface HandoffRecord {
    id: string;
    from: Claimant;
    to: Claimant;
    reason: string;
    status: 'pending' | 'accepted' | 'rejected';
    requestedAt: Date;
    resolvedAt?: Date;
    rejectionReason?: string;
}
/**
 * Issue with claim information
 */
export interface IssueWithClaim {
    issue: Issue;
    claim: IssueClaim | null;
    pendingHandoffs: HandoffRecord[];
}
/**
 * Claim result - returned when claiming an issue
 */
export interface ClaimResult {
    success: boolean;
    claim?: IssueClaim;
    error?: ClaimError;
}
/**
 * Filters for querying issues
 */
export interface IssueFilters {
    labels?: IssueLabel[];
    priority?: IssuePriority[];
    complexity?: IssueComplexity[];
    requiredCapabilities?: string[];
    excludeClaimed?: boolean;
    repositoryId?: string;
    limit?: number;
    offset?: number;
}
/**
 * Claim error codes
 */
export type ClaimErrorCode = 'ALREADY_CLAIMED' | 'NOT_CLAIMED' | 'CLAIM_NOT_FOUND' | 'ISSUE_NOT_FOUND' | 'CLAIMANT_NOT_FOUND' | 'INVALID_CLAIMANT' | 'HANDOFF_PENDING' | 'HANDOFF_NOT_FOUND' | 'UNAUTHORIZED' | 'MAX_CLAIMS_EXCEEDED' | 'CAPABILITY_MISMATCH' | 'INVALID_STATUS_TRANSITION' | 'VALIDATION_ERROR';
/**
 * Claim error with details
 */
export interface ClaimError {
    code: ClaimErrorCode;
    message: string;
    details?: Record<string, unknown>;
}
/**
 * Custom error class for claim operations
 */
export declare class ClaimOperationError extends Error {
    readonly code: ClaimErrorCode;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: ClaimErrorCode, message: string, details?: Record<string, unknown> | undefined);
    toClaimError(): ClaimError;
}
/**
 * Agent type for cross-type steal rules
 */
export type AgentType = 'coder' | 'debugger' | 'tester' | 'reviewer' | 'researcher' | 'planner' | 'architect' | 'coordinator';
/**
 * Reason an issue became stealable
 */
export type StealableReason = 'stale' | 'blocked' | 'overloaded' | 'manual' | 'timeout';
/**
 * Information about why an issue is stealable
 */
export interface StealableInfo {
    reason: StealableReason;
    markedAt: Date;
    expiresAt?: Date;
    originalProgress: number;
    allowedStealerTypes?: AgentType[];
}
/**
 * Error codes specific to steal operations
 */
export type StealErrorCode = 'NOT_STEALABLE' | 'ALREADY_CLAIMED' | 'CROSS_TYPE_NOT_ALLOWED' | 'IN_GRACE_PERIOD' | 'PROTECTED_BY_PROGRESS' | 'STEALER_OVERLOADED' | 'ISSUE_NOT_FOUND' | 'CONTEST_PENDING';
/**
 * Result of a steal operation
 */
export interface StealResult {
    success: boolean;
    claim?: IssueClaim;
    previousClaimant?: Claimant;
    contestWindowEndsAt?: Date;
    error?: string;
    errorCode?: StealErrorCode;
}
/**
 * Information about a contested steal
 */
export interface ContestInfo {
    contestedAt: Date;
    contestedBy: Claimant;
    stolenBy: Claimant;
    reason: string;
    windowEndsAt: Date;
    resolution?: ContestResolution;
}
/**
 * Resolution of a contest
 */
export interface ContestResolution {
    resolvedAt: Date;
    winner: Claimant;
    resolvedBy: 'queen' | 'human' | 'timeout';
    reason: string;
}
/**
 * Work stealing configuration
 */
export interface WorkStealingConfig {
    /** Minutes without progress before issue becomes stealable */
    staleThresholdMinutes: number;
    /** Minutes blocked before issue becomes stealable */
    blockedThresholdMinutes: number;
    /** Max claims per agent before lowest priority becomes stealable */
    overloadThreshold: number;
    /** Minutes after claiming before work can be stolen */
    gracePeriodMinutes: number;
    /** Progress percentage that protects from stealing (0-100) */
    minProgressToProtect: number;
    /** Minutes to contest a steal */
    contestWindowMinutes: number;
    /** Enable cross-type stealing */
    allowCrossTypeSteal: boolean;
    /** Agent type pairs that can steal from each other */
    crossTypeStealRules: [AgentType, AgentType][];
}
/**
 * Default work stealing configuration
 */
export declare const DEFAULT_WORK_STEALING_CONFIG: WorkStealingConfig;
/**
 * Extended IssueClaim with work stealing properties
 */
export interface IssueClaimWithStealing extends IssueClaim {
    progress: number;
    blockedReason?: string;
    blockedAt?: Date;
    stealableAt?: Date;
    stealInfo?: StealableInfo;
    contestInfo?: ContestInfo;
}
/**
 * Event types for work stealing
 */
export type WorkStealingEventType = 'IssueMarkedStealable' | 'IssueStolen' | 'StealContested' | 'StealContestResolved';
/**
 * Base event interface for work stealing
 */
export interface WorkStealingEvent {
    id: string;
    type: WorkStealingEventType;
    timestamp: Date;
    issueId: IssueId;
    claimId: ClaimId;
    payload: unknown;
}
/**
 * Event: Issue marked as stealable
 */
export interface IssueMarkedStealableEvent extends WorkStealingEvent {
    type: 'IssueMarkedStealable';
    payload: {
        info: StealableInfo;
        currentClaimant: Claimant;
        claim: IssueClaimWithStealing;
    };
}
/**
 * Event: Issue stolen
 */
export interface IssueStolenEvent extends WorkStealingEvent {
    type: 'IssueStolen';
    payload: {
        previousClaimant: Claimant;
        newClaimant: Claimant;
        stealableInfo: StealableInfo;
        contestWindowEndsAt: Date;
    };
}
/**
 * Event: Steal contested
 */
export interface StealContestedEvent extends WorkStealingEvent {
    type: 'StealContested';
    payload: {
        contestInfo: ContestInfo;
        claim: IssueClaimWithStealing;
    };
}
/**
 * Event: Contest resolved
 */
export interface StealContestResolvedEvent extends WorkStealingEvent {
    type: 'StealContestResolved';
    payload: {
        contestInfo: ContestInfo;
        resolution: ContestResolution;
        winnerClaim: IssueClaimWithStealing;
    };
}
/**
 * Repository interface for issue claims with work stealing support
 */
export interface IIssueClaimRepository {
    findById(id: ClaimId): Promise<IssueClaimWithStealing | null>;
    findByIssueId(issueId: IssueId): Promise<IssueClaimWithStealing | null>;
    findByAgentId(agentId: string): Promise<IssueClaimWithStealing[]>;
    findStealable(agentType?: AgentType): Promise<IssueClaimWithStealing[]>;
    findContested(): Promise<IssueClaimWithStealing[]>;
    findAll(): Promise<IssueClaimWithStealing[]>;
    save(claim: IssueClaimWithStealing): Promise<void>;
    update(claim: IssueClaimWithStealing): Promise<void>;
    delete(id: ClaimId): Promise<void>;
    countByAgentId(agentId: string): Promise<number>;
}
/**
 * Event bus interface for work stealing events
 */
export interface IWorkStealingEventBus {
    emit(event: WorkStealingEvent): Promise<void>;
    subscribe(eventType: WorkStealingEventType, handler: (event: WorkStealingEvent) => void | Promise<void>): () => void;
    subscribeAll(handler: (event: WorkStealingEvent) => void | Promise<void>): () => void;
}
/**
 * Extended claim status per ADR-016
 * Includes all lifecycle states for human/agent claiming
 */
export type ExtendedClaimStatus = 'active' | 'paused' | 'handoff-pending' | 'review-requested' | 'blocked' | 'stealable' | 'completed';
/**
 * Agent identifier type
 */
export type AgentId = `agent-${string}` | string;
/**
 * Human user identifier
 */
export type UserId = string;
/**
 * Reasons why a claim might be blocked
 */
export type BlockedReason = 'dependency' | 'external' | 'clarification' | 'resource' | 'approval' | 'other';
/**
 * Information about a blocked claim
 */
export interface BlockedInfo {
    readonly reason: BlockedReason;
    readonly description: string;
    readonly relatedIssues: readonly IssueId[];
    readonly blockedAt: number;
    readonly estimatedUnblockTime?: number;
}
/**
 * Reason for work stealing per ADR-016
 */
export type StealReason = 'timeout' | 'overloaded' | 'blocked' | 'voluntary' | 'rebalancing' | 'abandoned' | 'priority-change';
/**
 * Extended StealableInfo per ADR-016
 */
export interface ExtendedStealableInfo {
    readonly reason: StealReason;
    readonly markedAt: number;
    readonly originalClaimant: Claimant;
    readonly minPriorityToSteal: IssuePriority;
    readonly requiresContest: boolean;
    readonly gracePeriodMs: number;
    readonly gracePeriodEndsAt: number;
    readonly previousSteals: number;
    readonly interestedAgents: readonly AgentId[];
}
/**
 * Handoff reason per ADR-016
 */
export type HandoffReason = 'capacity' | 'expertise' | 'shift-change' | 'escalation' | 'voluntary' | 'rebalancing';
/**
 * Extended handoff info per ADR-016
 */
export interface ExtendedHandoffInfo {
    readonly initiatedBy: AgentId | UserId;
    readonly targetClaimant: Claimant;
    readonly requestedAt: number;
    readonly expiresAt: number;
    readonly reason: HandoffReason;
    readonly notes?: string;
    readonly contextSummary?: string;
    readonly artifacts: readonly string[];
}
/**
 * Claimant workload metrics per ADR-016
 */
export interface ClaimantWorkload {
    readonly activeClaims: number;
    readonly pausedClaims: number;
    readonly pendingHandoffs: number;
    readonly completedClaims: number;
    readonly averageCompletionTime: number;
    readonly loadPercentage: number;
    readonly availableCapacity: number;
}
/**
 * Extended Claimant with ADR-016 properties
 */
export interface ExtendedClaimant extends Claimant {
    readonly workload: ClaimantWorkload;
    readonly priority: number;
    readonly registeredAt: number;
    readonly lastActivityAt: number;
    readonly isAvailable: boolean;
}
/**
 * Agent load information per ADR-016
 */
export interface AgentLoadInfo {
    readonly agentId: AgentId;
    readonly name: string;
    readonly activeClaims: number;
    readonly maxClaims: number;
    readonly loadPercentage: number;
    readonly isOverloaded: boolean;
    readonly isUnderloaded: boolean;
    readonly capabilities: readonly string[];
    readonly processingRate: number;
    readonly avgClaimDuration: number;
    readonly queueDepth: number;
    readonly healthScore: number;
}
/**
 * Claim move during rebalancing
 */
export interface ClaimMove {
    readonly claimId: ClaimId;
    readonly fromAgent: AgentId;
    readonly toAgent: AgentId;
    readonly reason: string;
    readonly success: boolean;
}
/**
 * Rebalancing error
 */
export interface RebalanceError {
    readonly claimId: ClaimId;
    readonly error: string;
    readonly recoverable: boolean;
}
/**
 * Rebalance result per ADR-016
 */
export interface ExtendedRebalanceResult {
    readonly success: boolean;
    readonly claimsMoved: number;
    readonly moves: readonly ClaimMove[];
    readonly overloadedAgents: readonly AgentId[];
    readonly underloadedAgents: readonly AgentId[];
    readonly loadBefore: readonly AgentLoadInfo[];
    readonly loadAfter: readonly AgentLoadInfo[];
    readonly durationMs: number;
    readonly errors: readonly RebalanceError[];
    readonly timestamp: number;
}
/**
 * Rebalance strategy
 */
export type RebalanceStrategy = 'oldest-first' | 'newest-first' | 'lowest-priority' | 'least-progress' | 'capability-match';
/**
 * Load balancing configuration per ADR-016
 */
export interface LoadBalancingConfig {
    readonly enabled: boolean;
    readonly checkIntervalMs: number;
    readonly overloadThreshold: number;
    readonly underloadThreshold: number;
    readonly rebalanceThreshold: number;
    readonly maxMovesPerRebalance: number;
    readonly selectionStrategy: RebalanceStrategy;
    readonly respectCapabilities: boolean;
    readonly cooldownMs: number;
}
/**
 * Default load balancing config
 */
export declare const DEFAULT_LOAD_BALANCING_CONFIG: LoadBalancingConfig;
/**
 * Extended IssueClaim with all ADR-016 properties
 */
export interface ExtendedIssueClaim {
    readonly id: ClaimId;
    readonly issueId: IssueId;
    readonly repository: string;
    readonly claimant: ExtendedClaimant;
    readonly status: ExtendedClaimStatus;
    readonly claimedAt: number;
    readonly updatedAt: number;
    readonly startedAt?: number;
    readonly completedAt?: number;
    readonly expiresAt?: number;
    readonly priority: IssuePriority;
    readonly tags: readonly string[];
    readonly progress: number;
    readonly blockedInfo?: BlockedInfo;
    readonly stealableInfo?: ExtendedStealableInfo;
    readonly handoffInfo?: ExtendedHandoffInfo;
    readonly pullRequestId?: number;
    readonly notes: readonly ClaimNote[];
    readonly statusHistory: readonly StatusChange[];
    readonly metadata: Record<string, unknown>;
}
/**
 * Claim note
 */
export interface ClaimNote {
    readonly id: string;
    readonly content: string;
    readonly authorId: AgentId | UserId;
    readonly createdAt: number;
    readonly type: 'progress' | 'question' | 'blocker' | 'general';
}
/**
 * Status change record
 */
export interface StatusChange {
    readonly fromStatus: ExtendedClaimStatus;
    readonly toStatus: ExtendedClaimStatus;
    readonly changedAt: number;
    readonly changedBy: AgentId | UserId;
    readonly reason?: string;
}
/**
 * Query options for claims
 */
export interface ClaimQueryOptions {
    readonly claimantId?: AgentId | UserId;
    readonly claimantType?: ClaimantType;
    readonly status?: ExtendedClaimStatus | readonly ExtendedClaimStatus[];
    readonly repository?: string;
    readonly issueId?: IssueId;
    readonly priority?: IssuePriority | readonly IssuePriority[];
    readonly tags?: readonly string[];
    readonly createdAfter?: number;
    readonly createdBefore?: number;
    readonly updatedAfter?: number;
    readonly stealableOnly?: boolean;
    readonly blockedOnly?: boolean;
    readonly limit?: number;
    readonly offset?: number;
    readonly sortBy?: 'claimedAt' | 'updatedAt' | 'priority' | 'progress';
    readonly sortDirection?: 'asc' | 'desc';
}
/**
 * Claim statistics
 */
export interface ClaimStatistics {
    readonly totalClaims: number;
    readonly byStatus: Record<ExtendedClaimStatus, number>;
    readonly byPriority: Record<IssuePriority, number>;
    readonly byClaimantType: Record<ClaimantType, number>;
    readonly avgDurationMs: number;
    readonly avgProgress: number;
    readonly activeSteals: number;
    readonly pendingHandoffs: number;
    readonly completedLast24h: number;
    readonly byRepository: Record<string, number>;
}
/**
 * Helper function to generate unique claim IDs
 */
export declare function generateClaimId(): ClaimId;
/**
 * Check if a status is an active claim status
 */
export declare function isActiveClaimStatus(status: ExtendedClaimStatus): boolean;
/**
 * Get valid status transitions per ADR-016
 */
export declare function getValidStatusTransitions(currentStatus: ExtendedClaimStatus): readonly ExtendedClaimStatus[];
//# sourceMappingURL=types.d.ts.map