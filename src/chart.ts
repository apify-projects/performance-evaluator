import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ChartPayload {
    // Aggregated per-stage performance-log data (the default dataset)
    eventData: unknown[];
    // Aggregated resource-usage stats per memory config (the runStats dataset)
    runStats: unknown[];
    // Raw metadata of every triggered run (the allRuns dataset), used for the outliers table
    runs: unknown[];
    // Console links to the source datasets
    links: {
        results: string;
        allRuns: string;
        runStats: string;
    };
}

export function getChartHtml(payload: ChartPayload): string {
    const templatePath = resolve(__dirname, '..', 'perf-chart.html');
    const html = readFileSync(templatePath, 'utf-8');

    const injection = `
const embeddedData = ${JSON.stringify(payload.eventData)};
const embeddedRunStats = ${JSON.stringify(payload.runStats)};
const embeddedRuns = ${JSON.stringify(payload.runs)};
const embeddedLinks = ${JSON.stringify(payload.links)};
document.getElementById('json-input').value = JSON.stringify(embeddedData, null, 2);
currentData = embeddedData;
runStatsData = embeddedRunStats;
runsData = embeddedRuns;
datasetLinks = embeddedLinks;
renderDatasetLinks();
renderAllCharts();
renderRunStatsCharts();
renderOutliersTable();
`;

    return html.replace('// __INJECT_DATA__ placeholder - replaced at runtime with embedded data', injection);
}
