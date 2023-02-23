/**
 * Specification test suite for WebAssembly.
 */
import {readFileSync} from 'fs';

// import {expect} from 'chai';

export enum Type {
    f32,
    f64,
    i32,
    i64,
    unknown
}

export const typing = new Map<string, Type>([
    ['f32', Type.f32],
    ['f64', Type.f64],
    ['i32', Type.i32],
    ['i64', Type.i64]
]);

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
    const type: Type = typing.get(input.slice(cursor, cursor + delta)) ?? Type.i64;

    cursor += delta + consume(input, cursor + delta);

    let value;
    if (type === Type.f32 || type === Type.f64) {
        value = parseFloatNumber(input.slice(cursor));
    } else {
        value = parseInteger(input.slice(cursor));
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
        const type: Type = typing.get(input.slice(cursor + delta - 3, cursor + delta)) ?? Type.i64;

        cursor += delta + consume(input, cursor + delta, /^[^)]*const /d);
        let maybe: number | undefined;
        if (type === Type.f32 || type === Type.f64) {
            maybe = parseFloatNumber(input.slice(cursor));
        } else {
            maybe = parseInteger(input.slice(cursor));
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
            asserts.push(line.replace(/.*\(assert_return\s*/, '('));
        }
    });
    return asserts;

}

// describe('Test Spec test generation', () => {
//     it('Consume token', async () => {
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 0)).to.equal(11);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 11, /\)/d)).to.equal(7);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 18, /\(/d)).to.equal(2);
//         expect(consume('(f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', 30, /\)/d)).to.equal(7);
//     });
//
//     it('Parse arguments', async () => {
//         expect(parseArguments('(invoke "add" (f32.const 0x0p+0) (f32.const 0x0p+0)) (f32.const 0x0p+0)', {value: 0})).to.eql([
//             {type: Type.f32, value: 0}, {type: Type.f32, value: 0}]);
//         expect(parseArguments('(invoke "add" (f32.const 0x74p+0) (f32.const 0x5467p-3)) (f32.const 0x0p+0)', {value: 0})).to.eql([
//             {type: Type.f32, value: 116}, {type: Type.f32, value: 2700.875}]);
//         expect(parseArguments('( (invoke "add" (f32.const -0x0p+0) (f32.const -0x1p-1)) (f32.const -0x1p-1))', {value: 0})).to.eql([
//             {type: Type.f32, value: -0}, {type: Type.f32, value: -0.5}]);
//         expect(parseArguments('(((((invoke "none" ( )))))))))))))) (f32.const 0x0p+0)', {value: 0})).to.eql([]);
//         expect(parseArguments('((invoke "as-br-value") (i32.const 1))', {value: 0})).to.eql([]);
//         expect(parseArguments('( (invoke "as-unary-operand") (f64.const 1.0))', {value: 0})).to.eql([]);
//     });
//
//     it('Parse result', async () => {
//         expect(parseResult(') (f32.const 0x0p+0)')).to.eql({type: Type.f32, value: 0});
//         expect(parseResult(') (f32.const 0xff4p+1)')).to.eql({type: Type.f32, value: 8168});
//         expect(parseResult(') (f64.const 1.0))')).to.eql({type: Type.f64, value: 1});
//     });
// });

// describe('Test Spec test generation', () => {
//     it('Parse integer', async () => {
//         expect(parseInteger('0xffffffef', 4)).to.equal(-17);
//     });
// });

function parseInteger(hex: string, bytes: number = 4): number {
    if (!hex.includes('0x')) {
        return parseInt(hex);
    }
    const mask = parseInt('0x80' + '00'.repeat(bytes - 1), 16);
    let integer = parseInt(hex, 16);
    if (integer >= mask) {
        integer = integer - mask * 2;
    }
    return integer;
}

export function parseFloatNumber(hex: string): number | undefined {
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

    const base: number = parseInt(input[0], radix);
    const decimals = parseFloat(`0.${parseInt(input[0].split('.')[1], radix)}`);
    const exponent = parseInt(input[1]);

    const result = Math.sign(base) * (Math.abs(base) + decimals) * (2 ** exponent);
    if (result === undefined || isNaN(result)) {
        return undefined;
    }
    return result;
}

function magnitude(n: number) {
    if (n === 0) {
        return 1;
    }
    return Math.pow(10, Math.ceil(Math.log(n) / Math.LN10));
}

function convertNumberToBinary(num: number): string {
    let str = '';
    const c = new Uint8Array(new Float64Array([num]).buffer, 0, 8);
    for (const element of c.reverse()) {
        str += element.toString(2).padStart(8, '0');
    }
    return str;
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
