import { Actor, log } from 'apify';
import { type ActorRunRequest, Orchestrator } from 'apify-orchestrator';

import { getChartHtml } from './chart.js';
import { getAverages } from './utils.js';

interface Input {
    actorOrTaskId: string;
    actorInput: Record<string, unknown>;
    buildNumber?: string;
    memoryConfigs: string[];
    iterationsPerConfig: number;
}

// Normalized, human-readable per-run performance stats. The raw Apify API reports
// memory and network traffic in bytes, which is hard to read, so we convert memory
// to MB and network traffic to kB. `usageTotalUsd` is a top-level field on the run.
interface RunPerfStats {
    runTimeSecs?: number;
    computeUnits?: number;
    memAvgMbytes?: number;
    memMaxMbytes?: number;
    cpuAvgUsage?: number;
    cpuMaxUsage?: number;
    netRxKbytes?: number;
    netTxKbytes?: number;
    usageTotalUsd?: number;
}

// Fields we aggregate (min/max/mean/median) into the runStats dataset, in display order.
const RUN_STATS_FIELDS: (keyof RunPerfStats)[] = [
    'runTimeSecs',
    'computeUnits',
    'memAvgMbytes',
    'memMaxMbytes',
    'cpuAvgUsage',
    'cpuMaxUsage',
    'netRxKbytes',
    'netTxKbytes',
    'usageTotalUsd',
];

const BYTES_IN_KB = 1024;
const BYTES_IN_MB = 1024 * 1024;

// Convert a raw Apify run into normalized, human-readable performance stats.
function toRunPerfStats(run: { stats?: unknown; usageTotalUsd?: number }): RunPerfStats {
    const stats = (run.stats ?? {}) as Record<string, number | undefined>;
    const toMb = (b?: number) => (typeof b === 'number' ? b / BYTES_IN_MB : undefined);
    const toKb = (b?: number) => (typeof b === 'number' ? b / BYTES_IN_KB : undefined);
    return {
        runTimeSecs: stats.runTimeSecs,
        computeUnits: stats.computeUnits,
        memAvgMbytes: toMb(stats.memAvgBytes),
        memMaxMbytes: toMb(stats.memMaxBytes),
        cpuAvgUsage: stats.cpuAvgUsage,
        cpuMaxUsage: stats.cpuMaxUsage,
        netRxKbytes: toKb(stats.netRxBytes),
        netTxKbytes: toKb(stats.netTxBytes),
        usageTotalUsd: run.usageTotalUsd,
    };
}

await Actor.init();

// Create a new Actor using packages and importing them at start to measure startup latency
const { actorOrTaskId, actorInput, memoryConfigs, iterationsPerConfig, buildNumber } = (await Actor.getInput<Input>())!;

// const state = await Actor.useState<{ actorId?: string, versionNumber?: string, buildNumber?: string }>()

// console.dir(state)

const orchestrator = new Orchestrator({
    enableLogs: true,
    persistenceSupport: 'kvs',
    persistencePrefix: 'ORCHESTRATOR-',
    abortAllRunsOnGracefulAbort: true,
    retryOnInsufficientResources: true,
});

const client = await orchestrator.apifyClient({ name: 'MY-CLIENT' });

// Dataset with the raw metadata of every triggered run
const allRunsDataset = await Actor.openDataset({ alias: 'allRuns' });
// Dataset with aggregated (min/max/mean/median) resource-usage stats per memory config
const runStatsDataset = await Actor.openDataset({ alias: 'runStats' });

