/**
 * Specification test suite for WebAssembly.
 */
import {EmulatorBridge, WABT} from './warduino.bridge';
import {WatCompiler} from '../framework/Compiler';
import {SourceMap} from '../../State/SourceMap';
import {FunctionInfo} from '../../State/FunctionInfo';
import {readFileSync} from 'fs';

// import {expect} from 'chai';

enum Type {
    float,
    integer
}

export interface Value {
    type: Type;
    value: number;
}

interface Cursor {
    value: number;
}

export function parseResult(input: string): Value | undefined {
    let cursor = 0;
    let delta: number = consume(input, cursor, /\(/d);
    if (delta === 0) {
        return undefined;
    }
    cursor += delta;

    delta = consume(input, cursor, /^[^.)]*/d);
    const type: Type = input.slice(cursor, cursor + delta).includes('f') ? Type.float : Type.integer;

    cursor += delta + consume(input, cursor + delta);

    let value;
    if (type === Type.float) {
        value = parseFloat(input.slice(cursor));
    } else {

    }

    if (value === undefined) {
        return value;
    }

    return {type, value};
}

export function parseArguments(input: string, index: Cursor): Value[] {
    const args: Value[] = [];

    let cursor: number = consume(input, 0, /invoke "[^"]+"/d);
    while (cursor < input.length) {
        let delta: number = consume(input, cursor, /^[^)]*\(/d);
        if (delta === 0) {
            break;
        }
        cursor += delta;

        delta = consume(input, cursor, /^[^.)]*/d);
        const type: Type = input.slice(cursor, cursor + delta).includes('f') ? Type.float : Type.integer;

        cursor += delta + consume(input, cursor + delta, /^[^)]*const /d);
        let maybe: number | undefined;
        if (type === Type.float) {
            maybe = parseFloat(input.slice(cursor));
        } else {

        }

        if (maybe !== undefined) {
            args.push({type, value: maybe});
        }

        cursor += consume(input, cursor, /\)/d);
        if (input[cursor] === ')') {
            break;
        }
    }

    index.value = cursor;

    return args;
}

function consume(input: string, cursor: number, regex: RegExp = / /d): number {
    const match = regex.exec(input.slice(cursor));
    // @ts-ignore
    return (match?.indices[0][1]) ?? 0;
}

export function parseAsserts(file: string): string[] {
    const asserts: string[] = [];
    readFileSync(file).toString().split('\n').forEach((line) => {
        if (line.includes('(assert_return')) {
            asserts.push(line.replace(/.*\(assert_return/, '('));
        }
    });
    return asserts;

}

// describe('Test Spec test generation', () => {
//     it('Consume token', async () => {
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 0)).to.equal(11);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 11, /\)/)).to.equal(7);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 18, /\(/)).to.equal(2);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 30, /\)/)).to.equal(7);
//     });
//
//     it('Parse arguments', async () => {
//         expect(parseArguments('(invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', {value: 0})).to.eql([
//             {type: Type.float, value: 0}, {type: Type.float, value: 0}]);
//         expect(parseArguments('(invoke "add" (f32.const 0x74p+0) (f32.const 0x5467p-3)) (f32.const 0x0p+0)', {value: 0})).to.eql([
//             {type: Type.float, value: 116}, {type: Type.float, value: 21.607}]);
//         expect(parseArguments('(((((invoke "none" ( )))))))))))))) (f32.const 0x0p+0)', {value: 0})).to.eql([]);
//         expect(parseArguments('((invoke "as-br-value") (i32.const 1))', {value: 0})).to.eql([]);
//         expect(parseArguments('( (invoke "as-unary-operand") (f64.const 1.0))', {value: 0})).to.eql([]);
//     });
//
//     it('Parse result', async () => {
//         expect(parseResult(') (f32.const 0x0p+0)')).to.eql({type: Type.float, value: 0});
//         expect(parseResult(') (f32.const 0xff4p+1)')).to.eql({type: Type.float, value: 40840});
//         expect(parseResult(') (f64.const 1.0))')).to.eql({type: Type.float, value: 1});
//     });
// });

export function parseFloat(hex: string): number | undefined {
    if (hex === undefined) {
        return undefined;
    }

    if (hex.includes('nan')) {
        return NaN;
    }

    if (hex.includes('-inf')) {
        return -Infinity;
    }

    if (hex.includes('inf')) {
        return Infinity;
    }

    const radix: number = hex.includes('0x') ? 16 : 10;
    const input = hex.split(radix === 16 ? 'p' : 'e');

    let result: number = parseInt(input[0], radix);
    const decimals = parseInt(input[0].split('.')[1], radix);
    result = Math.sign(result) * (Math.abs(result) + (isNaN(decimals) ? 0 : (decimals / magnitude(decimals))));
    if (isNaN(result)) {
        return undefined;
    }
    const exponent: number | undefined = parseInt(input[1], radix);
    return result * Math.pow(10, exponent === undefined || isNaN(exponent) ? 0 : exponent);
}

function magnitude(n: number) {
    if (n === 0) {
        return 1;
    }
    return Math.pow(10, Math.ceil(Math.log(n) / Math.LN10));
}

export async function encode(program: string, name: string, args: Value[]): Promise<string> {
    const map: SourceMap = await new WatCompiler(program, WABT).map();

    return new Promise((resolve, reject) => {
        const func = map.functionInfos.find((func: FunctionInfo) => func.name === name);

        if (func === undefined) {
            reject('cannot find fidx');
            return;
        }

        let result: string = EmulatorBridge.convertToLEB128(func.index);
        args.forEach((arg: Value) => {
            if (arg.type === Type.integer) {
                result += EmulatorBridge.convertToLEB128(arg.value);
            } else {
                // todo encode float
            }
        });
        resolve(result);
    });
}

// describe('Test Parse Float', () => {
//     it('Radix 10', async () => {
//         expect(parseFloat('4')).to.equal(4);
//         expect(parseFloat('445')).to.equal(445);
//     });
//
//     it('Radix 16', async () => {
//         expect(parseFloat('-0x0p+0\n')).to.equal(0);
//         expect(parseFloat('0x4')).to.equal(4);
//         expect(parseFloat('0x445')).to.equal(1093);
//         expect(parseFloat('0x1p-149')).to.equal(1e-149);
//         expect(Math.round((parseFloat('-0x1.921fb6p+2') ?? NaN) * 10000) / 10000).to.equal(-195.7637);
//         expect(parseFloat('-0x1.fffffffffffffp+1023')).to.equal(-Infinity);
//         expect(parseFloat('-0x1.8330077d90a07p+476')).to.equal(-Infinity);
//         expect(parseFloat('-0x1.e251d762163ccp+825')).to.equal(-Infinity);
//         expect(parseFloat('0x1.3ee63581e1796p+349')).to.equal(-Infinity);
//     });
// });
