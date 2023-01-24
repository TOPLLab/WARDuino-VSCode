import {FunctionInfo} from '../../State/FunctionInfo';

export function parseExport(input: string): FunctionInfo[] {
    const results: FunctionInfo[] = [];
    const section: string[] = consumeUntil(input, 'Export').split('\n');
    section.pop();
    for (const line of section) {
        const index: number = getIndex(line);
        const name: string = getName(line);
        if (0 <= index && 0 < name.length) {
            results.push({index: index, name: name, locals: []});
        }
    }
    return results;
}

function consumeUntil(text: string, until: string): string {
    return text.split(until)[1] ?? '';
}

function getIndex(line: string): number {
    const match = /func\[([0-9]+)\]/.exec(line);
    if (match === null || match[1] === undefined) {
        return -1;
    }
    return parseInt(match[1]);
}

function getName(line: string): string {
    const match = /-> "([^"]+)"/.exec(line);
    if (match === null || match[1] === undefined) {
        return '';
    }
    return match[1];
}