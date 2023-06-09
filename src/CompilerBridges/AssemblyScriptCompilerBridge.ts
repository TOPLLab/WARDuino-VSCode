import {CompileBridge, CompileResult} from './CompileBridge';
import {exec, ExecException} from 'child_process';
import {SourceMap} from '../State/SourceMap';
import * as fs from 'fs';
import {readFileSync} from 'fs';
import {WASMCompilerBridge} from './WASMCompilerBridge';
import {LineInfoPairs} from '../State/LineInfoPairs';
import * as readline from 'readline';
import * as path from 'path';

export class AssemblyScriptCompilerBridge implements CompileBridge {
    sourceFilePath: String;
    private wat: WASMCompilerBridge;
    private readonly tmpdir: string;

    constructor(sourceFilePath: String, tmpdir: string, wabt: string) {
        this.sourceFilePath = sourceFilePath;
        this.tmpdir = tmpdir;
        this.wat = new WASMCompilerBridge(`${this.tmpdir}/upload.wast`, tmpdir, wabt);
    }

    async compile(): Promise<CompileResult> {
        return this.wasm().then((result) => {
            return this.lineInformation(result.sourceMap).then((lines) => {
                const wasm: Buffer = readFileSync(`${this.tmpdir}/upload.wasm`);
                result.sourceMap.lineInfoPairs = lines;
                return Promise.resolve({sourceMap: result.sourceMap, wasm: wasm});
            });
        });
    }

    async clean(path2makefile: string): Promise<void> {
        return;
    }

    private async wasm() {
        return new Promise<void>((resolve, reject) => {
            const command = `cd ${path.dirname(this.sourceFilePath.toString())} ; asc ${this.sourceFilePath} --sourceMap -O3s --debug --binaryFile ${this.tmpdir}/upload.wasm --textFile ${this.tmpdir}/upload.wast`;  // use .wast to get inline sourcemapping
            let out: String = '';
            let err: String = '';

            function handle(error: ExecException | null, stdout: String, stderr: any) {
                out = stdout;
                err = error?.message ?? '';
            }

            let compile = exec(command, handle);

            compile.on('close', (code) => {
                if (code !== 0) {
                    reject(`Compilation to wasm failed: asc exited with code ${code}`);
                    return;
                }
                resolve();
            });
        }).then(() => {
            return this.wat.compile();
        }).catch((error) => {
            return Promise.reject(error);
        });
    }

    // private executeCompileCommand(command: string): Promise<SourceMap> {
    //     const compiler = this;
    //     return new Promise(async function (resolve, reject) {
    //         let sourceMap: SourceMap;
    //
    //         function handleCompilerStreams(error: ExecException | null, stdout: String, stderr: any) {
    //             // TODO handle errors
    //         }
    //
    //         let cp = exec(command, handleCompilerStreams);
    //         sourceMap = await compiler.makeSourceMap("/tmp/warduino/upload.wasm.map"); // TODO
    //
    //         cp.on('close', (code) => {
    //             if (sourceMap) {
    //                 resolve(sourceMap);
    //             }
    //         });
    //     });
    // }

    // private makeSourceMap(sourceMapFile: String): Promise<SourceMap> {
    //     const compiler = this;
    //     return this.wat.compile().then(async function (output) {
    //         return Promise.resolve({
    //             lineInfoPairs: await compiler.lineInformation(compiler.sourceFilePath.toString(), output.sourceMap),
    //             functionInfos: [],
    //             globalInfos: [],
    //             importInfos: [],
    //             typeInfos: new Map<number, TypeInfo>()
    //         });
    //     });
    // }

    private lineInformation(dump: SourceMap): Promise<LineInfoPairs[]> {
        const reader = readline.createInterface({input: fs.createReadStream(`${this.tmpdir}/upload.wast`)});
        const mapping: LineInfoPairs[] = [];

        const counter = ((i = 0) => () => ++i)();

        reader.on('line', (line: string, cursor = counter() + 1) => {
            if (line.includes(';;@') && line.includes(path.basename(this.sourceFilePath.toString()))) {
                const entry: LineInfoPairs | undefined = dump.lineInfoPairs.find((info) => info.lineInfo.line === cursor);
                if (entry) {
                    mapping.push({
                        lineInfo: {
                            line: +line.split(':')[1],
                            column: +line.split(':')[2],
                            message: entry.lineInfo.message
                        },
                        lineAddress: entry.lineAddress
                    });
                }
            }
        });

        return new Promise((resolve, reject) => {
            reader.on('close', () => {
                resolve(mapping);
            });
        });
    }

}