// Run each memory configuration 50 times to get mean, median, min, max startup latencies
for (const memoryMbs of memoryConfigs) {
    log.info(`Running batch of Actors with ${memoryMbs} MB memory...`);
    // These are special objects for orchestrator, assigns a name to each run
    const runRequests: ActorRunRequest[] = [...Array(iterationsPerConfig).keys()].map((i) => ({
        runName: `mem-${memoryMbs}-run-${i + 1}`,
        input: actorInput,
        options: {
            memory: Number(memoryMbs),
            build: buildNumber,
        },
    }));

    const isActor = !!(await client.actor(actorOrTaskId).get());
    const runsRecord = await client[isActor ? 'actor' : 'task'](actorOrTaskId).callRuns(...runRequests);

    // Wait 5 seconds to ensure all run endpoint data are up to date, then refetch runs to be safe
    await new Promise((res) => { setTimeout(res, 5000); });
    const refetchedRuns = await Promise.all(
        Object.values(runsRecord).map(async (run) => client.run(run.id).get()),
    );
    const runs = refetchedRuns.filter((run): run is NonNullable<typeof run> => !!run);
    log.info(`Batch of Actors with ${memoryMbs} MB memory finished.`);

    // Push important run data to a separate dataset (with normalized, readable stats)
    const runsWithOnlyImportantData = runs.map((run) => ({
        id: run.id,
        status: run.status,
        memoryMbs: run.options.memoryMbytes,
        buildNumber: run.options.build,
        stats: toRunPerfStats(run),
        chargedEventCounts: run.chargedEventCounts,
        usageTotalUsd: run.usageTotalUsd,
    }));

    await allRunsDataset.pushData(runsWithOnlyImportantData);

    // Aggregate normalized resource-usage stats (min/max/mean/median) across the batch
    const perfStats = runs.map(toRunPerfStats);
    const runStatsData = RUN_STATS_FIELDS.flatMap((statName) => {
        const values = perfStats
            .map((s) => s[statName])
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

        if (values.length === 0) return [];

        const { mean, median, min, max } = getAverages(values);
        log.info(`Stat ${statName} memory ${memoryMbs} MB: Mean=${mean.toFixed(4)}, Median=${median.toFixed(4)}, Min=${min.toFixed(4)}, Max=${max.toFixed(4)}`);

        return [{
            statName,
            memoryMbs,
            min,
            max,
            mean,
            median,
            count: values.length,
        }];
    });

    await runStatsDataset.pushData(runStatsData);

    const eventTimes: Record<string, number[]> = {};
    for (const run of runs) {
        const runLog = await Actor.apifyClient.run(run.id).log().get()

        // PERF[${name}] ${numberMs} - arbitrary text after or spaces, allow negative numbers and decimals
        const perfLogRegex = /PERF\s*\[([^\]]+)\][^\d-]*(-?\d+(?:\.\d+)?)/;

        const runEvents: Record<string, number> = {};
        
        for (const line of runLog!.split('\n')) {
            const match = perfLogRegex.exec(line);
            if (match) {
                const name = match[1];
                const value = Number(match[2]);
                runEvents[name] = value;
            }
            // We could also track run.finishedAt but there is like 300ms delay from reality. So it is better to just add perf log at the end of the Actor run
        }

        log.info(`Run ${run.id} events: ${JSON.stringify(runEvents)}`);

        for (const [eventName, value] of Object.entries(runEvents)) {
            if (!eventTimes[eventName]) {
                eventTimes[eventName] = [];
            }
            eventTimes[eventName].push(value);
        }
    }

    const eventData = [];

    for (const [eventName, times] of Object.entries(eventTimes)) {
        const { mean, median, min, max } = getAverages(times);

        log.info(`Event: ${eventName} memory ${memoryMbs} MB: Mean=${mean.toFixed(2)} ms, Median=${median.toFixed(2)} ms, Min=${min.toFixed(2)} ms, Max=${max.toFixed(2)} ms`);

        let result = ({
            eventName,
            memoryMbs,
            median,
            mean,
            min,
            max,
        })

        // Also do diff vs previous event, it can be more readable
        // This is ugly solution but will do for now
        const previousEventName = eventData.length > 0 ? eventData[eventData.length - 1].eventName : null;
        if (previousEventName) {
            const diffTimes = [];

            for (let i = 0; i < times.length; i++) {
                const previousTimes = eventTimes[previousEventName];
                if (previousTimes && previousTimes[i] !== undefined) {
                    diffTimes.push(times[i] - previousTimes[i]);
                }
            }

            const { mean: fromPreviousMean, median: fromPreviousMedian, min: fromPreviousMin, max: fromPreviousMax } = getAverages(diffTimes);

            const diffToPreviousObj = {
                fromPreviousMean,
                fromPreviousMedian,
                fromPreviousMin,
                fromPreviousMax,
            }
            result = { ...result, ...diffToPreviousObj }
        }

        eventData.push(result);
    }

    await Actor.pushData(eventData);
}

// Load all dataset items and generate an HTML chart page
const dataset = await Actor.openDataset();
const { items } = await dataset.getData();
const { items: runStatsItems } = await runStatsDataset.getData();
const { items: allRunsItems } = await allRunsDataset.getData();

// Build console links to each dataset so the source data is clear in the HTML output
const datasetLinks = {
    results: `https://console.apify.com/storage/datasets/${dataset.id}`,
    allRuns: `https://console.apify.com/storage/datasets/${allRunsDataset.id}`,
    runStats: `https://console.apify.com/storage/datasets/${runStatsDataset.id}`,
};

const chartHtml = getChartHtml({
    eventData: items,
    runStats: runStatsItems,
    runs: allRunsItems,
    links: datasetLinks,
});
await Actor.setValue('chart', chartHtml, { contentType: 'text/html' });
log.info('Chart saved to key-value store as "chart"');

await Actor.exit();