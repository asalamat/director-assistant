/**
 * Load Balancer Service for Claims Module (ADR-016)
 *
 * Balances work across the swarm by:
 * - Tracking agent load and utilization
 * - Detecting overloaded/underloaded agents
 * - Rebalancing work through handoff mechanisms
 *
 * Rebalancing Algorithm:
 * 1. Calculate average load across swarm
 * 2. Identify overloaded agents (>1.5x average utilization)
 * 3. Identify underloaded agents (<0.5x average utilization)
 * 4. Move low-progress (<25%) work from overloaded to underloaded
 * 5. Prefer same agent type for transfers
 * 6. Use handoff mechanism (not direct reassignment)
 *
 * Events Emitted:
 * - SwarmRebalanced: When rebalancing operation completes
 * - AgentOverloaded: When an agent exceeds load threshold
 * - AgentUnderloaded: When an agent is below load threshold
 *
 * @module v3/@claude-flow/claims/application/load-balancer
 */
import { EventEmitter } from 'node:events';
import { IssuePriority } from '../domain/types.js';
/**
 * Claimant type for load balancer operations (ADR-016 format)
 *
 * This is a simplified claimant representation used specifically for
 * load balancing operations. It can represent either a human or an agent.
 */
export type LoadBalancerClaimant = {
    type: 'human';
    userId: string;
    name: string;
} | {
    type: 'agent';
    agentId: string;
    agentType: string;
};
/**
 * Claim status values relevant to load balancing
 */
export type LoadBalancerClaimStatus = 'active' | 'paused' | 'handoff-pending' | 'review-requested' | 'blocked' | 'stealable' | 'completed';
/**
 * Summary of a claim for load calculations
 */
export interface ClaimSummary {
    issueId: string;
    status: LoadBalancerClaimStatus;
    priority: IssuePriority;
    progress: number;
    claimedAt: Date;
    lastActivityAt: Date;
    estimatedRemainingMinutes?: number;
}
/**
 * Load information for a single agent
 */
export interface AgentLoadInfo {
    agentId: string;
    agentType: string;
    claimCount: number;
    maxClaims: number;
    utilization: number;
    claims: ClaimSummary[];
    avgCompletionTime: number;
    currentBlockedCount: number;
}
/**
 * Load overview for an entire swarm
 */
export interface SwarmLoadInfo {
    swarmId: string;
    totalAgents: number;
    activeAgents: number;
    totalClaims: number;
    avgUtilization: number;
    agents: AgentLoadInfo[];
    overloadedAgents: string[];
    underloadedAgents: string[];
    balanceScore: number;
}
/**
 * Options for rebalancing operation
 */
export interface RebalanceOptions {
    /** Only move claims with progress below this threshold (default: 25%) */
    maxProgressToMove: number;
    /** Prefer same agent type for transfers (default: true) */
    preferSameType: boolean;
    /** Threshold multiplier for overloaded detection (default: 1.5x average) */
    overloadThreshold: number;
    /** Threshold multiplier for underloaded detection (default: 0.5x average) */
    underloadThreshold: number;
    /** Maximum claims to move in single rebalance (default: 10) */
    maxMovesPerRebalance: number;
    /** Use handoff mechanism instead of direct reassignment (default: true) */
    useHandoff: boolean;
}
/**
 * Result of a rebalance operation
 */
export interface RebalanceResult {
    /** Claims that were moved (if useHandoff=false) or handoffs initiated */
    moved: Array<{
        issueId: string;
        from: LoadBalancerClaimant;
        to: LoadBalancerClaimant;
    }>;
    /** Suggested moves that weren't executed (for preview or when useHandoff=true) */
    suggested: Array<{
        issueId: string;
        currentOwner: LoadBalancerClaimant;
        suggestedOwner: LoadBalancerClaimant;
        reason: string;
    }>;
    /** Summary statistics */
    stats: {
        totalMoved: number;
        totalSuggested: number;
        previousBalanceScore: number;
        newBalanceScore: number;
        executionTimeMs: number;
    };
}
/**
 * Report on load imbalance in the swarm
 */
export interface ImbalanceReport {
    swarmId: string;
    timestamp: Date;
    isBalanced: boolean;
    balanceScore: number;
    avgLoad: number;
    overloaded: Array<{
        agentId: string;
        agentType: string;
        utilization: number;
        excessClaims: number;
        movableClaims: ClaimSummary[];
    }>;
    underloaded: Array<{
        agentId: string;
        agentType: string;
        utilization: number;
        availableCapacity: number;
    }>;
    recommendations: string[];
}
/**
 * Interface for the Load Balancer service
 */
export interface ILoadBalancer {
    /**
     * Get load information for a specific agent
     */
    getAgentLoad(agentId: string): Promise<AgentLoadInfo>;
    /**
     * Get load overview for entire swarm
     */
    getSwarmLoad(swarmId: string): Promise<SwarmLoadInfo>;
    /**
     * Rebalance work across swarm
     * @param swarmId - The swarm to rebalance
     * @param options - Rebalancing options
     */
    rebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;
    /**
     * Preview rebalance without applying changes
     */
    previewRebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;
    /**
     * Detect overloaded/underloaded agents
     */
    detectImbalance(swarmId: string): Promise<ImbalanceReport>;
}
/**
 * Agent metadata for load balancing operations
 */
export interface AgentMetadata {
    agentId: string;
    agentType: string;
    maxClaims: number;
    swarmId?: string;
}
/**
 * Claim repository interface for load balancing data access
 *
 * This is a specialized interface for load balancing operations.
 * Implementations should adapt from the main IClaimRepository or IIssueClaimRepository.
 */
