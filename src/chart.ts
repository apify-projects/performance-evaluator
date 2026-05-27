import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getChartHtml(dataJson: string): string {
    const templatePath = resolve(__dirname, '..', 'perf-chart.html');
    const html = readFileSync(templatePath, 'utf-8');

    const injection = `
const embeddedData = ${dataJson};
document.getElementById('json-input').value = JSON.stringify(embeddedData, null, 2);
currentData = embeddedData;
renderAllCharts();
`;

    return html.replace('// __INJECT_DATA__ placeholder - replaced at runtime with embedded data', injection);
}
