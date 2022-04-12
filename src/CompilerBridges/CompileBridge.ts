import {SourceMap} from "../State/SourceMap";

export interface CompileBridge {
    compile(): Promise<SourceMap>;
}