import {SourceMap} from '../../State/SourceMap';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {exec, ExecException} from 'child_process';
import {parseExport} from './Parsers';

interface CompileOutput {
    file: string; // the compiled file
    out?: String;
    err?: String;
}

export abstract class Compiler {
    protected abstract readonly program: string;

    // compiles program to WAT
    abstract compile(): Promise<CompileOutput>;

    // generates a sourceMap
    abstract map(): Promise<SourceMap>;

    protected makeTmpDir(): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err, tmpdir) => {
                if (err === null) {
                    resolve(tmpdir);
                } else {
                    reject('could not make temporary directory');
                }
            });
        });
    }
}

export class WatCompiler extends Compiler {
    protected readonly program: string;

    private readonly wabt: string;

    constructor(program: string, wabt: string) {
        super();
        this.program = program;
        this.wabt = wabt;
    }

    public async compile(): Promise<CompileOutput> {
        return this.makeTmpDir().then((dir) => {
            return this.wasm(dir);
        });
    }

    private wasm(tmpdir: string): Promise<CompileOutput> {
        // compile WAT to Wasm
        return new Promise<CompileOutput>((resolve, reject) => {
            const command = `${this.wabt}/wat2wasm --debug-names -v -o ${tmpdir}/upload.wasm ${this.program}`;
            let out: String = '';
            let err: String = '';

            function handle(error: ExecException | null, stdout: String, stderr: any) {
                out = stdout;
                err = error?.message ?? '';
            }

            let compile = exec(command, handle);

            compile.on('close', (code) => {
                if (code !== 0) {
                    reject(`wat2wasm exited with code ${code}`);
                    return;
                }
                resolve({file: `${tmpdir}/upload.wasm`, out: out, err: err});
            });
        });

    }

    private dump(output: CompileOutput): Promise<SourceMap> {
        // object dump
        return new Promise<SourceMap>((resolve, reject) => {
            const command = `${this.wabt}/wasm-objdump -x -m ${output.file}`;

            let compile = exec(command, (error: ExecException | null, stdout: String, stderr: any) => {
                resolve(this.parseWasmObjDump(output, stdout.toString()));
            });

            compile.on('close', (code) => {
                if (code !== 0) {
                    reject(`wasm-objdump exited with code ${code}`);
                    return;
                }
            });
        });
    }

    public async map(): Promise<SourceMap> {
        return this.compile().then((output) => {
            return this.dump(output);
        });
    }

    private parseWasmObjDump(context: CompileOutput, input: string): SourceMap {
        return {lineInfoPairs: [], functionInfos: parseExport(input), globalInfos: [], importInfos: []};
    }

}

export class AsScriptCompiler extends Compiler {
    protected readonly program: string;

    private compiled?: string;

    constructor(program: string) {
        super();
        this.program = program;
    }

    public async compile(): Promise<CompileOutput> {
        if (this.compiled) {
            return {file: this.compiled};
        }

        // TODO compile to wat and return file location
        this.compiled = this.program;
        return {file: this.compiled};
    }

    public async map(): Promise<SourceMap> {
        // TODO implement
        await this.compile();
        // ...
        return Promise.resolve({lineInfoPairs: [], functionInfos: [], globalInfos: [], importInfos: []});
    }
}