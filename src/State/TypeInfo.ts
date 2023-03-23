export enum WASMType {
    i32 = 'i32',
    i64 = 'i64',
    f32 = 'f32',
    f64 = 'f64'
}


export function string2WASMType(v: string): WASMType {
    if(v === 'i32'){
        return WASMType.i32;
    }
    else if(v === 'i64'){
        return WASMType.i64;
    }
    else if (v === 'f32'){
        return WASMType.f32;
    }
    else if (v === 'f64'){
        return WASMType.f64;
    }
    throw (new Error(`Cannot covert to WasmType. Received invalid WasmType: ${v}`));
}

export interface TypeInfo {
    index: number;
    parameters: WASMType[];
    result?: WASMType;
}