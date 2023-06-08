import {getFileExtension} from '../Parsers/ParseUtils';
import {CompileBridge} from './CompileBridge';
import {WASMCompilerBridge} from './WASMCompilerBridge';
import {AssemblyScriptCompilerBridge} from './AssemblyScriptCompilerBridge';

export class CompileBridgeFactory {
    static makeCompileBridge(file: string, tmpdir: string, wabt: string): CompileBridge {
        let fileType = getFileExtension(file);
        switch (fileType) {
            case 'wast' :
                return new WASMCompilerBridge(file, tmpdir, wabt);
            case 'ts' :
                return new AssemblyScriptCompilerBridge(file, tmpdir, wabt);
        }
        throw new Error('Unsupported file type');
    }
}