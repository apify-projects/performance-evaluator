import { Actor, log } from 'apify';
import { ActorSourceType } from 'apify-client';
import { type ActorRunRequest, Orchestrator } from 'apify-orchestrator';
import { diff } from 'util';
import { getAverages } from './utils';

interface Input {
    actorOrTaskId: string;
    actorInput: Record<string, unknown>;
    memoryConfigs: string[];
    bundleWithNcc: boolean;
    iterationsPerConfig: number;
}

await Actor.init();

// Create a new Actor using packages and importing them at start to measure startup latency
const { actorOrTaskId, actorInput, memoryConfigs, iterationsPerConfig } = (await Actor.getInput<Input>())!;

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
        },
    }));

    const isActor = !!(await client.actor(actorOrTaskId).get());
    const runsRecord = await client[isActor ? 'actor' : 'task'](actorOrTaskId).callRuns(...runRequests);
    log.info(`Batch of Actors with ${memoryMbs} MB memory finished.`);

    const runs = Object.values(runsRecord);

    const eventTimes: Record<string, number[]> = {};
    for (const run of runs) {
        const runLog = await Actor.apifyClient.run(run.id).log().get()

        // PERF[${name}] ${numberMs} - arbitrary text after or spaces
        const perfLogRegex = /PERF\s*\[([^\]]+)\]\D*(\d+(?:\.\d+)?)/;

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

await Actor.exit();