import {FunctionInfo} from '../State/FunctionInfo';
import { string2WASMType, TypeInfo } from '../State/TypeInfo';
import {VariableInfo} from '../State/VariableInfo';

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

function extractTypeInfo(line: String): TypeInfo {
    let typeInfo = {} as TypeInfo;
    // string of the form "type[3] (i32, i64) -> i32"
    const [leftSidearrow, rightSideArrow] = line.split('->'); // 

    const matchTypeIdx = leftSidearrow.match(/type\[([0-9]+)\]/);
    if(matchTypeIdx === null){
        throw (new Error(`TypeInfo parsing error. Index of typesignature missing in line: ${line}`));
    }
    typeInfo.index = +matchTypeIdx[1];
    
    const matchReturnType = rightSideArrow.match(/ (i32|i64|f32|f64|nil)$/);
    if(!!!matchReturnType){
        throw (new Error(`TypeInfo parsing error. Return type of typesginature is missing in line: ${line}`));
    }

    if(matchReturnType[1] !== 'nil'){
        typeInfo.result = string2WASMType(matchReturnType[1]);
    }

    // string of the form "type (i32, i64) "
    const paramstypes = leftSidearrow.split('(')[1].split(')')[0].split(',').map(s=>s.trim()).filter(s=>s!=='');

    typeInfo.parameters = paramstypes.map(t=>string2WASMType(t));
    return typeInfo;
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
    let match = line.match(/func\[([0-9]+)\] sig=([0-9]+)/);
    if(!!!match){
        throw (new Error(`Importsection does not contain function index and/or type index. Given: ${line}`));
    }
    primitive.index = +match[1];
    primitive.type = +match[2];
    match = line.match(/<([a-zA-Z0-9 ._]+)>/);
    primitive.name = ((match === null) ? `${primitive.index}` : `$${match[1]}`);
    return primitive;
}

export function getTypeInfos(input: String): Map<number, TypeInfo> {
    let lines: String[] = extractDetailedSection('Type[', input);
    const typesInfos: Map<number,TypeInfo> = new Map<number, TypeInfo>();
    lines.forEach((line) => {
        const typeInfo = extractTypeInfo(line);
        typesInfos.set(typeInfo.index, typeInfo);
    });
    return typesInfos;
}

export function getFunctionInfos(input: String): FunctionInfo[] {
    const functionSection: String[] = extractDetailedSection('Function[', input);
    const metadata: Map<number,number> = new Map<number,number>();
    let firstNonPrimiveFunc = -1;
    functionSection.forEach(s=>{
        let match = s.match(/func\[([0-9]+)\] sig=([0-9]+)/);
        if(!!!match){
            throw (new Error(`function section does not contain idx and/or signature idx. Give: ${s}`));
        }
        metadata.set(+match[1], +match[2]);
        if(firstNonPrimiveFunc === -1){
            firstNonPrimiveFunc = +match[1];
        }
    });

    let functionLines: String[] = extractMajorSection('Sourcemap JSON:', input);

    if (functionLines.length === 0) {
        throw Error("Could not parse 'sourcemap' section of objdump");
    }

    let sourcemap = JSON.parse(functionLines.join('').replace(/\t/g,''));
    let functions: FunctionInfo[] = [];
    sourcemap.Functions.forEach((func: any, index: number) => {
        // primitive functions are handled seperately
        if(index >= firstNonPrimiveFunc){
            let locals: VariableInfo[] = [];
            func.locals.forEach((local: any) => {
                locals.push({ index: local.idx, name: local.name, type: 'undefined', mutable: true, value: '' });
            });
            const typeIdx = metadata.get(index);
            if(typeIdx === undefined){
                throw Error(`Parsing Error function ${index} has no typesignature`);
            }
            functions.push({index: index, name: func.name, locals: locals, type: typeIdx});
        } 
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