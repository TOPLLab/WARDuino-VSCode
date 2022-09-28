import {CompileBridge} from './CompileBridge';
import {exec, ExecException} from 'child_process';
import {SourceMap} from '../State/SourceMap';
import { readFileSync } from 'fs';

export class AssemblyScriptCompilerBridge implements CompileBridge {
    sourceFilePath: String;

    constructor(sourceFilePath: String) {
        this.sourceFilePath = sourceFilePath;
    }

    async compile() {
        // TODO test reading wasm file
        const wasm = readFileSync('/tmp/warduino/upload.wasm');
        return {sourceMap: await this.executeCompileCommand(this.compileCommand()), wasm: wasm};
    }

    private executeCompileCommand(command: string): Promise<SourceMap> {
        return new Promise((resolve, reject) => {
            let sourceMap: SourceMap;

            function handleCompilerStreams(error: ExecException | null, stdout: String, stderr: any) {
                // TODO handle errors
            }

            let cp = exec(command, handleCompilerStreams);
            sourceMap = AssemblyScriptCompilerBridge.makeSourceMap('/tmp/warduino/upload.wasm.map'); // TODO

            cp.on('close', (code) => {
                if (sourceMap) {
                    resolve(sourceMap);
                }
            });
        });
    }

    private compileCommand(): string {
        return 'asc --sourceMap --converge --target debug --use abort= --binaryFile="/tmp/warduino/upload.wasm"' + this.sourceFilePath;  // TODO
    }

    private static makeSourceMap(sourceMapFile: String): SourceMap {
        // TODO
        return {lineInfoPairs: [], functionInfos: [], globalInfos: [], importInfos: []};
    }
}