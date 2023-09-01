import { HexaEncoder } from "../../Util/hexaEncoding";

// Constants for frame identifiers
export const FRAME_FUNC_TYPE = 0;
export const FRAME_INITEXPR_TYPE = 1;
export const FRAME_BLOCK_TYPE = 2;
export const FRAME_LOOP_TYPE = 3;
export const FRAME_IF_TYPE = 4;
export const FRAME_PROXY_GUARD_TYPE = 254;
export const FRAME_CALLBACK_GUARD_TYPE = 255;

interface JSONFrame {
    type: number;
    fidx: string;
    sp: number;
    fp: number;
    block_key: number;
    ra: number;
    idx: number;
}

export class Frame {
    private _type!: number;
    private _fidx!: string;
    private _sp!: number;
    private _fp!: number;
    private _block_key!: number;
    private _ra!: number;
    private _idx!: number;

    constructor(jsonFrame: JSONFrame) {
        Object.assign(this, jsonFrame);
    }

    private serializeFramePointer(addr: number) {
        // | Pointer   |
        // | 4*2 bytes |
        return HexaEncoder.serializeUInt32BE(addr);
    }

    public serialize(): string {
        // | Frame type | StackPointer | FramePointer |   Return Adress  | FID or Block ID
        // |  1*2 bytes |   4*2bytes   |   4*2bytes   | serializePointer | 4*2bytes or serializePointer
        const validTypes = [FRAME_FUNC_TYPE, FRAME_INITEXPR_TYPE, FRAME_BLOCK_TYPE, FRAME_LOOP_TYPE, FRAME_IF_TYPE, FRAME_PROXY_GUARD_TYPE, FRAME_CALLBACK_GUARD_TYPE];

        if (validTypes.indexOf(this.type) === -1) {
            throw (new Error(`received unknow frame type ${this.type}`));
        }
        const type = HexaEncoder.serializeUInt8(this.type);
        const bigEndian = true;
        const sp = HexaEncoder.serializeInt32(this.sp, bigEndian);
        const fp = HexaEncoder.serializeInt32(this.fp, bigEndian);
        const ra = this.serializeFramePointer(this.ra);
        let rest = '';
        let res_str = ''; //TODO remove
        if (this.type === FRAME_FUNC_TYPE) {
            rest = HexaEncoder.serializeUInt32BE(Number(this.fidx));
            res_str = `fun_idx=${Number(this.fidx)}`;
        }
        else if (this.type === FRAME_PROXY_GUARD_TYPE || this.type === FRAME_CALLBACK_GUARD_TYPE) {
            // Nothing has to happen
        }
        else {
            rest = this.serializeFramePointer(this.block_key);
            res_str = `block_key=${this.block_key}`;
        }
        console.log(`Frame: type=${this.type} sp=${this.sp} fp=${this.fp} ra=${this.ra} ${res_str}`);
        return `${type}${sp}${fp}${ra}${rest}`;
    }

    /* Getter and setters */
    public get type(): number {
        return this._type;
    }

    public set type(value: number) {
        this._type = value;
    }

    public get fidx(): string {
        return this._fidx;
    }

    public set fidx(value: string) {
        this._fidx = value;
    }

    public get sp(): number {
        return this._sp;
    }
    public set sp(value: number) {
        this._sp = value;
    }

    public get fp(): number {
        return this._fp;
    }

    public set fp(value: number) {
        this._fp = value;
    }

    public get block_key(): number {
        return this._block_key;
    }

    public set block_key(value: number) {
        this._block_key = value;
    }

    public get ra(): number {
        return this._ra;
    }

    public set ra(value: number) {
        this._ra = value;
    }

    public get idx(): number {
        return this._idx;
    }

    public set idx(value: number) {
        this._idx = value;
    }
}