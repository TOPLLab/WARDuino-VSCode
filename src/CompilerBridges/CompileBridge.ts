import {SourceMap} from "../State/SourceMap";

export interface CompileResult{
    sourceMap: SourceMap;
    wasm: Buffer;
};

export interface CompileBridge {
    compile(): Promise<CompileResult>;
}