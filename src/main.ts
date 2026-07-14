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
    const runs = [];
    for (const run of Object.values(runsRecord)) {
        const refetchedRun = await client.run(run.id).get();
        runs.push(refetchedRun!);
    }
    log.info(`Batch of Actors with ${memoryMbs} MB memory finished.`);

    // Push important run data to a separate dataset
    const runsWithOnlyImportantData = runs.map((run) => ({
        id: run.id,
        status: run.status,
        memoryMbs: run.options.memoryMbytes,
        buildNumber: run.options.build,
        stats: run.stats,
        chargedEventCounts: run.chargedEventCounts,
        usageTotalUsd: run.usageTotalUsd,
    }));

    const allRunsDataset = await Actor.openDataset({ alias: 'allRuns' });
    await allRunsDataset.pushData(runsWithOnlyImportantData);

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

const chartHtml = getChartHtml(JSON.stringify(items));
await Actor.setValue('chart', chartHtml, { contentType: 'text/html' });
log.info('Chart saved to key-value store as "chart"');

await Actor.exit();