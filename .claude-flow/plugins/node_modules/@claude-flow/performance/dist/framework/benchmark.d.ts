/**
 * V3 Performance Benchmark Framework
 *
 * Comprehensive benchmarking system with statistical analysis,
 * memory tracking, and regression detection capabilities.
 *
 * Target Performance Metrics:
 * - CLI Startup: <500ms (5x faster)
 * - MCP Init: <400ms (4.5x faster)
 * - Agent Spawn: <200ms (4x faster)
 * - Vector Search: <1ms (150x faster)
 * - Memory Write: <5ms (10x faster)
 * - Swarm Consensus: <100ms (5x faster)
 * - Flash Attention: 2.49x-7.47x speedup
 * - Memory Usage: <256MB (50% reduction)
 */
export interface MemoryUsage {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
}
export interface BenchmarkResult {
    name: string;
    iterations: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    stdDev: number;
    opsPerSecond: number;
    memoryUsage: MemoryUsage;
    memoryDelta: number;
    timestamp: number;
    metadata?: Record<string, unknown>;
}
export interface BenchmarkOptions {
    /** Number of iterations (default: 100) */
    iterations?: number;
    /** Number of warmup iterations (default: 10) */
    warmup?: number;
    /** Timeout per iteration in ms (default: 30000) */
    timeout?: number;
    /** Force garbage collection between iterations */
    forceGC?: boolean;
    /** Custom metadata to attach to results */
    metadata?: Record<string, unknown>;
    /** Minimum number of runs to ensure statistical significance */
    minRuns?: number;
    /** Target time in ms for auto-calibration */
    targetTime?: number;
}
export interface BenchmarkSuite {
    name: string;
    benchmarks: BenchmarkResult[];
    totalTime: number;
    timestamp: number;
    environment: EnvironmentInfo;
}
export interface EnvironmentInfo {
    nodeVersion: string;
    platform: string;
    arch: string;
    cpus: number;
    memory: number;
    v8Version?: string;
}
export interface ComparisonResult {
    benchmark: string;
    baseline: number;
    current: number;
    change: number;
    changePercent: number;
    improved: boolean;
    significant: boolean;
    target?: number;
    targetMet: boolean;
}
/**
 * Format bytes to human-readable string
 */
export declare function formatBytes(bytes: number): string;
/**
 * Format time in milliseconds to human-readable string
 */
export declare function formatTime(ms: number): string;
/**
 * Execute a benchmark with comprehensive statistics
 */
export declare function benchmark(name: string, fn: () => Promise<void> | void, options?: BenchmarkOptions): Promise<BenchmarkResult>;
export declare class BenchmarkRunner {
    private results;
    private suiteName;
    constructor(name: string);
    /**
     * Run a single benchmark and add to results
     */
    run(name: string, fn: () => Promise<void> | void, options?: BenchmarkOptions): Promise<BenchmarkResult>;
    /**
     * Run multiple benchmarks in sequence
     */
    runAll(benchmarks: Array<{
        name: string;
        fn: () => Promise<void> | void;
        options?: BenchmarkOptions;
    }>): Promise<BenchmarkSuite>;
    /**
     * Get environment information
     */
    private getEnvironmentInfo;
    /**
     * Get all results
     */
    getResults(): BenchmarkResult[];
    /**
     * Clear all results
     */
    clear(): void;
    /**
     * Print formatted results to console
     */
    printResults(): void;
    /**
     * Export results as JSON
     */
    toJSON(): string;
}
/**
 * Compare benchmark results against baseline
 */
export declare function compareResults(baseline: BenchmarkResult[], current: BenchmarkResult[], targets?: Record<string, number>): ComparisonResult[];
/**
 * Print comparison report
 */
export declare function printComparisonReport(comparisons: ComparisonResult[]): void;
export declare const V3_PERFORMANCE_TARGETS: {
    readonly 'cli-cold-start': 500;
    readonly 'cli-warm-start': 100;
    readonly 'mcp-server-init': 400;
    readonly 'agent-spawn': 200;
    readonly 'vector-search': 1;
    readonly 'hnsw-indexing': 10;
    readonly 'memory-write': 5;
    readonly 'cache-hit': 0.1;
    readonly 'agent-coordination': 50;
    readonly 'task-decomposition': 20;
    readonly 'consensus-latency': 100;
    readonly 'message-throughput': 0.1;
    readonly 'flash-attention': 100;
    readonly 'multi-head-attention': 200;
    readonly 'sona-adaptation': 0.05;
};
export type PerformanceTarget = keyof typeof V3_PERFORMANCE_TARGETS;
/**
 * Check if a benchmark meets its target
 */
export declare function meetsTarget(benchmarkName: string, value: number): {
    met: boolean;
    target: number | undefined;
    ratio: number | undefined;
};
declare const _default: {
    benchmark: typeof benchmark;
    BenchmarkRunner: typeof BenchmarkRunner;
    compareResults: typeof compareResults;
    printComparisonReport: typeof printComparisonReport;
    formatBytes: typeof formatBytes;
    formatTime: typeof formatTime;
    meetsTarget: typeof meetsTarget;
    V3_PERFORMANCE_TARGETS: {
        readonly 'cli-cold-start': 500;
        readonly 'cli-warm-start': 100;
        readonly 'mcp-server-init': 400;
        readonly 'agent-spawn': 200;
        readonly 'vector-search': 1;
        readonly 'hnsw-indexing': 10;
        readonly 'memory-write': 5;
        readonly 'cache-hit': 0.1;
        readonly 'agent-coordination': 50;
        readonly 'task-decomposition': 20;
        readonly 'consensus-latency': 100;
        readonly 'message-throughput': 0.1;
        readonly 'flash-attention': 100;
        readonly 'multi-head-attention': 200;
        readonly 'sona-adaptation': 0.05;
    };
};
export default _default;
//# sourceMappingURL=benchmark.d.ts.map