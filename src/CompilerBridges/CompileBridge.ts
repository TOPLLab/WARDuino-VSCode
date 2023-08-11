import {SourceMap} from '../State/SourceMap';

export interface CompileResult{
    sourceMap: SourceMap;
    wasm: Buffer;
}

export interface CompileBridge {
    compile(): Promise<CompileResult>;
    clean(path2makefile: string): Promise<void>;
}