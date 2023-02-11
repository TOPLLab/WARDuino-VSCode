import {FunctionInfo} from '../State/FunctionInfo';
import {VariableInfo} from '../State/VariableInfo';
import {LineInfoPairs} from '../State/LineInfoPairs';
import {LineInfo} from '../State/LineInfo';

export function jsonParse(obj: string) {
    return new Function(`return ${obj}`)();
}

export function extractAddressInformation(addressLine: string): string {
    let regexpr = /^(?<address>([\da-f])+):/;
    let match = addressLine.match(regexpr);
    if (match?.groups) {
        return match.groups.address;
    }
    throw Error(`Could not parse address from line: ${addressLine}`);
}

export function getFileExtension(file: string): string {
    let splitted = file.split('.');
    if (splitted.length > 1) {
        return splitted.pop()!;
    }
    throw Error('Could not determine file type');
}

function extractDetailedSection(section: string, input: String): String[] {
    let lines = input.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].startsWith(section)) {
        i++;
    }

    if (i >= lines.length) {
        return [];
    }

    let count: number = +(lines[i++].split(/[\[\]]+/)[1]);
    return lines.slice(i, ((isNaN(count)) ? lines.length : i + count));
}

function extractMajorSection(section: string, input: String): String[] {
    let lines = input.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i].startsWith(section)) {
        i++;
    }

    i += 2;
    let start = i;
    while (i < lines.length && lines[i] !== '') {
        i++;
    }

    let count: number = +(lines[i++].split(/[\[\]]+/)[1]);
    return lines.slice(start, i);
}

function fillInLocalInfos(functionInfos: FunctionInfo[], lines: String[]): FunctionInfo[] {
    lines = lines.filter((line) => line.includes('local'));
    for (let i = 0; i < lines.length; i++) {
        let fidx = lines[i].match(/\[([0-9]+)]/);
        if (fidx !== null) {
            let name = lines[i].match(/<([a-zA-Z0-9 ._]+)>/);
            let f = fidx[1];
            if (f !== null) {
                let functionInfo = functionInfos.find(o => o.index === parseInt(f));
                functionInfo?.locals.push({
                    index: i,
                    name: ((name === null) ? `${i}` : `$${name[1]}`),
                    type: 'undefined',
                    mutable: true,
                    value: ''
                });  // TODO get type from disassembly
            }
        }
    }
    return functionInfos;
}

function fillInExportInfos() {
    // TODO
}

function extractGlobalInfo(line: String): VariableInfo {
    let global = {} as VariableInfo;
    let match = line.match(/\[([0-9]+)]/);
    global.index = (match === null) ? NaN : +match[1];
    match = line.match(/ ([if][0-9][0-9]) /);
    global.type = (match === null) ? 'undefined' : match[1];
    match = line.match(/<([a-zA-Z0-9 ._]+)>/);
    global.name = ((match === null) ? `${global.index}` : `$${match[1]}`) + ` (${global.type})`;
    match = line.match(/mutable=([0-9])/);
    global.mutable = match !== null && +match[1] === 1;
    match = line.match(/init.*=(.*)/);
    global.value = (match === null) ? '' : match[1];
    return global;
}

function extractImportInfo(line: String): FunctionInfo {
    let primitive = {} as FunctionInfo;
    let match = line.match(/\[([0-9]+)]/);
    primitive.index = (match === null) ? NaN : +match[1];
    match = line.match(/<([a-zA-Z0-9 ._]+)>/);
    primitive.name = ((match === null) ? `${primitive.index}` : `$${match[1]}`);
    return primitive;
}

function extractLineInfo(lineString: string): LineInfo {
    lineString = lineString.substring(1);
    return jsonParse(lineString);
}

function createLineInfoPairs(lines: string[]): LineInfoPairs[] { // TODO update
    let result = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/@/)) {
            result.push({
                lineInfo: extractLineInfo(lines[i]),
                lineAddress: extractAddressInformation(lines[i + 1])
            });
        }
    }
    return result;
}

export function getLineInfos(sourceMapInput: String): LineInfoPairs[] {
    let lines = sourceMapInput.split('\n');
    return createLineInfoPairs(lines);
}

export function getFunctionInfos(input: String): FunctionInfo[] {
    let functionLines: String[] = extractMajorSection('Sourcemap JSON:', input);

    if (functionLines.length === 0) {
        throw Error("Could not parse 'sourcemap' section of objdump");
    }

    let sourcemap = JSON.parse(functionLines.join('').replace(/\t/g,''));
    let functions: FunctionInfo[] = [];
    sourcemap.Functions.forEach((func: any, index: number) => {
        let locals: VariableInfo[] = [];
        func.locals.forEach((local: string, index: number) => {
            locals.push({index: index, name: local, type: 'undefined', mutable: true, value: ''});
        });
        functions.push({index: index, name: func.name, locals: locals});
    });
    return functions;
}

export function getGlobalInfos(input: String): VariableInfo[] {
    let lines: String[] = extractDetailedSection('Global[', input);
    let globals: VariableInfo[] = [];
    lines.forEach((line) => {
        globals.push(extractGlobalInfo(line));
    });
    return globals;
}

export function getImportInfos(input: String): FunctionInfo[] {
    let lines: String[] = extractDetailedSection('Import[', input);
    let globals: FunctionInfo[] = [];
    lines.forEach((line) => {
        globals.push(extractImportInfo(line));
    });
    return globals;
}