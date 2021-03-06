import {exec, ExecException} from "child_process";
import * as parseUtils from "../Parsers/ParseUtils";
import {CompileTimeError} from "./CompileTimeError";
import {LineInfo} from "../State/LineInfo";
import {LineInfoPairs} from "../State/LineInfoPairs";
import {CompileBridge} from "./CompileBridge";
import {SourceMap} from "../State/SourceMap";
import {FunctionInfo} from "../State/FunctionInfo";
import {VariableInfo} from "../State/VariableInfo";

function checkCompileTimeError(errorMessage: string) {
    let regexpr = /:(?<line>(\d+)):(?<column>(\d+)): error: (?<message>(.*))/;
    let result = errorMessage.match(regexpr);
    if (result?.groups) {
        throw new CompileTimeError(errorMessage,
            {
                line: parseInt(result.groups.line),
                column: parseInt(result.groups.column),
                message: result.groups.message
            }
        );
    }
}

function checkErrorWat2Wasm(errorMessage: string) {
    if (errorMessage.match('wat2wasm')) {
        throw new Error('Could not find wat2wasm in the path');
    }
}

function checkErrorObjDump(errorMessage: string) {
    if (errorMessage.match('wasm-objdump')) {
        throw new Error('Could not find wasm-objdump in the path');
    }
}

function extractLineInfo(lineString: string): LineInfo {
    lineString = lineString.substring(1);
    return parseUtils.jsonParse(lineString);
}

function createLineInfoPairs(lines: string[]): LineInfoPairs[] { // TODO update
    let result = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/@/)) {
            result.push({
                lineInfo: extractLineInfo(lines[i]),
                lineAddress: parseUtils.extractAddressInformation(lines[i + 1])
            });
        }
    }
    return result;
}

function makeLineInfoPairs(sourceMapInput: String): LineInfoPairs[] {
    let lines = sourceMapInput.split('\n');
    return createLineInfoPairs(lines);
}

export class WASMCompilerBridge implements CompileBridge {
    tmpdir: string;
    wabt: string;
    wasmFilePath: String;

    constructor(wasmFilePath: String, tmpdir: string, wabt: string) {
        this.wasmFilePath = wasmFilePath;
        this.wabt = wabt;
        this.tmpdir = tmpdir;
    }

    async compile() {
        let sourceMap: SourceMap = await this.compileAndDump(this.compileToWasmCommand(), this.getNameDumpCommand());
        await this.compileHeader();
        return sourceMap;
    }

    async compileHeader() {
        let compileCHeader: string = this.compileCHeaderFileCommand();
        return await this.executeCompileCommand(compileCHeader);
    }

    private checkErrorMessage(errorString: string) {
        checkErrorWat2Wasm(errorString);
        checkErrorObjDump(errorString);
        checkCompileTimeError(errorString);
    }

    private handleStdError(stderr: string, reject: (x: any) => void) {
        if (stderr) {
            try {
                this.checkErrorMessage(stderr);
            } catch (e: any) {
                reject(e);
            }
        }
    }

    private handleError(error: ExecException | null, reject: (x: any) => void) {
        if (error) {
            reject(error.message);
        }
    }

    private compileAndDump(compileCommand: string, objDumpCommand: string): Promise<SourceMap> {
        return new Promise<LineInfoPairs[]>((resolve, reject) => {
            let lineInfoPairs: LineInfoPairs[];
            let that = this;

            function handleCompilerStreams(error: ExecException | null, stdout: String, stderr: any) {
                that.handleStdError(stderr, reject);
                that.handleError(error, reject);
                lineInfoPairs = makeLineInfoPairs(stdout);
            }

            let compile = exec(compileCommand, handleCompilerStreams);

            compile.on('close', (code) => {
                if (lineInfoPairs) {
                    resolve(lineInfoPairs);
                }
            });

        }).then((result) => {
            return new Promise<SourceMap>((resolve, reject) => {
                let functionInfos: FunctionInfo[];
                let globalInfos: VariableInfo[];
                let importInfos: FunctionInfo[];
                let sourceMap: SourceMap;
                let that = this;

                function handleObjDumpStreams(error: ExecException | null, stdout: String, stderr: any) {
                    that.handleStdError(stderr, reject);
                    that.handleError(error, reject);
                    functionInfos = parseUtils.getFunctionInfos(stdout);
                    globalInfos = parseUtils.getGlobalInfos(stdout);
                    importInfos = parseUtils.getImportInfos(stdout);
                }

                let objDump = exec(objDumpCommand, handleObjDumpStreams);

                if (result) {
                    sourceMap = {lineInfoPairs: result, functionInfos: [], globalInfos: [], importInfos: []};
                    objDump.on('close', (code) => {
                        if (functionInfos && globalInfos) {
                            sourceMap.functionInfos = functionInfos;
                            sourceMap.globalInfos = globalInfos;
                            sourceMap.importInfos = importInfos;
                            resolve(sourceMap);
                        }
                    });
                }
            });
        });
    }

    private executeCompileCommand(command: string): Promise<LineInfoPairs[]> {
        return new Promise((resolve, reject) => {
            let sourceMap: LineInfoPairs[];
            let that = this;

            function handleCompilerStreams(error: ExecException | null, stdout: String, stderr: any) {
                that.handleStdError(stderr, reject);
                that.handleError(error, reject);
                sourceMap = makeLineInfoPairs(stdout);
            }

            let cp = exec(command, handleCompilerStreams);

            cp.on('close', (code) => {
                if (sourceMap) {
                    resolve(sourceMap);
                }
            });
        });
    }

    private compileToWasmCommand(): string {
        return `${this.wabt}/wat2wasm --debug-names -v -o ${this.tmpdir}/upload.wasm ` + this.wasmFilePath;
    }

    private getNameDumpCommand(): string {
        return `${this.wabt}/wasm-objdump -x -m ${this.tmpdir}/upload.wasm`;
    }

    private compileCHeaderFileCommand(): string {
        return `cd ${this.tmpdir} ; xxd -i upload.wasm > upload.c`;
    }

}