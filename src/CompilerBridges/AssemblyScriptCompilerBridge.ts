import {CompileBridge, CompileResult} from './CompileBridge';
import {exec, ExecException} from 'child_process';
import {SourceMap} from '../State/SourceMap';
import {MappingItem, SourceMapConsumer} from 'source-map';
import * as fs from 'fs';
import {readFileSync} from 'fs';
import {WASMCompilerBridge} from './WASMCompilerBridge';
import {LineInfoPairs} from '../State/LineInfoPairs';
import * as readline from 'readline';
import * as path from 'path';

export class AssemblyScriptCompilerBridge implements CompileBridge {
    sourceFilePath: String;
    private readonly tmpdir: string;
    private readonly wabt: string;
    private readonly workingDir?: string;

    constructor(sourceFilePath: String, tmpdir: string, wabt: string, workingDir?: string) {
        this.sourceFilePath = sourceFilePath;
        this.tmpdir = tmpdir;
        this.wabt = wabt;
        this.workingDir = workingDir;
    }

    async compile(): Promise<CompileResult> {
        return new Promise<void>(async (resolve, reject) => {
            const command = await this.getCompilationCommand();
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
        }).then(async () => {
            const w: Buffer = readFileSync(`${this.tmpdir}/upload.wasm`);
            return Promise.resolve({
                sourceMap: await new AsScriptMapper(this.sourceFilePath.toString(), this.tmpdir, this.wabt).mapping(),
                wasm: w
            });
        }).catch((error) => {
            return Promise.reject(error);
        });
    }

    async clean(path2makefile: string): Promise<void> {
        return;
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

        return new Promise((resolve) => {
            reader.on('close', () => {
                resolve(mapping);
            });
        });
    }

    private getCompilationCommand(): Promise<string> {
        // builds asc command based on the version of asc
        return new Promise<string>(async (resolve) => {
            let version: Version = await this.retrieveVersion();
            resolve(`${this.workingDir ? `cd ${this.workingDir}; ` : ''}npx asc ${this.sourceFilePath} --exportTable --disable bulk-memory --sourceMap --debug ` +
                `${(version.major > 0 || +version.minor >= 20) ? '--outFile' : '--binaryFile'} ${this.tmpdir}/upload.wasm`);
        });
    }

    private retrieveVersion(): Promise<Version> {
        return new Promise<Version>((resolve, reject) => {
            let out: String = '';
            let err: String = '';

            function handle(error: ExecException | null, stdout: String, stderr: any) {
                out = stdout;
                err = error?.message ?? '';
            }

            const command: string = `${this.workingDir ? `cd ${this.workingDir}; ` : ''}npx asc --version`;
            let compilerVersion = exec(command, handle);
            compilerVersion.on('close', (code) => {
                if (code !== 0) {
                    reject(`asc --version failed: ${err}`);
                }

                const matched = out.match(/^Version (?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+)/);
                if (matched && matched.groups?.major && matched.groups?.minor && matched.groups?.patch) {
                    resolve({major: +matched.groups.major, minor: +matched.groups.minor, patch: +matched.groups.patch});
                } else {
                    reject(`asc --version did not print expected output format 'Version x.x.x'. Got ${out} instead.`);
                }
            });
        });
    }
}

interface Version {
    major: number;
    minor: number;
    patch: number;
}

export abstract class SourceMapper {
    abstract mapping(): Promise<SourceMap>;
}

export class AsScriptMapper implements SourceMapper {
    private readonly sourceFile: string;
    private readonly tmpdir: string;
    private readonly wabt: string;

    constructor(sourceFile: string, tmpdir: string, wabt: string) {
        this.sourceFile = sourceFile;
        this.tmpdir = tmpdir;
        this.wabt = wabt;
    }

    public mapping(): Promise<SourceMap> {
        const input = fs.readFileSync(`${this.tmpdir}/upload.wasm.map`);

        return new Promise<LineInfoPairs[]>((resolve) => {
            new SourceMapConsumer(input.toString()).then((consumer: SourceMapConsumer) => {
                const lineInfoPairs: LineInfoPairs[] = [];
                consumer.eachMapping(function (item: MappingItem) {
                    if (!item.source.includes('~lib')) {
                        lineInfoPairs.push({
                            lineInfo: {
                                line: item.originalLine,
                                column: item.originalColumn,
                                message: ''
                            },
                            lineAddress: item.generatedColumn.toString(16)
                        });
                    }
                });
                resolve(lineInfoPairs);
            });
        }).then((lines: LineInfoPairs[]) => {
            return new WASMCompilerBridge(this.sourceFile, this.tmpdir, this.wabt).sourceDump(lines);
        });
    }
}