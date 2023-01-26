/**
 * Specification test suite for WebAssembly.
 */
import {EmulatorBridge, WABT} from './warduino.bridge';
import {WatCompiler} from '../framework/Compiler';
import {SourceMap} from '../../State/SourceMap';
import {FunctionInfo} from '../../State/FunctionInfo';
import {expect} from 'chai';

export function parseFloat(hex: string): number {
    if (hex === undefined) {
        return NaN;
    }
    const radix: number = hex.includes('0x') ? 16 : 10;
    let result: number = parseInt(hex.split('.')[0], radix);
    const decimals = parseInt(hex.split('.')[1], radix);
    result = Math.sign(result) * (Math.abs(result) +(isNaN(decimals) ? 0 : (decimals / magnitude(decimals))));
    const exponent: number = parseFloat(hex.split(radix === 16 ? 'p' : 'e')[1]);
    return result * Math.pow(10, isNaN(exponent) ? 0 : exponent);
}

function magnitude(n: number) {
    return Math.pow(10, Math.ceil(Math.log(n) / Math.LN10));
}

export function returnParser(text: string): Object {
    return JSON.parse(text).stack[0];
}

export async function encode(program: string, name: string, args: number[]): Promise<string> {
    const map: SourceMap = await new WatCompiler(program, WABT).map();

    return new Promise((resolve, reject) => {
        const func = map.functionInfos.find((func: FunctionInfo) => func.name === name);

        if (func === undefined) {
            reject('cannot find fidx');
        } else {
            let result: string = EmulatorBridge.convertToLEB128(func.index);
            args.forEach((arg: number) => {
                result += EmulatorBridge.convertToLEB128(arg);
            });
            resolve(result);
        }
    });
}

describe('Test Parse Float', () => {
    it('Radix 10', async () => {
        expect(parseFloat('4')).to.equal(4);
        expect(parseFloat('445')).to.equal(445);
    });

    it('Radix 16', async () => {
        expect(parseFloat('-0x0p+0\n')).to.equal(0);
        expect(parseFloat('0x4')).to.equal(4);
        expect(parseFloat('0x445')).to.equal(1093);
        expect(parseFloat('0x1p-149')).to.equal(1e-149);
        expect(Math.round(parseFloat('-0x1.921fb6p+2') * 10000) / 10000).to.equal(-195.7637);
    });
});