export interface ILoadBalancerClaimRepository {
    /**
     * Get all claims held by a specific agent
     */
    getClaimsByAgent(agentId: string): Promise<ClaimSummary[]>;
    /**
     * Get all claims in a swarm, grouped by agent ID
     */
    getClaimsBySwarm(swarmId: string): Promise<Map<string, ClaimSummary[]>>;
    /**
     * Get historical completion times for an agent (in milliseconds)
     * Used to calculate average completion time metrics
     */
    getAgentCompletionHistory(agentId: string, limit?: number): Promise<number[]>;
}
/**
 * Agent registry interface for agent metadata
 *
 * Provides access to agent configuration needed for load calculations.
 */
export interface IAgentRegistry {
    /**
     * Get metadata for a specific agent
     */
    getAgent(agentId: string): Promise<AgentMetadata | null>;
    /**
     * Get all agents in a swarm
     */
    getAgentsBySwarm(swarmId: string): Promise<AgentMetadata[]>;
}
/**
 * Handoff service interface for initiating claim transfers
 *
 * Load balancer uses handoffs (not direct reassignment) to maintain
 * proper claim lifecycle and audit trail.
 */
export interface IHandoffService {
    /**
     * Request a handoff from one claimant to another
     * @param issueId - The issue to transfer
     * @param from - Current owner
     * @param to - Proposed new owner
     * @param reason - Reason for the handoff request
     */
    requestHandoff(issueId: string, from: LoadBalancerClaimant, to: LoadBalancerClaimant, reason: string): Promise<void>;
}
/**
 * Event types emitted by the Load Balancer
 */
export type LoadBalancerEventType = 'swarm:rebalanced' | 'agent:overloaded' | 'agent:underloaded';
export interface SwarmRebalancedEvent {
    type: 'swarm:rebalanced';
    swarmId: string;
    timestamp: Date;
    result: RebalanceResult;
}
export interface AgentOverloadedEvent {
    type: 'agent:overloaded';
    agentId: string;
    agentType: string;
    utilization: number;
    claimCount: number;
    maxClaims: number;
    timestamp: Date;
}
export interface AgentUnderloadedEvent {
    type: 'agent:underloaded';
    agentId: string;
    agentType: string;
    utilization: number;
    claimCount: number;
    maxClaims: number;
    timestamp: Date;
}
/**
 * Load Balancer Service
 *
 * Balances work across the swarm using the following algorithm:
 * 1. Calculate average load across swarm
 * 2. Identify overloaded agents (>1.5x average utilization)
 * 3. Identify underloaded agents (<0.5x average utilization)
 * 4. Move low-progress (<25%) work from overloaded to underloaded
 * 5. Prefer same agent type for transfers
 * 6. Use handoff mechanism (not direct reassignment)
 */
export declare class LoadBalancer extends EventEmitter implements ILoadBalancer {
    private readonly claimRepository;
    private readonly agentRegistry;
    private readonly handoffService;
    constructor(claimRepository: ILoadBalancerClaimRepository, agentRegistry: IAgentRegistry, handoffService: IHandoffService);
    /**
     * Get load information for a specific agent
     */
    getAgentLoad(agentId: string): Promise<AgentLoadInfo>;
    /**
     * Get load overview for entire swarm
     */
    getSwarmLoad(swarmId: string): Promise<SwarmLoadInfo>;
    /**
     * Rebalance work across swarm
     */
    rebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;
    /**
     * Preview rebalance without applying changes
     */
    previewRebalance(swarmId: string, options?: Partial<RebalanceOptions>): Promise<RebalanceResult>;
    /**
     * Detect overloaded/underloaded agents
     */
    detectImbalance(swarmId: string): Promise<ImbalanceReport>;
    /**
     * Calculate utilization based on claims and their priorities
     */
    private calculateUtilization;
    /**
     * Calculate balance score for the swarm (0-1, higher is better)
     *
     * Uses coefficient of variation: 1 - (stdDev / mean)
     * A perfectly balanced swarm has score = 1
     */
    private calculateBalanceScore;
    /**
     * Find the best target agent for receiving a transferred claim
     */
    private findBestTarget;
}
/**
 * Create a LoadBalancer instance with dependencies
 *
 * @param claimRepository - Repository for accessing claim data
 * @param agentRegistry - Registry for agent metadata
 * @param handoffService - Service for initiating claim handoffs
 * @returns A configured LoadBalancer instance
 *
 * @example
 * ```typescript
 * const loadBalancer = createLoadBalancer(
 *   claimRepository,
 *   agentRegistry,
 *   handoffService
 * );
 *
 * // Get swarm load overview
 * const swarmLoad = await loadBalancer.getSwarmLoad('swarm-1');
 *
 * // Detect and report imbalances
 * const imbalance = await loadBalancer.detectImbalance('swarm-1');
 *
 * // Preview rebalancing without applying
 * const preview = await loadBalancer.previewRebalance('swarm-1');
 *
 * // Execute rebalancing with handoffs
 * const result = await loadBalancer.rebalance('swarm-1', {
 *   maxProgressToMove: 25,
 *   preferSameType: true
 * });
 * ```
 */
export declare function createLoadBalancer(claimRepository: ILoadBalancerClaimRepository, agentRegistry: IAgentRegistry, handoffService: IHandoffService): ILoadBalancer;
export type Claimant = LoadBalancerClaimant;
//# sourceMappingURL=load-balancer.d.ts.map