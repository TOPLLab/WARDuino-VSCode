import 'mocha';
import {WASMCompilerBridge} from '../../CompilerBridges/WASMCompilerBridge';
import {expect} from 'chai';
import {before} from 'mocha';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ErrnoException = NodeJS.ErrnoException;

const runPath = process.cwd();
const wabtSDK = `${runPath}/WABT/build`;
const wasmDirectoryPath = `${runPath}/src/test/suite/examples`;

describe('WASM Compiler Bridge Test Suite', () => {
    let tmpdir: string = '';

    before(async function () {
        await new Promise(resolve => {
            fs.mkdtemp(path.join(os.tmpdir(), 'warduino.'), (err: ErrnoException | null, dir: string) => {
                if (err === null) {
                    tmpdir = dir;
                    resolve(null);
                }
            });
        });
    });

    it('TestCompileOK', async () => {
        let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_ok.wast`, tmpdir, wabtSDK);
        const result = (await compilerBridge.compile()).sourceMap;
        expect(result.lineInfoPairs).to.have.lengthOf.above(0);
        expect(result.lineInfoPairs[0].lineAddress).to.equal('0000042');
        expect(result.lineInfoPairs[0].lineInfo.line).to.equal(13);
    });

    it('TestCompileBridgeSyntaxError', async () => {
        let compilerBridge = new WASMCompilerBridge(`${wasmDirectoryPath}/fac_syntax_error.wast`, tmpdir, wabtSDK);
        let result = await compilerBridge.compile().catch((reason) => {
            expect(reason.lineInfo.line).to.equal(1);
            expect(reason.lineInfo.column).to.equal(2);
            expect(reason.message).to.contain('error: unexpected token "modul"');
        }
        );
        expect(result).to.be.undefined;
    });

    // TODO catch wat2wasm not in $PATH
});
